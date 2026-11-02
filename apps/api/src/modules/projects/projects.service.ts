import type { Request } from 'express';
import type { Types } from 'mongoose';
import {
  ClientStatus,
  MilestoneStatus,
  NotificationType,
  ProjectStatus,
  Role,
  TaskStatus,
  UserStatus,
  computeProjectProgress,
  type CreateMilestoneInput,
  type CreateProjectInput,
  type ListProjectsQuery,
  type UpdateMilestoneInput,
  type UpdateProjectInput,
} from '@innovexa/shared';
import type { AuthUser } from '../../types/express.js';
import { loadProjectFor, projectScope } from '../../utils/access.js';
import { AppError } from '../../utils/AppError.js';
import { escapeRegex, pageMeta } from '../../utils/http.js';
import { formatCode, nextSequence } from '../../utils/sequence.js';
import { recordAudit } from '../audit-logs/auditLog.service.js';
import { Client } from '../clients/client.model.js';
import { Milestone } from '../milestones/milestone.model.js';
import { notify } from '../notifications/notification.service.js';
import { ServiceCategory } from '../service-categories/serviceCategory.model.js';
import { Task } from '../tasks/task.model.js';
import { User } from '../users/user.model.js';
import { Project } from './project.model.js';

const DONE: string[] = [TaskStatus.APPROVED, TaskStatus.COMPLETED];

export async function clientUserIds(clientId: Types.ObjectId | string): Promise<Types.ObjectId[]> {
  const users = await User.find({
    role: Role.CLIENT,
    clientId,
    status: UserStatus.ACTIVE,
    deletedAt: null,
  })
    .select('_id')
    .lean();
  return users.map((u) => u._id);
}

export async function assertActivePartners(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const count = await User.countDocuments({
    _id: { $in: ids },
    role: Role.PARTNER,
    status: UserStatus.ACTIVE,
    deletedAt: null,
  });
  if (count !== new Set(ids).size)
    throw AppError.badRequest('Every assignee must be an active partner');
}

/**
 * Recomputes project progress from approved task progress (never from client
 * input) and appends a history snapshot when it changes.
 */
export async function recalcProjectProgress(
  projectId: Types.ObjectId | string,
  reason: string,
  taskId?: Types.ObjectId,
) {
  const tasks = await Task.find({ projectId })
    .select('status weight approvedProgress submittedProgress')
    .lean();
  const p = computeProjectProgress(
    tasks.map((t) => ({
      status: t.status,
      weight: t.weight,
      approvedProgress: t.approvedProgress,
      submittedProgress: t.submittedProgress,
    })),
  );
  const project = await Project.findById(projectId);
  if (!project) return;
  const changed =
    project.progress?.approved !== p.approved || project.progress?.submitted !== p.submitted;
  project.set('progress', {
    approved: p.approved,
    submitted: p.submitted,
    calculatedAt: new Date(),
  });
  if (changed) {
    project.progressHistory.push({
      approved: p.approved,
      submitted: p.submitted,
      reason,
      taskId,
      at: new Date(),
    });
    if (project.progressHistory.length > 200)
      project.progressHistory.splice(0, project.progressHistory.length - 200);
  }
  await project.save();
  return p;
}

type ProjectDoc = Awaited<ReturnType<typeof loadProjectFor>>;
type Counts = {
  total: number;
  done: number;
  pending: number;
  overdue: number;
  awaitingReview: number;
};

async function taskCounts(
  projectIds: Types.ObjectId[],
  assigneeId?: Types.ObjectId,
): Promise<Map<string, Counts>> {
  const now = new Date();
  const rows = await Task.aggregate<{ _id: Types.ObjectId } & Counts>([
    {
      $match: {
        projectId: { $in: projectIds },
        status: { $ne: TaskStatus.CANCELLED },
        ...(assigneeId ? { assigneeIds: assigneeId } : {}),
      },
    },
    {
      $group: {
        _id: '$projectId',
        total: { $sum: 1 },
        done: { $sum: { $cond: [{ $in: ['$status', DONE] }, 1, 0] } },
        awaitingReview: {
          $sum: { $cond: [{ $eq: ['$status', TaskStatus.SUBMITTED_FOR_REVIEW] }, 1, 0] },
        },
        overdue: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $not: { $in: ['$status', DONE] } },
                  { $lt: ['$dueDate', now] },
                  { $gt: ['$dueDate', null] },
                ],
              },
              1,
              0,
            ],
          },
        },
      },
    },
  ]);
  return new Map(rows.map((r) => [r._id.toString(), { ...r, pending: r.total - r.done }]));
}

/** Role-specific projection: clients never see budgets, internal notes, partners or unapproved progress. */
export function toProjectView(
  p: ProjectDoc | Record<string, unknown>,
  role: Role,
  counts?: Counts,
) {
  const o = ('toObject' in p && typeof p.toObject === 'function' ? p.toObject() : p) as Record<
    string,
    unknown
  > & {
    _id: Types.ObjectId;
    progress?: { approved?: number; submitted?: number };
    deliverables?: { approvedAt?: Date }[];
    progressHistory?: unknown[];
  };
  const base = {
    id: o._id.toString(),
    projectCode: o.projectCode,
    title: o.title,
    client: o.clientId,
    serviceCategory: o.serviceCategoryId,
    description: o.description,
    requirements: o.requirements,
    startDate: o.startDate,
    expectedEndDate: o.expectedEndDate,
    completedAt: o.completedAt,
    priority: o.priority,
    status: o.status,
    approvedProgress: o.progress?.approved ?? 0,
    taskCounts: counts ?? { total: 0, done: 0, pending: 0, overdue: 0, awaitingReview: 0 },
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
  if (role === Role.CLIENT) {
    return { ...base, deliverables: (o.deliverables ?? []).filter((d) => d.approvedAt) };
  }
  if (role === Role.PARTNER) return { ...base, partners: o.partnerIds };
  return {
    ...base,
    submittedProgress: o.progress?.submitted ?? 0,
    budgetMinor: o.budgetMinor,
    contractAmountMinor: o.contractAmountMinor,
    currency: o.currency,
    partners: o.partnerIds,
    internalNotes: o.internalNotes,
    deliverables: o.deliverables,
    progressHistory: o.progressHistory,
  };
}

const POPULATE_CLIENT_FOR = (role: Role) =>
  role === Role.ADMIN ? 'companyName clientCode contactName email phone' : 'companyName';

export async function listProjects(user: AuthUser, q: ListProjectsQuery) {
  const filter: Record<string, unknown> = { ...projectScope(user) };
  if (q.status) filter.status = q.status;
  if (user.role === Role.ADMIN) {
    if (q.clientId) filter.clientId = q.clientId;
    if (q.partnerId) filter.partnerIds = q.partnerId;
  }
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    filter.$or = [{ title: rx }, { projectCode: rx }];
  }
  const [items, total] = await Promise.all([
    Project.find(filter)
      .sort({ createdAt: -1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .populate('clientId', POPULATE_CLIENT_FOR(user.role))
      .populate('serviceCategoryId', 'name')
      .populate(
        user.role === Role.CLIENT
          ? []
          : [{ path: 'partnerIds', select: 'name email partnerProfile.partnerType' }],
      ),
    Project.countDocuments(filter),
  ]);
  const counts = await taskCounts(
    items.map((i) => i._id),
    user.role === Role.PARTNER ? user._id : undefined,
  );
  return {
    items: items.map((p) => toProjectView(p, user.role, counts.get(p._id.toString()))),
    meta: pageMeta(q.page, q.limit, total),
  };
}

export async function getProject(user: AuthUser, id: string) {
  const project = await loadProjectFor(user, id);
  await project.populate([
    { path: 'clientId', select: POPULATE_CLIENT_FOR(user.role) },
    { path: 'serviceCategoryId', select: 'name' },
    ...(user.role === Role.CLIENT
      ? []
      : [
          {
            path: 'partnerIds',
            select: 'name email partnerProfile.partnerType partnerProfile.category',
          },
        ]),
  ]);
  const [milestones, counts] = await Promise.all([
    listMilestones(user, project._id),
    taskCounts([project._id], user.role === Role.PARTNER ? user._id : undefined),
  ]);
  return { ...toProjectView(project, user.role, counts.get(project._id.toString())), milestones };
}

async function assertClientAndCategory(clientId: string, categoryId: string) {
  const [client, category] = await Promise.all([
    Client.exists({ _id: clientId, status: ClientStatus.ACTIVE, archivedAt: null }),
    ServiceCategory.exists({ _id: categoryId, isActive: true }),
  ]);
  if (!client) throw AppError.badRequest('Select an active client');
  if (!category) throw AppError.badRequest('Select an active service category');
}

export async function createProject(req: Request, input: CreateProjectInput) {
  const admin = req.user!;
  await assertClientAndCategory(input.clientId, input.serviceCategoryId);
  await assertActivePartners(input.partnerIds ?? []);
  const { milestones = [], ...fields } = input;
  const project = await Project.create({
    ...fields,
    projectCode: formatCode('PRJ', await nextSequence('project')),
    status: input.status ?? ProjectStatus.PENDING,
    createdBy: admin._id,
  });
  if (milestones.length) {
    await Milestone.insertMany(
      milestones.map((m, i) => ({ ...m, projectId: project._id, order: i })),
    );
  }
  await recordAudit({
    req,
    action: 'project.created',
    entity: 'Project',
    entityId: project._id,
    after: project,
  });
  const link = (role: string) => `/${role}/projects/${project._id.toString()}`;
  await notify({
    recipients: input.partnerIds ?? [],
    type: NotificationType.PROJECT_CREATED,
    title: `You were added to project ${project.title}`,
    link: link('partner'),
    exclude: admin._id,
  });
  await notify({
    recipients: await clientUserIds(project.clientId),
    type: NotificationType.PROJECT_CREATED,
    title: `Your project "${project.title}" has been set up`,
    body: 'You can now follow its timeline and progress in your client portal.',
    link: link('client'),
    email: true,
  });
  return project;
}

export async function updateProject(req: Request, id: string, input: UpdateProjectInput) {
  const project = await loadProjectFor(req.user!, id);
  const before = project.toObject();
  if (input.clientId || input.serviceCategoryId) {
    await assertClientAndCategory(
      input.clientId ?? project.clientId.toString(),
      input.serviceCategoryId ?? project.serviceCategoryId.toString(),
    );
  }
  if (input.partnerIds) await assertActivePartners(input.partnerIds);
  const addedPartners = (input.partnerIds ?? []).filter(
    (pid) => !project.partnerIds.some((x) => x.equals(pid)),
  );
  project.set(input);
  if (input.status === ProjectStatus.COMPLETED && !project.completedAt)
    project.completedAt = new Date();
  if (input.status && input.status !== ProjectStatus.COMPLETED) project.completedAt = undefined;
  if (project.expectedEndDate < project.startDate)
    throw AppError.badRequest('Expected completion must be on or after the start date');
  await project.save();
  await recordAudit({
    req,
    action: 'project.updated',
    entity: 'Project',
    entityId: project._id,
    before,
    after: project,
  });
  await notify({
    recipients: addedPartners,
    type: NotificationType.PROJECT_CREATED,
    title: `You were added to project ${project.title}`,
    link: `/partner/projects/${project._id.toString()}`,
  });
  if (input.status && input.status !== before.status) {
    await notify({
      recipients: await clientUserIds(project.clientId),
      type: NotificationType.PROJECT_CREATED,
      title: `Project "${project.title}" is now ${input.status.toLowerCase().replace('_', ' ')}`,
      link: `/client/projects/${project._id.toString()}`,
    });
  }
  return project;
}

/* -------------------------------- Milestones -------------------------------- */

export async function listMilestones(user: AuthUser, projectId: Types.ObjectId | string) {
  await loadProjectFor(user, projectId);
  const filter: Record<string, unknown> = { projectId };
  if (user.role === Role.CLIENT) filter.clientVisible = true;
  const items = await Milestone.find(filter).sort({ order: 1, createdAt: 1 }).lean();
  return items.map((m) => ({
    id: m._id.toString(),
    title: m.title,
    description: m.description,
    order: m.order,
    dueDate: m.dueDate,
    status: m.status,
    completedAt: m.completedAt,
    clientVisible: m.clientVisible,
  }));
}

export async function createMilestone(
  req: Request,
  projectId: string,
  input: CreateMilestoneInput,
) {
  const project = await loadProjectFor(req.user!, projectId);
  const last = await Milestone.findOne({ projectId }).sort({ order: -1 }).select('order').lean();
  const milestone = await Milestone.create({
    ...input,
    projectId: project._id,
    order: (last?.order ?? -1) + 1,
  });
  await recordAudit({
    req,
    action: 'milestone.created',
    entity: 'Milestone',
    entityId: milestone._id,
    after: milestone,
  });
  return milestone;
}

export async function updateMilestone(req: Request, id: string, input: UpdateMilestoneInput) {
  const milestone = await Milestone.findById(id);
  if (!milestone) throw AppError.notFound('Milestone');
  const project = await loadProjectFor(req.user!, milestone.projectId);
  const before = milestone.toObject();
  milestone.set(input);
  if (input.status === MilestoneStatus.COMPLETED && !milestone.completedAt)
    milestone.completedAt = new Date();
  if (input.status && input.status !== MilestoneStatus.COMPLETED) milestone.completedAt = undefined;
  await milestone.save();
  await recordAudit({
    req,
    action: 'milestone.updated',
    entity: 'Milestone',
    entityId: milestone._id,
    before,
    after: milestone,
  });
  if (
    input.status === MilestoneStatus.COMPLETED &&
    before.status !== MilestoneStatus.COMPLETED &&
    milestone.clientVisible
  ) {
    await notify({
      recipients: await clientUserIds(project.clientId),
      type: NotificationType.MILESTONE_COMPLETED,
      title: `Milestone completed: ${milestone.title}`,
      body: `A milestone in "${project.title}" has been completed.`,
      link: `/client/projects/${project._id.toString()}`,
      email: true,
    });
  }
  return milestone;
}

export async function deleteMilestone(req: Request, id: string) {
  const milestone = await Milestone.findById(id);
  if (!milestone) throw AppError.notFound('Milestone');
  await loadProjectFor(req.user!, milestone.projectId);
  await Task.updateMany({ milestoneId: milestone._id }, { $unset: { milestoneId: 1 } });
  await milestone.deleteOne();
  await recordAudit({
    req,
    action: 'milestone.deleted',
    entity: 'Milestone',
    entityId: milestone._id,
    before: milestone,
  });
}

/* -------------------------- Client-facing work view -------------------------- */

/** Approved (completed) and pending work for a project, without internal details. */
export async function projectWork(user: AuthUser, projectId: string) {
  const project = await loadProjectFor(user, projectId);
  const tasks = await Task.find({ projectId: project._id, status: { $ne: TaskStatus.CANCELLED } })
    .select('title status approvedProgress dueDate approvedAt milestoneId updatedAt')
    .sort({ dueDate: 1 })
    .lean();
  const view = (t: (typeof tasks)[number]) => ({
    id: t._id.toString(),
    title: t.title,
    approvedProgress: t.approvedProgress,
    dueDate: t.dueDate,
    approvedAt: t.approvedAt,
    milestoneId: t.milestoneId?.toString(),
    // Clients see a simplified state rather than internal review statuses.
    state: DONE.includes(t.status)
      ? 'COMPLETED'
      : t.approvedProgress > 0
        ? 'IN_PROGRESS'
        : 'NOT_STARTED',
  });
  return {
    completed: tasks.filter((t) => DONE.includes(t.status)).map(view),
    pending: tasks.filter((t) => !DONE.includes(t.status)).map(view),
  };
}

export async function projectTimeline(user: AuthUser, projectId: string) {
  const project = await loadProjectFor(user, projectId);
  const milestones = await listMilestones(user, project._id);
  const completed = milestones.filter((m) => m.status === MilestoneStatus.COMPLETED);
  return {
    project: {
      id: project._id.toString(),
      title: project.title,
      projectCode: project.projectCode,
      status: project.status,
      startDate: project.startDate,
      expectedEndDate: project.expectedEndDate,
      completedAt: project.completedAt,
      approvedProgress: project.progress?.approved ?? 0,
    },
    milestones,
    totals: {
      total: milestones.length,
      completed: completed.length,
      pending: milestones.length - completed.length,
      current: milestones.find((m) => m.status !== MilestoneStatus.COMPLETED) ?? null,
    },
    // Approved progress changes only — what the client is allowed to see.
    history: project.progressHistory
      .filter((h, i, all) => i === 0 || h.approved !== all[i - 1]!.approved)
      .map((h) => ({ approved: h.approved, at: h.at })),
  };
}
