import { Router, type Request } from 'express';
import type { z } from 'zod';
import {
  ChangeRequestStatus,
  NotificationType,
  Role,
  TaskStatus,
  changeOrderSchema,
  changeRequestResponseSchema,
  changeRequestStatusSchema,
  convertChangeRequestSchema,
  createChangeRequestSchema,
  formatMoney,
  idParamSchema,
  listChangeRequestsQuerySchema,
  type CreateChangeRequestInput,
} from '@innovexa/shared';
import { authenticate, currentUser } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { valid, validate } from '../../middleware/validate';
import type { AuthUser } from '../../types/express';
import { loadProjectFor } from '../../utils/access';
import { AppError } from '../../utils/AppError';
import { ok, pageMeta } from '../../utils/http';
import { formatCode, nextSequence } from '../../utils/sequence';
import { recordAudit } from '../audit-logs/auditLog.service';
import { FileModel } from '../files/file.model';
import { notify, notifyAdmins } from '../notifications/notification.service';
import { Project } from '../projects/project.model';
import { clientUserIds } from '../projects/projects.service';
import { createTask } from '../tasks/tasks.service';
import { ChangeRequest } from './changeRequest.model';

function scope(user: AuthUser) {
  if (user.role === Role.ADMIN) return {};
  if (user.role === Role.CLIENT) return { clientId: user.clientId ?? null };
  throw AppError.forbidden();
}

async function load(user: AuthUser, id: string) {
  const cr = await ChangeRequest.findOne({ _id: id, ...scope(user) });
  if (!cr) throw AppError.notFound('Change request');
  return cr;
}

async function view(user: AuthUser, id: string) {
  const cr = await ChangeRequest.findOne({ _id: id, ...scope(user) })
    .populate('projectId', 'title projectCode contractAmountMinor')
    .populate('clientId', 'companyName')
    .populate('submittedBy', 'name')
    .populate('history.by', 'name role')
    .populate('responses.authorId', 'name role')
    .lean();
  if (!cr) throw AppError.notFound('Change request');
  const files = await FileModel.find({ _id: { $in: cr.attachmentIds } })
    .select('originalName size')
    .lean();
  const project = cr.projectId as unknown as { contractAmountMinor?: number } | null;
  if (user.role !== Role.ADMIN && project) delete project.contractAmountMinor;
  return {
    ...cr,
    id: cr._id.toString(),
    attachments: files.map((f) => ({
      id: f._id.toString(),
      name: f.originalName,
      size: f.size,
      url: `/api/v1/files/${f._id.toString()}/download`,
    })),
  };
}

const counterpart = async (
  req: Request,
  cr: { clientId: unknown; _id: unknown; requestCode: string },
  title: string,
  body?: string,
) => {
  const isClient = req.user!.role === Role.CLIENT;
  const link = (role: string) => `/${role}/change-requests/${String(cr._id)}`;
  if (isClient)
    await notifyAdmins({ type: NotificationType.CHANGE_REQUEST, title, body, link: link('admin') });
  else
    await notify({
      recipients: await clientUserIds(String(cr.clientId)),
      type: NotificationType.CHANGE_REQUEST,
      title,
      body,
      link: link('client'),
      email: true,
    });
};

export const changeRequestsRouter = Router();
changeRequestsRouter.use(authenticate, authorize(Role.ADMIN, Role.CLIENT));

changeRequestsRouter.get(
  '/',
  validate({ query: listChangeRequestsQuerySchema }),
  async (req, res) => {
    const user = currentUser(req);
    const q = valid<z.infer<typeof listChangeRequestsQuerySchema>>(req, 'query');
    const filter: Record<string, unknown> = { ...scope(user) };
    if (q.projectId) filter.projectId = q.projectId;
    if (q.status) filter.status = q.status;
    const [items, total] = await Promise.all([
      ChangeRequest.find(filter)
        .sort({ createdAt: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .populate('projectId', 'title projectCode')
        .populate('clientId', 'companyName')
        .select('-history -responses')
        .lean(),
      ChangeRequest.countDocuments(filter),
    ]);
    ok(
      res,
      items.map((c) => ({ ...c, id: c._id.toString() })),
      200,
      pageMeta(q.page, q.limit, total),
    );
  },
);

changeRequestsRouter.post(
  '/',
  authorize(Role.CLIENT),
  validate({ body: createChangeRequestSchema }),
  async (req, res) => {
    const user = currentUser(req);
    const input = valid<CreateChangeRequestInput>(req, 'body');
    const project = await loadProjectFor(user, input.projectId);
    const cr = await ChangeRequest.create({
      ...input,
      requestCode: formatCode('CR', await nextSequence('change-request')),
      clientId: project.clientId,
      submittedBy: user._id,
      history: [{ status: ChangeRequestStatus.SUBMITTED, by: user._id }],
    });
    await recordAudit({
      req,
      action: 'change_request.submitted',
      entity: 'ChangeRequest',
      entityId: cr._id,
    });
    await counterpart(
      req,
      cr,
      `New change request ${cr.requestCode}: ${cr.title}`,
      `Project: ${project.title}`,
    );
    ok(res, await view(user, cr._id.toString()), 201);
  },
);

changeRequestsRouter.get('/:id', validate({ params: idParamSchema }), async (req, res) => {
  ok(res, await view(currentUser(req), valid<{ id: string }>(req, 'params').id));
});

changeRequestsRouter.patch(
  '/:id/status',
  authorize(Role.ADMIN),
  validate({ params: idParamSchema, body: changeRequestStatusSchema }),
  async (req, res) => {
    const user = currentUser(req);
    const cr = await load(user, valid<{ id: string }>(req, 'params').id);
    const { status, note } = valid<z.infer<typeof changeRequestStatusSchema>>(req, 'body');
    if (status === ChangeRequestStatus.CONVERTED_TO_TASK)
      throw AppError.badRequest('Use "Convert to task" instead');
    cr.status = status;
    cr.history.push({ status, by: user._id, note, at: new Date() });
    await cr.save();
    await recordAudit({
      req,
      action: 'change_request.status',
      entity: 'ChangeRequest',
      entityId: cr._id,
      after: { status, note },
    });
    await counterpart(
      req,
      cr,
      `Change request ${cr.requestCode} is now ${status.toLowerCase().replace(/_/g, ' ')}`,
      note,
    );
    ok(res, await view(user, cr._id.toString()));
  },
);

changeRequestsRouter.post(
  '/:id/responses',
  validate({ params: idParamSchema, body: changeRequestResponseSchema }),
  async (req, res) => {
    const user = currentUser(req);
    const cr = await load(user, valid<{ id: string }>(req, 'params').id);
    const { body } = valid<{ body: string }>(req, 'body');
    cr.responses.push({ authorId: user._id, body, at: new Date() });
    if (user.role === Role.CLIENT && cr.status === ChangeRequestStatus.NEED_CLARIFICATION) {
      cr.status = ChangeRequestStatus.UNDER_REVIEW;
      cr.history.push({ status: cr.status, by: user._id, note: 'Client replied', at: new Date() });
    }
    await cr.save();
    await counterpart(req, cr, `New reply on ${cr.requestCode}`, body.slice(0, 200));
    ok(res, await view(user, cr._id.toString()), 201);
  },
);

/** A change order affects the contract amount only once an admin approves it here. */
changeRequestsRouter.post(
  '/:id/change-order',
  authorize(Role.ADMIN),
  validate({ params: idParamSchema, body: changeOrderSchema }),
  async (req, res) => {
    const user = currentUser(req);
    const cr = await load(user, valid<{ id: string }>(req, 'params').id);
    if (cr.changeOrder?.approvedAt)
      throw AppError.conflict('A change order was already approved for this request');
    const { amountMinor, description } = valid<z.infer<typeof changeOrderSchema>>(req, 'body');
    const project = await Project.findById(cr.projectId);
    if (!project) throw AppError.notFound('Project');
    const before = project.contractAmountMinor;
    project.contractAmountMinor += amountMinor;
    await project.save();
    cr.set('changeOrder', {
      amountMinor,
      description,
      approvedBy: user._id,
      approvedAt: new Date(),
    });
    if (cr.status !== ChangeRequestStatus.COMPLETED) {
      cr.status = ChangeRequestStatus.ACCEPTED;
      cr.history.push({
        status: cr.status,
        by: user._id,
        note: `Change order approved: ${formatMoney(amountMinor)}`,
        at: new Date(),
      });
    }
    await cr.save();
    await recordAudit({
      req,
      action: 'change_request.change_order_approved',
      entity: 'Project',
      entityId: project._id,
      before: { contractAmountMinor: before },
      after: { contractAmountMinor: project.contractAmountMinor, changeRequestId: cr._id },
    });
    await counterpart(
      req,
      cr,
      `Change order approved for ${cr.requestCode}`,
      `${description} — ${formatMoney(amountMinor)}`,
    );
    ok(res, await view(user, cr._id.toString()));
  },
);

changeRequestsRouter.post(
  '/:id/convert-to-task',
  authorize(Role.ADMIN),
  validate({ params: idParamSchema, body: convertChangeRequestSchema }),
  async (req, res) => {
    const user = currentUser(req);
    const cr = await load(user, valid<{ id: string }>(req, 'params').id);
    if (cr.taskId) throw AppError.conflict('This request was already converted to a task');
    const input = valid<z.infer<typeof convertChangeRequestSchema>>(req, 'body');
    const task = await createTask(req, {
      projectId: cr.projectId.toString(),
      title: input.title ?? `${cr.requestCode}: ${cr.title}`,
      description: cr.description,
      assigneeIds: input.assigneeIds,
      dueDate: input.dueDate,
      weight: input.weight,
    });
    cr.taskId = task._id;
    cr.status = ChangeRequestStatus.CONVERTED_TO_TASK;
    cr.history.push({
      status: cr.status,
      by: user._id,
      note: `Task created: ${task.title}`,
      at: new Date(),
    });
    await cr.save();
    await counterpart(req, cr, `Change request ${cr.requestCode} has been scheduled as work`);
    ok(res, {
      ...(await view(user, cr._id.toString())),
      task: { id: task._id.toString(), status: TaskStatus.ASSIGNED },
    });
  },
);
