import { Router, type RequestHandler } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import * as ctrl from './auth.controller';
import {
  acceptInvitationSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  invitationParamsSchema,
  loginSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from './auth.validation';

/** `strictLimiter` guards token endpoints; `loginLimiter` counts failed sign-ins only. */
export function buildAuthRouter(strictLimiter: RequestHandler, loginLimiter: RequestHandler) {
  const router = Router();

  router.post('/login', loginLimiter, validate({ body: loginSchema }), ctrl.login);
  router.post('/refresh', ctrl.refresh);
  router.post('/logout', ctrl.logout);
  router.post('/logout-all', authenticate, ctrl.logoutAll);
  router.get('/me', authenticate, ctrl.me);

  router.get(
    '/invitations/:token',
    strictLimiter,
    validate({ params: invitationParamsSchema }),
    ctrl.getInvitation,
  );
  router.post(
    '/accept-invitation',
    strictLimiter,
    validate({ body: acceptInvitationSchema }),
    ctrl.acceptInvitation,
  );
  router.post(
    '/forgot-password',
    strictLimiter,
    validate({ body: forgotPasswordSchema }),
    ctrl.forgotPassword,
  );
  router.post(
    '/reset-password',
    strictLimiter,
    validate({ body: resetPasswordSchema }),
    ctrl.resetPassword,
  );
  router.post(
    '/verify-email',
    strictLimiter,
    validate({ body: verifyEmailSchema }),
    ctrl.verifyEmail,
  );
  router.post('/resend-verification', authenticate, strictLimiter, ctrl.resendVerification);
  router.post(
    '/change-password',
    authenticate,
    strictLimiter,
    validate({ body: changePasswordSchema }),
    ctrl.changePassword,
  );

  return router;
}
