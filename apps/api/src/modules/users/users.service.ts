import type { Request } from 'express';
import type { Types } from 'mongoose';
import {
  AuthTokenPurpose,
  ClientStatus,
  Role,
  UserStatus,
  type InviteUserInput,
  type ListUsersQuery,
  type SetUserStatusInput,
  type UpdateOwnProfileInput,
  type UpdateUserInput,
} from '@innovexa/shared';
import { env } from '../../config/env';
import { AppError } from '../../utils/AppError';
import { escapeRegex, pageMeta } from '../../utils/http';
import { MailDeliveryError, actionEmail, sendMail } from '../../utils/mailer';
import { recordAudit } from '../audit-logs/auditLog.service';
import { issueAuthToken } from '../auth/authToken.service';
import { revokeAllSessions } from '../auth/auth.service';
import { Client } from '../clients/client.model';
import { User, type UserDoc } from './user.model';

const ROLE_LABEL: Record<Role, string> = {
  [Role.ADMIN]: 'Admin Portal',
  [Role.PARTNER]: 'Partner Portal',
  [Role.CLIENT]: 'Client Portal',
};

/**
 * Emails a fresh invitation link and records the real outcome on the user.
 * SENT only when the mail server accepted the message. With the development
 * `log` transport nothing leaves the machine, so the status is NOT_SENT.
 */
async function sendInvitation(req: Request, user: UserDoc, inviterName: string) {
  const cfg = env();
  const raw = await issueAuthToken(
    user._id,
    AuthTokenPurpose.INVITE,
    cfg.INVITE_TOKEN_TTL_HOURS * 3_600_000,
  );
  const at = new Date();
  try {
    const result = await sendMail({
      to: user.email,
      subject: `You're invited to the Innovexa ${ROLE_LABEL[user.role]}`,
      ...actionEmail({
        greeting: `Hi ${user.name},`,
        body: `${inviterName} has invited you to the Innovexa Digital ${ROLE_LABEL[user.role]}. Set your password to activate your account. This link expires in ${cfg.INVITE_TOKEN_TTL_HOURS} hours.`,
        actionLabel: 'Set your password',
        url: `${cfg.APP_URL}/accept-invitation?token=${encodeURIComponent(raw)}`,
      }),
    });
    user.set(
      'invitationEmail',
      result.transport === 'log'
        ? {
            status: 'NOT_SENT',
            at,
            transport: 'log',
            error: 'Email is not configured (EMAIL_TRANSPORT=log)',
          }
        : { status: 'SENT', at, transport: result.transport },
    );
  } catch (err) {
    const error = err instanceof MailDeliveryError ? err.message : 'Email delivery failed.';
    user.set('invitationEmail', { status: 'FAILED', at, error, transport: cfg.EMAIL_TRANSPORT });
  }
  await user.save();
  const delivery = user.invitationEmail!;
  await recordAudit({
    req,
    action: delivery.status === 'SENT' ? 'user.invite_email_sent' : 'user.invite_email_failed',
    entity: 'User',
    entityId: user._id,
    after: { status: delivery.status, error: delivery.error },
  });
  return delivery;
}

async function findUserOrThrow(id: string) {
  const user = await User.findOne({ _id: id, deletedAt: null });
  if (!user) throw AppError.notFound('User');
  return user;
}

export async function listUsers(q: ListUsersQuery) {
  const filter: Record<string, unknown> = { deletedAt: null };
  if (q.role) filter.role = q.role;
  if (q.status) filter.status = q.status;
  if (q.partnerType) filter['partnerProfile.partnerType'] = q.partnerType;
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    filter.$or = [{ name: rx }, { email: rx }];
  }
  const [items, total] = await Promise.all([
    User.find(filter)
      .sort({ createdAt: -1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .lean(),
    User.countDocuments(filter),
  ]);
  return { items, meta: pageMeta(q.page, q.limit, total) };
}

export const getUser = (id: string) => findUserOrThrow(id);

export async function inviteUser(req: Request, input: InviteUserInput) {
  const inviter = req.user!;
  if (await User.exists({ email: input.email })) {
    throw AppError.conflict('A user with this email already exists', 'EMAIL_TAKEN');
  }
  if (input.clientId) {
    const client = await Client.exists({
      _id: input.clientId,
      archivedAt: null,
      status: ClientStatus.ACTIVE,
    });
    if (!client) throw AppError.badRequest('Client not found or inactive');
  }
  const user = await User.create({
    email: input.email,
    name: input.name,
    phone: input.phone,
    role: input.role,
    status: UserStatus.INVITED,
    partnerProfile: input.partnerProfile,
    clientId: input.clientId,
    invitedBy: inviter._id,
  });
  // The account is kept even if the email fails, so the admin can fix SMTP and resend.
  await sendInvitation(req, user, inviter.name);
  await recordAudit({
    req,
    action: 'user.invited',
    entity: 'User',
    entityId: user._id,
    after: user,
  });
  return user;
}

export async function resendInvitation(req: Request, id: string) {
  const user = await findUserOrThrow(id);
  if (user.status !== UserStatus.INVITED) {
    throw AppError.conflict('This user has already accepted their invitation', 'ALREADY_ACTIVE');
  }
  const delivery = await sendInvitation(req, user, req.user!.name);
  await recordAudit({ req, action: 'user.invite_resent', entity: 'User', entityId: user._id });
  if (delivery.status === 'FAILED') {
    throw new AppError(
      502,
      'EMAIL_DELIVERY_FAILED',
      `Invitation email was not sent: ${delivery.error}`,
    );
  }
  return user;
}

export async function updateUser(req: Request, id: string, input: UpdateUserInput) {
  const user = await findUserOrThrow(id);
  const before = user.toObject();
  if (input.name !== undefined) user.name = input.name;
  if (input.phone !== undefined) user.phone = input.phone ?? undefined;
  if (input.permissions !== undefined) user.permissions = input.permissions;
  if (input.partnerProfile) {
    if (user.role !== Role.PARTNER)
      throw AppError.badRequest('Only partners have a partner profile');
    for (const [key, value] of Object.entries(input.partnerProfile)) {
      if (value !== undefined) user.set(`partnerProfile.${key}`, value);
    }
  }
  await user.save();
  await recordAudit({
    req,
    action: 'user.updated',
    entity: 'User',
    entityId: user._id,
    before,
    after: user,
  });
  return user;
}

export async function setUserStatus(req: Request, id: string, { status }: SetUserStatusInput) {
  const user = await findUserOrThrow(id);
  if (user._id.equals(req.user!._id)) {
    throw AppError.badRequest('You cannot change the status of your own account');
  }
  if (user.status === UserStatus.INVITED && status === UserStatus.ACTIVE) {
    throw AppError.badRequest('Invited users become active by accepting their invitation');
  }
  if (user.status === status) return user;
  const before = { status: user.status };
  user.status = status;
  if (status === UserStatus.INACTIVE) {
    // Kill every outstanding access token and refresh session immediately.
    user.tokenVersion += 1;
    await revokeAllSessions(user._id);
  }
  await user.save();
  await recordAudit({
    req,
    action: status === UserStatus.INACTIVE ? 'user.deactivated' : 'user.activated',
    entity: 'User',
    entityId: user._id,
    before,
    after: { status },
  });
  return user;
}

export async function updateOwnProfile(
  req: Request,
  userId: Types.ObjectId,
  input: UpdateOwnProfileInput,
) {
  const user = await User.findById(userId);
  if (!user) throw AppError.notFound('User');
  if (input.name !== undefined) user.name = input.name;
  if (input.phone !== undefined) user.phone = input.phone ?? undefined;
  await user.save();
  await recordAudit({ req, action: 'user.profile_updated', entity: 'User', entityId: user._id });
  return user;
}
