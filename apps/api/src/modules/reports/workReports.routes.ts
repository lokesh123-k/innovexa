import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import {
  Role,
  WorkReportType,
  createWorkReportSchema,
  idParamSchema,
  listWorkReportsQuerySchema,
  type CreateWorkReportInput,
  type ListWorkReportsQuery,
} from '@innovexa/shared';
import { authenticate, currentUser } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { valid, validate } from '../../middleware/validate.js';
import { AppError } from '../../utils/AppError.js';
import { pageMeta, ok } from '../../utils/http.js';
import { recordAudit } from '../audit-logs/auditLog.service.js';
import { Task } from '../tasks/task.model.js';
import { TaskUpdate } from '../task-updates/taskUpdate.model.js';
import { WorkReport } from './workReport.model.js';

/** Normalise to UTC midnight so "one report per day" is enforced by the unique index. */
const dayStart = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

export const workReportsRouter = Router();
workReportsRouter.use(authenticate, authorize(Role.ADMIN, Role.PARTNER));

workReportsRouter.get('/', validate({ query: listWorkReportsQuerySchema }), async (req, res) => {
  const user = currentUser(req);
  const q = valid<ListWorkReportsQuery>(req, 'query');
  const filter: Record<string, unknown> = {};
  // Partners only ever see their own reports.
  filter.partnerId = user.role === Role.PARTNER ? user._id : q.partnerId;
  if (!filter.partnerId) delete filter.partnerId;
  if (q.type) filter.type = q.type;
  if (q.from || q.to)
    filter.date = {
      ...(q.from ? { $gte: dayStart(q.from) } : {}),
      ...(q.to ? { $lte: q.to } : {}),
    };
  const [items, total] = await Promise.all([
    WorkReport.find(filter)
      .sort({ date: -1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .populate('partnerId', 'name email partnerProfile.partnerType')
      .populate('taskIds', 'title')
      .lean(),
    WorkReport.countDocuments(filter),
  ]);
  ok(res, items, 200, pageMeta(q.page, q.limit, total));
});

workReportsRouter.post(
  '/',
  authorize(Role.PARTNER),
  validate({ body: createWorkReportSchema }),
  async (req, res) => {
    const user = currentUser(req);
    const input = valid<CreateWorkReportInput>(req, 'body');
    if (input.taskIds.length) {
      const own = await Task.countDocuments({ _id: { $in: input.taskIds }, assigneeIds: user._id });
      if (own !== new Set(input.taskIds).size)
        throw AppError.badRequest('You can only report on tasks assigned to you');
    }
    const date = dayStart(input.date);
    if (date > new Date()) throw AppError.badRequest('Reports cannot be dated in the future');
    if (input.type === WorkReportType.WEEKLY && input.periodEnd && input.periodEnd < date) {
      throw AppError.badRequest('Period end must be after the start');
    }
    try {
      const report = await WorkReport.create({ ...input, date, partnerId: user._id });
      await recordAudit({
        req,
        action: 'work_report.submitted',
        entity: 'WorkReport',
        entityId: report._id,
      });
      ok(res, report, 201);
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        throw AppError.conflict(
          `You already submitted a ${input.type.toLowerCase()} report for this date`,
        );
      }
      throw err;
    }
  },
);

workReportsRouter.get('/:id', validate({ params: idParamSchema }), async (req, res) => {
  const user = currentUser(req);
  const report = await WorkReport.findOne({
    _id: valid<{ id: string }>(req, 'params').id,
    ...(user.role === Role.PARTNER ? { partnerId: user._id } : {}),
  })
    .populate('partnerId', 'name email')
    .populate('taskIds', 'title')
    .lean();
  if (!report) throw AppError.notFound('Work report');
  ok(res, report);
});

/** Time tracking: minutes per day from task updates and reports (partner: own; admin: any partner). */
workReportsRouter.get(
  '/time/summary',
  validate({
    query: z.object({
      from: z.coerce.date(),
      to: z.coerce.date(),
      partnerId: z
        .string()
        .regex(/^[a-f\d]{24}$/i)
        .optional(),
    }),
  }),
  async (req, res) => {
    const user = currentUser(req);
    const q = valid<{ from: Date; to: Date; partnerId?: string }>(req, 'query');
    const partnerId = user.role === Role.PARTNER ? user._id : q.partnerId;
    if (!partnerId) throw AppError.badRequest('partnerId is required');
    const match = { partnerId: new Types.ObjectId(String(partnerId)) };
    const [byDay, byTask, reported] = await Promise.all([
      TaskUpdate.aggregate([
        { $match: { ...match, createdAt: { $gte: q.from, $lte: q.to } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            minutes: { $sum: '$minutesSpent' },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      TaskUpdate.aggregate([
        { $match: { ...match, createdAt: { $gte: q.from, $lte: q.to } } },
        { $group: { _id: '$taskId', minutes: { $sum: '$minutesSpent' }, updates: { $sum: 1 } } },
        { $lookup: { from: 'tasks', localField: '_id', foreignField: '_id', as: 'task' } },
        { $project: { minutes: 1, updates: 1, title: { $first: '$task.title' } } },
        { $sort: { minutes: -1 } },
      ]),
      WorkReport.aggregate([
        { $match: { ...match, date: { $gte: dayStart(q.from), $lte: q.to } } },
        { $group: { _id: '$type', minutes: { $sum: '$minutesWorked' }, reports: { $sum: 1 } } },
      ]),
    ]);
    ok(res, { byDay, byTask, reported });
  },
);
