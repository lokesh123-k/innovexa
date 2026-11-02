import { Router } from 'express';
import { z } from 'zod';
import {
  Role,
  TASK_UPDATE_KINDS,
  assignTaskSchema,
  createTaskSchema,
  idParamSchema,
  listTasksQuerySchema,
  paginationQuerySchema,
  progressUpdateSchema,
  reviewTaskSchema,
  submitTaskSchema,
  taskIssueSchema,
  updateTaskSchema,
} from '@innovexa/shared';
import { authenticate, currentUser } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { valid, validate } from '../../middleware/validate.js';
import { ok } from '../../utils/http.js';
import * as svc from './tasks.service.js';

const id = (req: Parameters<typeof valid>[0]) => valid<{ id: string }>(req, 'params').id;
const withId = (body: z.ZodType) => validate({ params: idParamSchema, body });

export const tasksRouter = Router();
tasksRouter.use(authenticate);

tasksRouter.get(
  '/',
  authorize(Role.ADMIN, Role.PARTNER),
  validate({ query: listTasksQuerySchema }),
  async (req, res) => {
    const { items, meta } = await svc.listTasks(currentUser(req), valid(req, 'query'));
    ok(res, items, 200, meta);
  },
);
tasksRouter.get('/review-queue', authorize(Role.ADMIN), async (_req, res) => {
  ok(res, await svc.reviewQueue());
});
tasksRouter.get(
  '/my-updates',
  authorize(Role.PARTNER),
  validate({
    query: paginationQuerySchema.extend({
      kind: z.enum(TASK_UPDATE_KINDS).optional(),
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
    }),
  }),
  async (req, res) => {
    const { items, meta } = await svc.myUpdates(currentUser(req), valid(req, 'query'));
    ok(res, items, 200, meta);
  },
);
tasksRouter.post(
  '/',
  authorize(Role.ADMIN),
  validate({ body: createTaskSchema }),
  async (req, res) => {
    const task = await svc.createTask(req, valid(req, 'body'));
    ok(res, await svc.getTask(currentUser(req), task._id.toString()), 201);
  },
);
tasksRouter.get(
  '/:id',
  authorize(Role.ADMIN, Role.PARTNER),
  validate({ params: idParamSchema }),
  async (req, res) => {
    ok(res, await svc.getTask(currentUser(req), id(req)));
  },
);
tasksRouter.patch('/:id', authorize(Role.ADMIN), withId(updateTaskSchema), async (req, res) => {
  await svc.updateTask(req, id(req), valid(req, 'body'));
  ok(res, await svc.getTask(currentUser(req), id(req)));
});
tasksRouter.post(
  '/:id/assign',
  authorize(Role.ADMIN),
  withId(assignTaskSchema),
  async (req, res) => {
    await svc.assignTask(req, id(req), valid<{ assigneeIds: string[] }>(req, 'body').assigneeIds);
    ok(res, await svc.getTask(currentUser(req), id(req)));
  },
);
tasksRouter.post(
  '/:id/updates',
  authorize(Role.PARTNER),
  withId(progressUpdateSchema),
  async (req, res) => {
    await svc.addProgressUpdate(req, id(req), valid(req, 'body'));
    ok(res, await svc.getTask(currentUser(req), id(req)), 201);
  },
);
tasksRouter.post(
  '/:id/submit',
  authorize(Role.PARTNER),
  withId(submitTaskSchema),
  async (req, res) => {
    await svc.submitTask(req, id(req), valid(req, 'body'));
    ok(res, await svc.getTask(currentUser(req), id(req)), 201);
  },
);
tasksRouter.post(
  '/:id/issues',
  authorize(Role.PARTNER),
  withId(taskIssueSchema),
  async (req, res) => {
    await svc.reportIssue(req, id(req), valid(req, 'body'));
    ok(res, await svc.getTask(currentUser(req), id(req)), 201);
  },
);
tasksRouter.post(
  '/:id/review',
  authorize(Role.ADMIN),
  withId(reviewTaskSchema),
  async (req, res) => {
    await svc.reviewTask(req, id(req), valid(req, 'body'));
    ok(res, await svc.getTask(currentUser(req), id(req)));
  },
);
tasksRouter.post(
  '/:id/cancel',
  authorize(Role.ADMIN),
  validate({ params: idParamSchema }),
  async (req, res) => {
    await svc.cancelTask(req, id(req));
    ok(res, await svc.getTask(currentUser(req), id(req)));
  },
);
tasksRouter.post(
  '/:id/reopen',
  authorize(Role.ADMIN),
  validate({ params: idParamSchema }),
  async (req, res) => {
    await svc.reopenTask(req, id(req));
    ok(res, await svc.getTask(currentUser(req), id(req)));
  },
);
