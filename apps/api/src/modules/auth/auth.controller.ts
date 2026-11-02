import type { Request, Response } from 'express';
import type {
  AcceptInvitationInput,
  ChangePasswordInput,
  ForgotPasswordInput,
  LoginInput,
  ResetPasswordInput,
} from '@innovexa/shared';
import { currentUser } from '../../middleware/authenticate.js';
import { valid } from '../../middleware/validate.js';
import { ok } from '../../utils/http.js';
import { recordAudit } from '../audit-logs/auditLog.service.js';
import { User } from '../users/user.model.js';
import { toUserDTO } from '../users/user.serializer.js';
import { REFRESH_COOKIE, clearAuthCookies, setAuthCookies } from './auth.cookies.js';
import * as auth from './auth.service.js';

const meta = (req: Request): auth.ClientMeta => ({ ip: req.ip, userAgent: req.get('user-agent') });
const refreshCookie = (req: Request) => req.cookies?.[REFRESH_COOKIE] as string | undefined;

export async function login(req: Request, res: Response) {
  const { user, tokens } = await auth.login(valid<LoginInput>(req, 'body'), meta(req));
  setAuthCookies(res, tokens);
  await recordAudit({ req, actor: user, action: 'auth.login', entity: 'User', entityId: user._id });
  ok(res, { user: toUserDTO(user, user.role) });
}

export async function refresh(req: Request, res: Response) {
  try {
    const { user, tokens } = await auth.refresh(refreshCookie(req), meta(req));
    setAuthCookies(res, tokens);
    ok(res, { user: toUserDTO(user, user.role) });
  } catch (err) {
    clearAuthCookies(res);
    throw err;
  }
}

export async function logout(req: Request, res: Response) {
  await auth.logout(refreshCookie(req));
  clearAuthCookies(res);
  ok(res, { loggedOut: true });
}

export async function logoutAll(req: Request, res: Response) {
  const user = currentUser(req);
  await auth.logoutAll(user._id);
  clearAuthCookies(res);
  await recordAudit({ req, action: 'auth.logout_all', entity: 'User', entityId: user._id });
  ok(res, { loggedOut: true });
}

export async function me(req: Request, res: Response) {
  const caller = currentUser(req);
  const user = await User.findById(caller._id).lean();
  ok(res, { user: toUserDTO(user!, caller.role) });
}

export async function getInvitation(req: Request, res: Response) {
  const { token } = valid<{ token: string }>(req, 'params');
  ok(res, await auth.getInvitation(token));
}

export async function acceptInvitation(req: Request, res: Response) {
  const { user, tokens } = await auth.acceptInvitation(
    valid<AcceptInvitationInput>(req, 'body'),
    meta(req),
  );
  setAuthCookies(res, tokens);
  await recordAudit({
    req,
    actor: user,
    action: 'auth.invitation_accepted',
    entity: 'User',
    entityId: user._id,
  });
  ok(res, { user: toUserDTO(user, user.role) });
}

export async function forgotPassword(req: Request, res: Response) {
  await auth.forgotPassword(valid<ForgotPasswordInput>(req, 'body').email);
  ok(res, { message: 'If an account exists for that email, a reset link has been sent.' });
}

export async function resetPassword(req: Request, res: Response) {
  const user = await auth.resetPassword(valid<ResetPasswordInput>(req, 'body'));
  clearAuthCookies(res);
  await recordAudit({
    req,
    actor: user,
    action: 'auth.password_reset',
    entity: 'User',
    entityId: user._id,
  });
  ok(res, { message: 'Password updated. Please sign in.' });
}

export async function verifyEmail(req: Request, res: Response) {
  const user = await auth.verifyEmail(valid<{ token: string }>(req, 'body').token);
  ok(res, { emailVerified: Boolean(user.emailVerifiedAt) });
}

export async function resendVerification(req: Request, res: Response) {
  await auth.sendVerificationEmail(currentUser(req)._id);
  ok(res, { message: 'Verification email sent.' });
}

export async function changePassword(req: Request, res: Response) {
  const caller = currentUser(req);
  const { user, tokens } = await auth.changePassword(
    caller._id,
    valid<ChangePasswordInput>(req, 'body'),
    meta(req),
  );
  setAuthCookies(res, tokens);
  await recordAudit({ req, action: 'auth.password_changed', entity: 'User', entityId: user._id });
  ok(res, { message: 'Password changed. Other devices have been signed out.' });
}
