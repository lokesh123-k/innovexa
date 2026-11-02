import { Router } from 'express';
import { Role, listAuditLogsQuerySchema, type ListAuditLogsQuery } from '@innovexa/shared';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { valid, validate } from '../../middleware/validate';
import { ok } from '../../utils/http';
import { listAuditLogs } from './auditLog.service';

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
