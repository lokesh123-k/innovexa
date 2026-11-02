import { Router } from 'express';
import { z } from 'zod';
import { idParamSchema, paginationQuerySchema } from '@innovexa/shared';
import { authenticate, currentUser } from '../../middleware/authenticate.js';
import { valid, validate } from '../../middleware/validate.js';
import { ok } from '../../utils/http.js';
import { listNotifications, markRead } from './notification.service.js';

const listQuery = paginationQuerySchema.extend({
  unreadOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

export const notificationsRouter = Router();
notificationsRouter.use(authenticate);

notificationsRouter.get('/', validate({ query: listQuery }), async (req, res) => {
  const { items, unread, meta } = await listNotifications(
    currentUser(req)._id,
    valid(req, 'query'),
  );
  res.json({ success: true, data: items, meta: { ...meta, unread } });
});

notificationsRouter.post('/read-all', async (req, res) => {
  ok(res, { updated: await markRead(currentUser(req)._id) });
});

notificationsRouter.post('/:id/read', validate({ params: idParamSchema }), async (req, res) => {
  ok(res, {
    updated: await markRead(currentUser(req)._id, valid<{ id: string }>(req, 'params').id),
  });
});
