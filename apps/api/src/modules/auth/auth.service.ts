import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { Types } from 'mongoose';
import {
  AuthTokenPurpose,
  UserStatus,
  type AcceptInvitationInput,
  type ChangePasswordInput,
  type LoginInput,
  type ResetPasswordInput,
} from '@innovexa/shared';
import { env } from '../../config/env.js';
import { signAccessToken } from '../../middleware/authenticate.js';
import { AppError } from '../../utils/AppError.js';
import { generateToken, sha256 } from '../../utils/crypto.js';
import { logger } from '../../utils/logger.js';
import { actionEmail, sendMail, sendMailSafe } from '../../utils/mailer.js';
import { User, type UserDoc } from '../users/user.model.js';
import { consumeAuthToken, issueAuthToken, peekAuthToken } from './authToken.service.js';
import { RefreshSession } from './refreshSession.model.js';

export interface ClientMeta {
  ip?: string;
  userAgent?: string;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
}

// Compared against when the email is unknown so response time does not reveal account existence.
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser-not-a-password', 10);

export const hashPassword = (password: string) => bcrypt.hash(password, env().BCRYPT_ROUNDS);

async function createSession(
  user: { _id: Types.ObjectId; role: UserDoc['role']; tokenVersion: number },
  meta: ClientMeta,
  familyId: string = randomUUID(),
) {
  const refreshToken = generateToken();
  const session = await RefreshSession.create({
    userId: user._id,
    familyId,
    tokenHash: sha256(refreshToken),
    expiresAt: new Date(Date.now() + env().REFRESH_TOKEN_TTL_DAYS * 86_400_000),
    ip: meta.ip,
    userAgent: meta.userAgent?.slice(0, 300),
  });
  return {
    session,
    tokens: { accessToken: signAccessToken(user), refreshToken } satisfies IssuedTokens,
  };
}

export async function revokeAllSessions(userId: Types.ObjectId): Promise<void> {
  await RefreshSession.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
}

/**
 * Server-side record of why a login failed. The client always gets the same
 * generic message; this log is for operators. In development it also reports
 * the submitted password's length and surrounding whitespace (never its value)
 * to diagnose autofill / typo problems.
 */
function logFailedLogin(reason: string, input: LoginInput, meta: ClientMeta, extra: object = {}) {
  const dev = env().NODE_ENV === 'development';
  logger.warn(
    {
      reason,
      email: input.email,
      ip: meta.ip,
      ...extra,
      ...(dev && {
        passwordLength: input.password.length,
        passwordHasOuterWhitespace: input.password !== input.password.trim(),
      }),
    },
    'Login failed',
  );
}

/** 423 with the lock expiry so the UI can tell the user when to retry. */
function lockedError(lockUntil: Date) {
  const minutes = Math.max(1, Math.ceil((lockUntil.getTime() - Date.now()) / 60_000));
  return new AppError(
    423,
    'ACCOUNT_LOCKED',
    `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'} or reset your password.`,
    { lockedUntil: lockUntil.toISOString() },
  );
}

export async function login(input: LoginInput, meta: ClientMeta) {
  const cfg = env();
  const user = await User.findOne({ email: input.email, deletedAt: null }).select(
    '+passwordHash +failedLoginAttempts +lockUntil',
  );

  if (!user?.passwordHash) {
    await bcrypt.compare(input.password, DUMMY_HASH);
    logFailedLogin(user ? 'NO_PASSWORD_SET' : 'UNKNOWN_EMAIL', input, meta);
    throw AppError.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
  }
  if (user.lockUntil && user.lockUntil > new Date()) {
    logFailedLogin('ACCOUNT_LOCKED', input, meta, { lockUntil: user.lockUntil });
    throw lockedError(user.lockUntil);
  }

  const valid = await bcrypt.compare(input.password, user.passwordHash);
  if (!valid) {
    const attempts = (user.failedLoginAttempts ?? 0) + 1;
    const lockUntil =
      attempts >= cfg.MAX_FAILED_LOGINS
        ? new Date(Date.now() + cfg.LOCKOUT_MINUTES * 60_000)
        : null;
    await User.updateOne(
      { _id: user._id },
      lockUntil
        ? { $set: { failedLoginAttempts: 0, lockUntil } }
        : { $set: { failedLoginAttempts: attempts } },
    );
    logFailedLogin('WRONG_PASSWORD', input, meta, {
      attempt: attempts,
      maxAttempts: cfg.MAX_FAILED_LOGINS,
      lockedNow: Boolean(lockUntil),
    });
    if (lockUntil) throw lockedError(lockUntil);
    throw AppError.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
  }

  // Status is revealed only after a correct password, so it cannot be used to probe accounts.
  if (user.status === UserStatus.INVITED) {
    throw AppError.forbidden(
      'Please accept your invitation to activate this account',
      'ACCOUNT_NOT_ACTIVATED',
    );
  }
  if (user.status !== UserStatus.ACTIVE) {
    throw AppError.forbidden(
      'This account has been deactivated. Contact Innovexa support.',
      'ACCOUNT_DISABLED',
    );
  }

  user.failedLoginAttempts = 0;
  user.lockUntil = null;
  user.lastLoginAt = new Date();
  await user.save();

  const { tokens } = await createSession(user, meta);
  return { user, tokens };
}

/**
 * Rotates a refresh token. Reuse of a consumed or revoked token revokes the
 * entire family, forcing every device that shares it to log in again.
 */
export async function refresh(rawToken: string | undefined, meta: ClientMeta) {
  if (!rawToken) throw AppError.unauthorized('No refresh token', 'REFRESH_INVALID');
  const tokenHash = sha256(rawToken);
  const now = new Date();

  const consumed = await RefreshSession.findOneAndUpdate(
    { tokenHash, usedAt: null, revokedAt: null, expiresAt: { $gt: now } },
    { $set: { usedAt: now } },
    { new: true },
  );

  if (!consumed) {
    const existing = await RefreshSession.findOne({ tokenHash }).lean();
    // Benign race: two tabs (or a reload during a background request) presented the
    // same token moments apart. Within the grace window, issue a sibling session in the
    // same family instead of treating it as theft. Revoked/expired tokens never qualify.
    const graceMs = env().REFRESH_REUSE_GRACE_SECONDS * 1000;
    if (
      existing?.usedAt &&
      !existing.revokedAt &&
      existing.expiresAt > now &&
      now.getTime() - existing.usedAt.getTime() <= graceMs
    ) {
      const user = await User.findOne({ _id: existing.userId, deletedAt: null });
      if (user?.status === UserStatus.ACTIVE) {
        const { tokens } = await createSession(user, meta, existing.familyId);
        return { user, tokens };
      }
    }
    if (existing && (existing.usedAt || existing.revokedAt)) {
      await RefreshSession.updateMany(
        { familyId: existing.familyId, revokedAt: null },
        { $set: { revokedAt: now } },
      );
      throw AppError.unauthorized('Session was revoked. Please sign in again.', 'REFRESH_REUSED');
    }
    throw AppError.unauthorized('Session expired. Please sign in again.', 'REFRESH_INVALID');
  }

  const user = await User.findOne({ _id: consumed.userId, deletedAt: null });
  if (!user || user.status !== UserStatus.ACTIVE) {
    await RefreshSession.updateMany({ familyId: consumed.familyId }, { $set: { revokedAt: now } });
    throw AppError.unauthorized('Session is no longer valid', 'SESSION_INVALID');
  }

  const { session, tokens } = await createSession(user, meta, consumed.familyId);
  consumed.replacedById = session._id;
  await consumed.save();
  return { user, tokens };
}

export async function logout(rawToken: string | undefined): Promise<void> {
  if (!rawToken) return;
  const session = await RefreshSession.findOne({ tokenHash: sha256(rawToken) }).lean();
  if (session) {
    await RefreshSession.updateMany(
      { familyId: session.familyId, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
  }
}

export async function logoutAll(userId: Types.ObjectId): Promise<void> {
  await User.updateOne({ _id: userId }, { $inc: { tokenVersion: 1 } });
  await revokeAllSessions(userId);
}

export async function getInvitation(rawToken: string) {
  const token = await peekAuthToken(rawToken, AuthTokenPurpose.INVITE);
  const user = await User.findOne({
    _id: token.userId,
    status: UserStatus.INVITED,
    deletedAt: null,
  }).lean();
  if (!user) throw new AppError(400, 'INVALID_TOKEN', 'This invitation is no longer valid');
  return { email: user.email, name: user.name, role: user.role };
}

export async function acceptInvitation(input: AcceptInvitationInput, meta: ClientMeta) {
  const token = await consumeAuthToken(input.token, AuthTokenPurpose.INVITE);
  const passwordHash = await hashPassword(input.password);
  const user = await User.findOneAndUpdate(
    { _id: token.userId, status: UserStatus.INVITED, deletedAt: null },
    { $set: { passwordHash, status: UserStatus.ACTIVE, emailVerifiedAt: new Date() } },
    { new: true },
  );
  if (!user) throw new AppError(400, 'INVALID_TOKEN', 'This invitation is no longer valid');
  const { tokens } = await createSession(user, meta);
  return { user, tokens };
}

/** Always resolves, whether or not the account exists. */
export async function forgotPassword(email: string): Promise<void> {
  const cfg = env();
  const user = await User.findOne({ email, status: UserStatus.ACTIVE, deletedAt: null }).lean();
  if (!user) return;
  const raw = await issueAuthToken(
    user._id,
    AuthTokenPurpose.RESET_PASSWORD,
    cfg.RESET_TOKEN_TTL_MINUTES * 60_000,
  );
  const url = `${cfg.APP_URL}/reset-password?token=${encodeURIComponent(raw)}`;
  // Not awaited: the response must look and time the same whether or not the account
  // exists or delivery fails (no account enumeration). Failures are logged without secrets.
  sendMailSafe({
    to: user.email,
    subject: 'Reset your Innovexa password',
    ...actionEmail({
      greeting: `Hi ${user.name},`,
      body: `We received a request to reset your password. This link expires in ${cfg.RESET_TOKEN_TTL_MINUTES} minutes.`,
      actionLabel: 'Reset password',
      url,
      footer: 'If you did not request this, you can ignore this email.',
    }),
  });
}

export async function resetPassword(input: ResetPasswordInput) {
  const token = await consumeAuthToken(input.token, AuthTokenPurpose.RESET_PASSWORD);
  const passwordHash = await hashPassword(input.password);
  const user = await User.findOneAndUpdate(
    { _id: token.userId, status: UserStatus.ACTIVE, deletedAt: null },
    {
      $set: { passwordHash, failedLoginAttempts: 0, lockUntil: null },
      $inc: { tokenVersion: 1 },
    },
    { new: true },
  );
  if (!user) throw new AppError(400, 'INVALID_TOKEN', 'This link is invalid or has expired');
  await revokeAllSessions(user._id);
  return user;
}

export async function sendVerificationEmail(userId: Types.ObjectId): Promise<void> {
  const cfg = env();
  const user = await User.findById(userId).lean();
  if (!user) throw AppError.notFound('User');
  if (user.emailVerifiedAt)
    throw AppError.conflict('Email is already verified', 'ALREADY_VERIFIED');
  const raw = await issueAuthToken(
    user._id,
    AuthTokenPurpose.VERIFY_EMAIL,
    cfg.VERIFY_TOKEN_TTL_HOURS * 3_600_000,
  );
  await sendMail({
    to: user.email,
    subject: 'Verify your Innovexa email address',
    ...actionEmail({
      greeting: `Hi ${user.name},`,
      body: 'Please confirm your email address.',
      actionLabel: 'Verify email',
      url: `${cfg.APP_URL}/verify-email?token=${encodeURIComponent(raw)}`,
    }),
  });
}

export async function verifyEmail(rawToken: string) {
  const token = await consumeAuthToken(rawToken, AuthTokenPurpose.VERIFY_EMAIL);
  const user = await User.findOneAndUpdate(
    { _id: token.userId, deletedAt: null },
    { $set: { emailVerifiedAt: new Date() } },
    { new: true },
  );
  if (!user) throw new AppError(400, 'INVALID_TOKEN', 'This link is invalid or has expired');
  return user;
}

/** Changes the password, signs out every other device, and returns fresh tokens for this one. */
export async function changePassword(
  userId: Types.ObjectId,
  input: ChangePasswordInput,
  meta: ClientMeta,
) {
  const user = await User.findById(userId).select('+passwordHash');
  if (!user?.passwordHash) throw AppError.unauthorized();
  if (!(await bcrypt.compare(input.currentPassword, user.passwordHash))) {
    throw AppError.badRequest('Current password is incorrect');
  }
  user.passwordHash = await hashPassword(input.newPassword);
  user.tokenVersion += 1;
  await user.save();
  await revokeAllSessions(user._id);
  const { tokens } = await createSession(user, meta);
  return { user, tokens };
}
