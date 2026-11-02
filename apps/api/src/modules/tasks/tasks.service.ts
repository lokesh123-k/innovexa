import type { Request } from 'express';
import type { Types } from 'mongoose';
import {
  FileScope,
  NotificationType,
  ReviewStatus,
  Role,
  TaskStatus,
  TaskUpdateKind,
  type CreateTaskInput,
  type ListTasksQuery,
  type ProgressUpdateInput,
  type ReviewTaskInput,
  type SubmitTaskInput,
  type TaskIssueInput,
  type UpdateTaskInput,
} from '@innovexa/shared';
import type { AuthUser } from '../../types/express.js';
import { loadProjectFor, loadTaskFor, taskScope } from '../../utils/access.js';
import { AppError } from '../../utils/AppError.js';
import { escapeRegex, pageMeta } from '../../utils/http.js';
import { recordAudit } from '../audit-logs/auditLog.service.js';
import { assertOwnAttachments } from '../files/files.service.js';
import { FileModel } from '../files/file.model.js';
import { Milestone } from '../milestones/milestone.model.js';
import { notify, notifyAdmins } from '../notifications/notification.service.js';
import { Project } from '../projects/project.model.js';
import { assertActivePartners, recalcProjectProgress } from '../projects/projects.service.js';
import { TaskUpdate } from '../task-updates/taskUpdate.model.js';
import { Task } from './task.model.js';

const DONE: string[] = [TaskStatus.APPROVED, TaskStatus.COMPLETED];
/** Statuses in which an assigned partner may report progress or submit. */
const WORKABLE: string[] = [
  TaskStatus.NOT_STARTED,
  TaskStatus.ASSIGNED,
  TaskStatus.IN_PROGRESS,
  TaskStatus.REVISION_REQUESTED,
];

type TaskDoc = Awaited<ReturnType<typeof loadTaskFor>>;

export function toTaskView(t: TaskDoc | Record<string, unknown>, role: Role) {
  const o = ('toObject' in t && typeof t.toObject === 'function' ? t.toObject() : t) as Record<
    string,
    unknown
  > & {
    _id: Types.ObjectId;
    dueDate?: Date;
    status: string;
  };
  return {
    id: o._id.toString(),
    project: o.projectId,
    milestoneId: o.milestoneId ? String(o.milestoneId) : undefined,
    title: o.title,
    description: o.description,
    instructions: o.instructions,
    expectedDeliverables: o.expectedDeliverables,
    assignees: o.assigneeIds,
    priority: o.priority,
    status: o.status,
    startDate: o.startDate,
    dueDate: o.dueDate,
    estimatedHours: o.estimatedHours,
    weight: o.weight,
    submittedProgress: o.submittedProgress,
    approvedProgress: o.approvedProgress,
    loggedMinutes: o.loggedMinutes,
    attachmentIds: o.attachmentIds,
    // Admin feedback is shown to the assigned partner.
    reviewNotes: o.reviewNotes,
    approvedAt: o.approvedAt,
    isOverdue:
      !!o.dueDate &&
      o.dueDate < new Date() &&
      !DONE.includes(o.status) &&
      o.status !== TaskStatus.CANCELLED,
    ...(role === Role.ADMIN ? { createdBy: o.createdBy } : {}),
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}

const POPULATE = [
  { path: 'projectId', select: 'title projectCode status' },
  { path: 'assigneeIds', select: 'name email partnerProfile.partnerType' },
];

export async function listTasks(user: AuthUser, q: ListTasksQuery) {
  const filter: Record<string, unknown> = { ...taskScope(user) };
  if (q.projectId) filter.projectId = q.projectId;
  if (q.assigneeId && user.role === Role.ADMIN) filter.assigneeIds = q.assigneeId;
  if (q.status?.length) filter.status = { $in: q.status };
  if (q.overdue) {
    filter.dueDate = { $lt: new Date() };
    filter.status = {
      $in: (q.status?.length
        ? q.status
        : WORKABLE.concat(TaskStatus.SUBMITTED_FOR_REVIEW, TaskStatus.ON_HOLD)
      ).filter((s) => !DONE.includes(s)),
    };
  }
  if (q.q) filter.title = new RegExp(escapeRegex(q.q), 'i');
  const [items, total] = await Promise.all([
    Task.find(filter)
      .sort({ dueDate: 1, createdAt: -1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .populate(POPULATE)
      .lean(),
    Task.countDocuments(filter),
  ]);
  return {
    items: items.map((t) => toTaskView(t, user.role)),
    meta: pageMeta(q.page, q.limit, total),
  };
}

export async function getTask(user: AuthUser, id: string) {
  const task = await loadTaskFor(user, id);
  await task.populate(POPULATE);
  const [updates, attachments] = await Promise.all([
    TaskUpdate.find({ taskId: task._id })
      .sort({ createdAt: -1 })
      .populate('partnerId', 'name')
      .populate('reviewedBy', 'name')
      .lean(),
    FileModel.find({ _id: { $in: task.attachmentIds } })
      .select('originalName mimeType size createdAt')
      .lean(),
  ]);
  return {
    ...toTaskView(task, user.role),
    attachments: attachments.map((f) => ({
      id: f._id.toString(),
      name: f.originalName,
      size: f.size,
      url: `/api/v1/files/${f._id.toString()}/download`,
    })),
    updates: await Promise.all(updates.map(updateView)),
  };
}

async function updateView(
  u: Record<string, unknown> & { _id: Types.ObjectId; attachmentIds: Types.ObjectId[] },
) {
  const files = u.attachmentIds.length
    ? await FileModel.find({ _id: { $in: u.attachmentIds } })
        .select('originalName size')
        .lean()
    : [];
  return {
    id: u._id.toString(),
    kind: u.kind,
    partner: u.partnerId,
    previousProgress: u.previousProgress,
    newProgress: u.newProgress,
    description: u.description,
    minutesSpent: u.minutesSpent,
    reviewStatus: u.reviewStatus,
    reviewedBy: u.reviewedBy,
    reviewedAt: u.reviewedAt,
    reviewComment: u.reviewComment,
    attachments: files.map((f) => ({
      id: f._id.toString(),
      name: f.originalName,
      size: f.size,
      url: `/api/v1/files/${f._id.toString()}/download`,
    })),
    createdAt: u.createdAt,
  };
}

async function assertMilestone(projectId: Types.ObjectId, milestoneId?: string | null) {
  if (milestoneId && !(await Milestone.exists({ _id: milestoneId, projectId }))) {
    throw AppError.badRequest('Milestone does not belong to this project');
  }
}

async function allocatePartners(
  projectId: Types.ObjectId,
  partnerIds: readonly (string | Types.ObjectId)[],
) {
  if (partnerIds.length)
    await Project.updateOne(
      { _id: projectId },
      { $addToSet: { partnerIds: { $each: partnerIds } } },
    );
}

async function notifyAssigned(
  task: TaskDoc,
  ids: readonly (string | Types.ObjectId)[],
  adminId: Types.ObjectId,
) {
  await notify({
    recipients: ids,
    type: NotificationType.TASK_ASSIGNED,
    title: `New task assigned: ${task.title}`,
    body: task.dueDate ? `Due ${task.dueDate.toDateString()}` : undefined,
    link: `/partner/tasks/${task._id.toString()}`,
    email: true,
    exclude: adminId,
  });
}

export async function createTask(req: Request, input: CreateTaskInput) {
  const admin = req.user!;
  const project = await loadProjectFor(admin, input.projectId);
  await assertMilestone(project._id, input.milestoneId);
  const assignees = input.assigneeIds ?? [];
  await assertActivePartners(assignees);
  const task = await Task.create({
    ...input,
    milestoneId: input.milestoneId ?? undefined,
    assigneeIds: assignees,
    status: assignees.length ? TaskStatus.ASSIGNED : TaskStatus.NOT_STARTED,
    createdBy: admin._id,
  });
  await allocatePartners(project._id, assignees);
  await recalcProjectProgress(project._id, 'Task added', task._id);
  await recordAudit({
    req,
    action: 'task.created',
    entity: 'Task',
    entityId: task._id,
    after: task,
  });
  await notifyAssigned(task, assignees, admin._id);
  return task;
}

export async function updateTask(req: Request, id: string, input: UpdateTaskInput) {
  const task = await loadTaskFor(req.user!, id);
  if (task.status === TaskStatus.CANCELLED)
    throw AppError.badRequest('Reopen the task before editing it');
  const before = task.toObject();
  if (input.milestoneId !== undefined) await assertMilestone(task.projectId, input.milestoneId);
  task.set({
    ...input,
    milestoneId: input.milestoneId === null ? undefined : (input.milestoneId ?? task.milestoneId),
  });
  if (input.dueDate) {
    task.dueSoonNotifiedAt = undefined;
    task.overdueNotifiedAt = undefined;
  }
  await task.save();
  if (input.weight !== undefined || input.status !== undefined)
    await recalcProjectProgress(task.projectId, 'Task updated', task._id);
  await recordAudit({
    req,
    action: 'task.updated',
    entity: 'Task',
    entityId: task._id,
    before,
    after: task,
  });
  return task;
}

export async function assignTask(req: Request, id: string, assigneeIds: string[]) {
  const task = await loadTaskFor(req.user!, id);
  if (task.status === TaskStatus.CANCELLED)
    throw AppError.badRequest('Reopen the task before assigning it');
  await assertActivePartners(assigneeIds);
  const before = task.assigneeIds.map(String);
  const added = assigneeIds.filter((a) => !before.includes(a));
  task.set('assigneeIds', assigneeIds);
  if (assigneeIds.length && task.status === TaskStatus.NOT_STARTED)
    task.status = TaskStatus.ASSIGNED;
  if (!assigneeIds.length && task.status === TaskStatus.ASSIGNED)
    task.status = TaskStatus.NOT_STARTED;
  await task.save();
  await allocatePartners(task.projectId, assigneeIds);
  await recordAudit({
    req,
    action: 'task.assigned',
    entity: 'Task',
    entityId: task._id,
    before: { assigneeIds: before },
    after: { assigneeIds },
  });
  await notifyAssigned(task, added, req.user!._id);
  return task;
}

function assertWorkable(task: TaskDoc) {
  if (!WORKABLE.includes(task.status)) {
    throw AppError.conflict(
      task.status === TaskStatus.SUBMITTED_FOR_REVIEW
        ? 'This task is awaiting review'
        : `Updates are not allowed while the task is ${task.status.toLowerCase().replace(/_/g, ' ')}`,
      'TASK_NOT_WORKABLE',
    );
  }
}

/** Partner progress update. Never changes approved (client-visible) progress. */
export async function addProgressUpdate(req: Request, id: string, input: ProgressUpdateInput) {
  const partner = req.user!;
  const task = await loadTaskFor(partner, id);
  assertWorkable(task);
  await assertOwnAttachments(partner, input.attachmentIds, FileScope.TASK, task._id);
  const update = await TaskUpdate.create({
    taskId: task._id,
    projectId: task.projectId,
    partnerId: partner._id,
    kind: TaskUpdateKind.PROGRESS,
    previousProgress: task.submittedProgress,
    newProgress: input.newProgress,
    description: input.description,
    minutesSpent: input.minutesSpent,
    attachmentIds: input.attachmentIds,
  });
  task.submittedProgress = input.newProgress;
  task.loggedMinutes += input.minutesSpent;
  task.status = TaskStatus.IN_PROGRESS;
  await task.save();
  await recalcProjectProgress(task.projectId, 'Progress reported', task._id);
  await notifyAdmins({
    type: NotificationType.PROGRESS_UPDATED,
    title: `${partner.name} updated "${task.title}" to ${input.newProgress}%`,
    link: `/admin/tasks/${task._id.toString()}`,
  });
  return update;
}

export async function submitTask(req: Request, id: string, input: SubmitTaskInput) {
  const partner = req.user!;
  const task = await loadTaskFor(partner, id);
  assertWorkable(task);
  await assertOwnAttachments(partner, input.attachmentIds, FileScope.TASK, task._id);
  const update = await TaskUpdate.create({
    taskId: task._id,
    projectId: task.projectId,
    partnerId: partner._id,
    kind: TaskUpdateKind.SUBMISSION,
    previousProgress: task.submittedProgress,
    newProgress: input.newProgress,
    description: input.description,
    minutesSpent: input.minutesSpent,
    attachmentIds: input.attachmentIds,
  });
  task.submittedProgress = input.newProgress;
  task.loggedMinutes += input.minutesSpent;
  task.status = TaskStatus.SUBMITTED_FOR_REVIEW;
  await task.save();
  await recalcProjectProgress(task.projectId, 'Work submitted', task._id);
  await notifyAdmins({
    type: NotificationType.WORK_SUBMITTED,
    title: `Work submitted for review: ${task.title}`,
    body: `${partner.name} submitted ${input.newProgress}% for approval.`,
    link: `/admin/approvals`,
    email: true,
  });
  return update;
}

export async function reportIssue(req: Request, id: string, input: TaskIssueInput) {
  const partner = req.user!;
  const task = await loadTaskFor(partner, id);
  const update = await TaskUpdate.create({
    taskId: task._id,
    projectId: task.projectId,
    partnerId: partner._id,
    kind: input.kind === 'ISSUE' ? TaskUpdateKind.ISSUE : TaskUpdateKind.CLARIFICATION,
    previousProgress: task.submittedProgress,
    newProgress: task.submittedProgress,
    description: input.description,
    reviewStatus: ReviewStatus.PENDING,
  });
  await notifyAdmins({
    type: NotificationType.PROGRESS_UPDATED,
    title: `${input.kind === 'ISSUE' ? 'Problem reported' : 'Clarification requested'} on "${task.title}"`,
    body: input.description.slice(0, 200),
    link: `/admin/tasks/${task._id.toString()}`,
  });
  return update;
}

/** Admin review. Only this path moves approved progress, which feeds the client view. */
export async function reviewTask(req: Request, id: string, input: ReviewTaskInput) {
  const admin = req.user!;
  const task = await loadTaskFor(admin, id);
  if (task.status !== TaskStatus.SUBMITTED_FOR_REVIEW) {
    throw AppError.conflict('Only submitted work can be reviewed', 'NOT_SUBMITTED');
  }
  if (task.assigneeIds.some((a) => a.equals(admin._id)))
    throw AppError.forbidden('You cannot review your own work');
  const submission = await TaskUpdate.findOne({
    taskId: task._id,
    kind: TaskUpdateKind.SUBMISSION,
    reviewStatus: ReviewStatus.PENDING,
  }).sort({ createdAt: -1 });
  const now = new Date();
  const before = task.toObject();

  if (input.decision === 'APPROVE') {
    const approved = input.approvedProgress ?? task.submittedProgress;
    if (approved > task.submittedProgress)
      throw AppError.badRequest('Approved progress cannot exceed the submitted progress');
    task.approvedProgress = approved;
    task.status = approved === 100 ? TaskStatus.APPROVED : TaskStatus.IN_PROGRESS;
    if (approved === 100) {
      task.approvedAt = now;
      task.approvedBy = admin._id;
    }
    task.reviewNotes.push({
      reviewerId: admin._id,
      decision: 'APPROVED',
      approvedProgress: approved,
      comment: input.comment,
      at: now,
    });
    await TaskUpdate.updateMany(
      {
        taskId: task._id,
        kind: { $in: [TaskUpdateKind.PROGRESS, TaskUpdateKind.SUBMISSION] },
        reviewStatus: ReviewStatus.PENDING,
      },
      {
        $set: {
          reviewStatus: ReviewStatus.APPROVED,
          reviewedBy: admin._id,
          reviewedAt: now,
          reviewComment: input.comment,
        },
      },
    );
  } else {
    task.status = TaskStatus.REVISION_REQUESTED;
    task.reviewNotes.push({
      reviewerId: admin._id,
      decision: 'REVISION_REQUESTED',
      comment: input.comment,
      at: now,
    });
    if (submission) {
      submission.set({
        reviewStatus: ReviewStatus.REJECTED,
        reviewedBy: admin._id,
        reviewedAt: now,
        reviewComment: input.comment,
      });
      await submission.save();
    }
  }
  await task.save();
  await recalcProjectProgress(
    task.projectId,
    input.decision === 'APPROVE' ? 'Work approved' : 'Revision requested',
    task._id,
  );
  await recordAudit({
    req,
    action: `task.review.${input.decision.toLowerCase()}`,
    entity: 'Task',
    entityId: task._id,
    before,
    after: task,
  });
  await notify({
    recipients: task.assigneeIds,
    type:
      input.decision === 'APPROVE'
        ? NotificationType.WORK_APPROVED
        : NotificationType.REVISION_REQUESTED,
    title:
      input.decision === 'APPROVE'
        ? `Work approved: ${task.title}`
        : `Revision requested: ${task.title}`,
    body: input.comment,
    link: `/partner/tasks/${task._id.toString()}`,
    email: true,
  });
  return task;
}

export async function cancelTask(req: Request, id: string) {
  const task = await loadTaskFor(req.user!, id);
  if (task.status === TaskStatus.CANCELLED) return task;
  task.status = TaskStatus.CANCELLED;
  task.cancelledAt = new Date();
  await task.save();
  await recalcProjectProgress(task.projectId, 'Task cancelled', task._id);
  await recordAudit({ req, action: 'task.cancelled', entity: 'Task', entityId: task._id });
  return task;
}

export async function reopenTask(req: Request, id: string) {
  const task = await loadTaskFor(req.user!, id);
  if (
    ![TaskStatus.CANCELLED, TaskStatus.APPROVED, TaskStatus.COMPLETED].includes(
      task.status as never,
    )
  ) {
    throw AppError.conflict('Only cancelled or finished tasks can be reopened');
  }
  task.status = task.assigneeIds.length ? TaskStatus.ASSIGNED : TaskStatus.NOT_STARTED;
  task.cancelledAt = undefined;
  task.approvedAt = undefined;
  await task.save();
  await recalcProjectProgress(task.projectId, 'Task reopened', task._id);
  await recordAudit({ req, action: 'task.reopened', entity: 'Task', entityId: task._id });
  return task;
}

/** Admin approval queue: submissions awaiting review. */
export async function reviewQueue() {
  const tasks = await Task.find({ status: TaskStatus.SUBMITTED_FOR_REVIEW })
    .sort({ updatedAt: 1 })
    .populate(POPULATE)
    .lean();
  const subs = await TaskUpdate.find({
    taskId: { $in: tasks.map((t) => t._id) },
    kind: TaskUpdateKind.SUBMISSION,
    reviewStatus: ReviewStatus.PENDING,
  })
    .sort({ createdAt: -1 })
    .populate('partnerId', 'name')
    .lean();
  const latest = new Map<string, (typeof subs)[number]>();
  for (const s of subs) if (!latest.has(s.taskId.toString())) latest.set(s.taskId.toString(), s);
  return Promise.all(
    tasks.map(async (t) => {
      const s = latest.get(t._id.toString());
      return { task: toTaskView(t, Role.ADMIN), submission: s ? await updateView(s) : null };
    }),
  );
}

/** Partner: own updates across tasks (work submissions page / time tracking). */
export async function myUpdates(
  user: AuthUser,
  q: { page: number; limit: number; kind?: string; from?: Date; to?: Date },
) {
  const filter: Record<string, unknown> = { partnerId: user._id };
  if (q.kind) filter.kind = q.kind;
  if (q.from || q.to)
    filter.createdAt = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
  const [items, total] = await Promise.all([
    TaskUpdate.find(filter)
      .sort({ createdAt: -1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .populate({
        path: 'taskId',
        select: 'title status projectId',
        populate: { path: 'projectId', select: 'title projectCode' },
      })
      .lean(),
    TaskUpdate.countDocuments(filter),
  ]);
  return {
    items: await Promise.all(
      items.map(async (u) => ({ ...(await updateView(u)), task: u.taskId })),
    ),
    meta: pageMeta(q.page, q.limit, total),
  };
}
