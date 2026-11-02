import { Router } from 'express';
import { Role, listAuditLogsQuerySchema, type ListAuditLogsQuery } from '@innovexa/shared';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { valid, validate } from '../../middleware/validate.js';
import { ok } from '../../utils/http.js';
import { listAuditLogs } from './auditLog.service.js';

export const auditLogRouter = Router();

auditLogRouter.get(
  '/',
  authenticate,
  authorize(Role.ADMIN),
  validate({ query: listAuditLogsQuerySchema }),
  async (req, res) => {
    const { items, meta } = await listAuditLogs(valid<ListAuditLogsQuery>(req, 'query'));
    ok(res, items, 200, meta);
  },
);
