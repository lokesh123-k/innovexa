import { z } from 'zod';
import { objectIdSchema } from '@innovexa/shared';
export {
  inviteUserSchema,
  listUsersQuerySchema,
  setUserStatusSchema,
  updateOwnProfileSchema,
  updateUserSchema,
} from '@innovexa/shared';

export const userIdParamsSchema = z.object({ id: objectIdSchema });
