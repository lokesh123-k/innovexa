import { Router } from 'express';
import type { Types } from 'mongoose';
import {
  ClientStatus,
  MilestoneStatus,
  PaymentStatus,
  ProjectStatus,
  Role,
  TaskStatus,
  UserStatus,
  idParamSchema,
} from '@innovexa/shared';
import { env } from '../../config/env';
import { authenticate, currentUser } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { valid, validate } from '../../middleware/validate';
import { AppError } from '../../utils/AppError';
import { ok } from '../../utils/http';
import { AuditLog } from '../audit-logs/auditLog.model';
import { Client } from '../clients/client.model';
import { Message } from '../messages/message.model';
import { Milestone } from '../milestones/milestone.model';
import { billingTotals, gatewayConfig, upcomingInstallments } from '../invoices/billing.service';
import { Payment } from '../payments/payment.model';
import { Project } from '../projects/project.model';
import { Task } from '../tasks/task.model';
import { TaskUpdate } from '../task-updates/taskUpdate.model';
import { User } from '../users/user.model';
import { toUserDTO } from '../users/user.serializer';
import { WorkReport } from './workReport.model';
import { MailDeliveryError, fromAddress, sendMail, verifyMailer } from '../../utils/mailer';

const DONE = [TaskStatus.APPROVED, TaskStatus.COMPLETED];
const OPEN_PROJECT = [ProjectStatus.PENDING, ProjectStatus.ACTIVE, ProjectStatus.ON_HOLD];
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const pct = (num: number, den: number) => (den ? Math.round((num / den) * 1000) / 10 : 0);

async function taskStats(match: Record<string, unknown>) {
  const now = new Date();
  const [row] = await Task.aggregate<{
    total: number;
    done: number;
    awaitingReview: number;
    revision: number;
    overdue: number;
    inProgress: number;
  }>([
    { $match: { ...match, status: { $ne: TaskStatus.CANCELLED } } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        done: { $sum: { $cond: [{ $in: ['$status', DONE] }, 1, 0] } },
        awaitingReview: {
          $sum: { $cond: [{ $eq: ['$status', TaskStatus.SUBMITTED_FOR_REVIEW] }, 1, 0] },
        },
        revision: { $sum: { $cond: [{ $eq: ['$status', TaskStatus.REVISION_REQUESTED] }, 1, 0] } },
        inProgress: { $sum: { $cond: [{ $eq: ['$status', TaskStatus.IN_PROGRESS] }, 1, 0] } },
        overdue: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $not: { $in: ['$status', DONE] } },
                  { $gt: ['$dueDate', null] },
                  { $lt: ['$dueDate', now] },
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
  const t = row ?? { total: 0, done: 0, awaitingReview: 0, revision: 0, overdue: 0, inProgress: 0 };
  return { ...t, pending: t.total - t.done, completionPercent: pct(t.done, t.total) };
}

async function minutesSince(partnerId: Types.ObjectId, since: Date) {
  const [r] = await TaskUpdate.aggregate<{ m: number }>([
    { $match: { partnerId, createdAt: { $gte: since } } },
    { $group: { _id: null, m: { $sum: '$minutesSpent' } } },
  ]);
  return r?.m ?? 0;
}

export const dashboardRouter = Router();
dashboardRouter.use(authenticate);

dashboardRouter.get('/admin', authorize(Role.ADMIN), async (_req, res) => {
  const now = new Date();
  const [
    clients,
    activePartners,
    projectsByStatus,
    overdueProjects,
    tasks,
    billing,
    upcoming,
    recentMessages,
    recentActivity,
    activeProjects,
    revenue,
  ] = await Promise.all([
    Client.countDocuments({ archivedAt: null, status: ClientStatus.ACTIVE }),
    User.countDocuments({ role: Role.PARTNER, status: UserStatus.ACTIVE, deletedAt: null }),
    Project.aggregate<{ _id: string; n: number }>([
      { $match: { archivedAt: null } },
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ]),
    Project.countDocuments({
      archivedAt: null,
      status: { $in: OPEN_PROJECT },
      expectedEndDate: { $lt: now },
    }),
    taskStats({}),
    billingTotals({}),
    upcomingInstallments({}, 30, 6),
    Message.find({ deletedAt: null })
      .sort({ createdAt: -1 })
      .limit(6)
      .populate('senderId', 'name role')
      .populate('conversationId', 'userId audience')
      .lean(),
    AuditLog.find().sort({ createdAt: -1 }).limit(8).populate('actorId', 'name role').lean(),
    Project.find({ archivedAt: null, status: ProjectStatus.ACTIVE })
      .sort({ expectedEndDate: 1 })
      .limit(8)
      .select('title projectCode progress expectedEndDate')
      .lean(),
    Payment.aggregate<{ _id: string; amount: number }>([
      {
        $match: {
          status: PaymentStatus.SUCCEEDED,
          paidAt: { $gte: new Date(now.getFullYear(), now.getMonth() - 5, 1) },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$paidAt' } },
          amount: { $sum: { $subtract: ['$amountMinor', { $ifNull: ['$refundedMinor', 0] }] } },
        },
      },
      { $sort: { _id: 1 } },
    ]),
  ]);
  const byStatus = Object.fromEntries(projectsByStatus.map((p) => [p._id, p.n])) as Record<
    string,
    number
  >;
  ok(res, {
    clients,
    activePartners,
    projects: {
      total: Object.values(byStatus).reduce((s, n) => s + n, 0),
      active: byStatus.ACTIVE ?? 0,
      completed: byStatus.COMPLETED ?? 0,
      pending: byStatus.PENDING ?? 0,
      onHold: byStatus.ON_HOLD ?? 0,
      overdue: overdueProjects,
    },
    tasks,
    billing,
    upcomingInstallments: upcoming,
    recentMessages: recentMessages.map((m) => ({
      id: m._id.toString(),
      sender: m.senderId,
      body: m.body,
      conversation: m.conversationId,
      createdAt: m.createdAt,
    })),
    recentActivity,
    activeProjects: activeProjects.map((p) => ({
      id: p._id.toString(),
      title: p.title,
      projectCode: p.projectCode,
      approved: p.progress?.approved ?? 0,
      submitted: p.progress?.submitted ?? 0,
      expectedEndDate: p.expectedEndDate,
    })),
    revenueByMonth: revenue.map((r) => ({ month: r._id, amountMinor: r.amount })),
  });
});

dashboardRouter.get('/partner', authorize(Role.PARTNER), async (req, res) => {
  const user = currentUser(req);
  const [projects, tasks, upcoming, weekMinutes, monthMinutes, weekDone, monthDone, revisions] =
    await Promise.all([
      Project.countDocuments({
        partnerIds: user._id,
        archivedAt: null,
        status: { $in: OPEN_PROJECT },
      }),
      taskStats({ assigneeIds: user._id }),
      Task.find({
        assigneeIds: user._id,
        status: { $nin: [...DONE, TaskStatus.CANCELLED] },
        dueDate: { $ne: null },
      })
        .sort({ dueDate: 1 })
        .limit(6)
        .populate('projectId', 'title projectCode')
        .select('title dueDate priority status submittedProgress approvedProgress projectId')
        .lean(),
      minutesSince(user._id, daysAgo(7)),
      minutesSince(user._id, daysAgo(30)),
      Task.countDocuments({ assigneeIds: user._id, approvedAt: { $gte: daysAgo(7) } }),
      Task.countDocuments({ assigneeIds: user._id, approvedAt: { $gte: daysAgo(30) } }),
      Task.find({ assigneeIds: user._id, status: TaskStatus.REVISION_REQUESTED })
        .select('title reviewNotes projectId')
        .populate('projectId', 'title')
        .limit(5)
        .lean(),
    ]);
  ok(res, {
    activeProjects: projects,
    tasks,
    upcomingDeadlines: upcoming.map((t) => ({ ...t, id: t._id.toString() })),
    weekly: { minutes: weekMinutes, tasksCompleted: weekDone },
    monthly: { minutes: monthMinutes, tasksCompleted: monthDone },
    revisionRequests: revisions.map((t) => ({
      id: t._id.toString(),
      title: t.title,
      project: t.projectId,
      feedback: t.reviewNotes.at(-1)?.comment,
    })),
  });
});

dashboardRouter.get('/client', authorize(Role.CLIENT), async (req, res) => {
  const user = currentUser(req);
  const clientId = user.clientId ?? null;
  const projects = await Project.find({
    clientId,
    archivedAt: null,
    status: { $ne: ProjectStatus.CANCELLED },
  })
    .select('title projectCode status progress startDate expectedEndDate')
    .lean();
  const ids = projects.map((p) => p._id);
  const [milestones, billing, upcoming, recentWork] = await Promise.all([
    Milestone.find({
      projectId: { $in: ids },
      clientVisible: true,
      status: { $ne: MilestoneStatus.COMPLETED },
      dueDate: { $ne: null },
    })
      .sort({ dueDate: 1 })
      .limit(6)
      .populate('projectId', 'title')
      .lean(),
    billingTotals({ clientId }),
    upcomingInstallments({ clientId }, 60, 6),
    Task.find({ projectId: { $in: ids }, status: { $in: DONE }, approvedAt: { $ne: null } })
      .sort({ approvedAt: -1 })
      .limit(6)
      .select('title approvedAt projectId')
      .populate('projectId', 'title')
      .lean(),
  ]);
  const count = (s: string) => projects.filter((p) => p.status === s).length;
  const avg = projects.length
    ? Math.round(
        (projects.reduce((s, p) => s + (p.progress?.approved ?? 0), 0) / projects.length) * 10,
      ) / 10
    : 0;
  ok(res, {
    projects: {
      total: projects.length,
      active: count(ProjectStatus.ACTIVE),
      completed: count(ProjectStatus.COMPLETED),
      pending: count(ProjectStatus.PENDING) + count(ProjectStatus.ON_HOLD),
    },
    overallProgress: avg,
    projectList: projects.map((p) => ({
      id: p._id.toString(),
      title: p.title,
      projectCode: p.projectCode,
      status: p.status,
      approvedProgress: p.progress?.approved ?? 0,
      expectedEndDate: p.expectedEndDate,
    })),
    upcomingMilestones: milestones.map((m) => ({
      id: m._id.toString(),
      title: m.title,
      dueDate: m.dueDate,
      project: m.projectId,
    })),
    billing,
    upcomingInstallments: upcoming,
    recentWork: recentWork.map((t) => ({
      id: t._id.toString(),
      title: t.title,
      approvedAt: t.approvedAt,
      project: t.projectId,
    })),
  });
});

/** Admin: a partner's profile, allocations, workload, time and reports. */
dashboardRouter.get(
  '/partners/:id',
  authorize(Role.ADMIN),
  validate({ params: idParamSchema }),
  async (req, res) => {
    const partner = await User.findOne({
      _id: valid<{ id: string }>(req, 'params').id,
      role: Role.PARTNER,
      deletedAt: null,
    }).lean();
    if (!partner) throw AppError.notFound('Partner');
    const [projects, tasks, totalMinutes, monthMinutes, reports, recentUpdates] = await Promise.all(
      [
        Project.find({ partnerIds: partner._id, archivedAt: null })
          .select('title projectCode status progress expectedEndDate')
          .lean(),
        taskStats({ assigneeIds: partner._id }),
        minutesSince(partner._id, new Date(0)),
        minutesSince(partner._id, daysAgo(30)),
        WorkReport.find({ partnerId: partner._id }).sort({ date: -1 }).limit(10).lean(),
        TaskUpdate.find({ partnerId: partner._id })
          .sort({ createdAt: -1 })
          .limit(10)
          .populate('taskId', 'title')
          .lean(),
      ],
    );
    ok(res, {
      partner: toUserDTO(partner, Role.ADMIN),
      projects: projects.map((p) => ({
        id: p._id.toString(),
        title: p.title,
        projectCode: p.projectCode,
        status: p.status,
        approvedProgress: p.progress?.approved ?? 0,
        expectedEndDate: p.expectedEndDate,
      })),
      tasks,
      time: { totalMinutes, last30DaysMinutes: monthMinutes },
      reports,
      recentUpdates: recentUpdates.map((u) => ({
        id: u._id.toString(),
        kind: u.kind,
        task: u.taskId,
        newProgress: u.newProgress,
        description: u.description,
        minutesSpent: u.minutesSpent,
        reviewStatus: u.reviewStatus,
        createdAt: u.createdAt,
      })),
    });
  },
);

dashboardRouter.get('/settings-status', authorize(Role.ADMIN), async (_req, res) => {
  const cfg = env();
  ok(res, {
    environment: cfg.NODE_ENV,
    // Live SMTP check (connects and signs in; sends nothing). Never includes the password.
    email: { ...(await verifyMailer()), from: fromAddress() },
    payments: gatewayConfig(),
    storage: { provider: 'local', maxUploadMb: cfg.MAX_UPLOAD_MB },
    jobs: { enabled: cfg.JOBS_ENABLED },
    security: {
      cookieSecure: cfg.COOKIE_SECURE,
      rateLimit: cfg.RATE_LIMIT_ENABLED,
      lockoutAfter: cfg.MAX_FAILED_LOGINS,
    },
  });
});

/** Admin: send a real test email to yourself to confirm delivery end to end. */
dashboardRouter.post('/email-test', authorize(Role.ADMIN), async (req, res) => {
  const admin = currentUser(req);
  try {
    const result = await sendMail({
      to: admin.email,
      subject: 'Innovexa test email',
      text: `Hi ${admin.name},

This is a test email from the Innovexa platform. If you can read this, email delivery works.`,
    });
    if (result.transport === 'log') {
      throw new AppError(
        409,
        'EMAIL_NOT_CONFIGURED',
        'Email is not configured (EMAIL_TRANSPORT=log). Nothing was sent.',
      );
    }
    ok(res, { sent: true, to: admin.email, messageId: result.messageId });
  } catch (err) {
    if (err instanceof MailDeliveryError)
      throw new AppError(502, 'EMAIL_DELIVERY_FAILED', err.message);
    throw err;
  }
});
