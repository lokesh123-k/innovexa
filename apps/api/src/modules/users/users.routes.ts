import { Router } from 'express';
import { Role } from '@innovexa/shared';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import * as ctrl from './users.controller';
import {
  inviteUserSchema,
  listUsersQuerySchema,
  setUserStatusSchema,
  updateOwnProfileSchema,
  updateUserSchema,
  userIdParamsSchema,
} from './users.validation';

export const usersRouter = Router();

usersRouter.use(authenticate);

// Self-service (any role). Declared before `/:id` so "me" is not parsed as an id.
usersRouter.patch('/me', validate({ body: updateOwnProfileSchema }), ctrl.updateMe);

usersRouter.use(authorize(Role.ADMIN));
usersRouter.get('/', validate({ query: listUsersQuerySchema }), ctrl.list);
usersRouter.post('/invite', validate({ body: inviteUserSchema }), ctrl.invite);
usersRouter.get('/:id', validate({ params: userIdParamsSchema }), ctrl.get);
usersRouter.patch(
  '/:id',
  validate({ params: userIdParamsSchema, body: updateUserSchema }),
  ctrl.update,
);
usersRouter.patch(
  '/:id/status',
  validate({ params: userIdParamsSchema, body: setUserStatusSchema }),
  ctrl.setStatus,
);
usersRouter.post('/:id/resend-invite', validate({ params: userIdParamsSchema }), ctrl.resendInvite);
