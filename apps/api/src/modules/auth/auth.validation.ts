import { z } from 'zod';
export {
  acceptInvitationSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from '@innovexa/shared';
import { tokenSchema } from '@innovexa/shared';

export const invitationParamsSchema = z.object({ token: tokenSchema });
