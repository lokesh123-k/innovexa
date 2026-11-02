import { Router, type Response } from 'express';
import { Types } from 'mongoose';
import {
  InvoiceStatus,
  ProjectStatus,
  REPORT_TYPES,
  Role,
  TaskStatus,
  fromMinor,
  reportQuerySchema,
  type ReportQuery,
  type ReportType,
} from '@innovexa/shared';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { valid, validate } from '../../middleware/validate';
import { ok } from '../../utils/http';
import { Invoice } from '../invoices/invoice.model';
import { Project } from '../projects/project.model';
import { Task } from '../tasks/task.model';
import { TaskUpdate } from '../task-updates/taskUpdate.model';
import { User } from '../users/user.model';
import { WorkReport } from './workReport.model';

/** Lets Excel detect UTF-8. */
const CSV_BOM = '﻿';
const DONE = [TaskStatus.APPROVED, TaskStatus.COMPLETED];
const oid = (s?: string) => (s ? new Types.ObjectId(s) : undefined);
const range = (q: ReportQuery) =>
  q.from || q.to
    ? { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) }
    : undefined;
const iso = (d?: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : '');

type Row = Record<string, string | number | boolean>;
interface Report {
  title: string;
  columns: { key: string; label: string; money?: boolean }[];
  rows: Row[];
  totals?: Row;
}

/** RFC 4180 CSV with formula-injection protection for spreadsheet apps. */
function toCsv(report: Report): string {
  const cell = (v: unknown) => {
    let s = v === undefined || v === null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const fmt = (c: Report['columns'][number], r: Row) =>
    c.money && typeof r[c.key] === 'number' ? fromMinor(r[c.key] as number) : r[c.key];
  const lines = [report.columns.map((c) => cell(c.label)).join(',')];
  for (const r of report.rows) lines.push(report.columns.map((c) => cell(fmt(c, r))).join(','));
  if (report.totals) lines.push(report.columns.map((c) => cell(fmt(c, report.totals!))).join(','));
  return lines.join('\r\n');
}

const builders: Record<ReportType, (q: ReportQuery) => Promise<Report>> = {
  async projects(q) {
    const filter: Record<string, unknown> = { archivedAt: null };
    if (q.clientId) filter.clientId = q.clientId;
    if (q.projectId) filter._id = q.projectId;
    if (q.partnerId) filter.partnerIds = q.partnerId;
    const created = range(q);
    if (created) filter.startDate = created;
    const projects = await Project.find(filter)
      .populate('clientId', 'companyName')
      .sort({ startDate: -1 })
      .lean();
    const now = new Date();
    return {
      title: 'Project completion report',
      columns: [
        { key: 'code', label: 'Project' },
        { key: 'title', label: 'Title' },
        { key: 'client', label: 'Client' },
        { key: 'status', label: 'Status' },
        { key: 'approved', label: 'Approved progress %' },
        { key: 'start', label: 'Start' },
        { key: 'expected', label: 'Expected completion' },
        { key: 'overdue', label: 'Overdue' },
        { key: 'contract', label: 'Contract', money: true },
      ],
      rows: projects.map((p) => ({
        code: p.projectCode,
        title: p.title,
        client: (p.clientId as unknown as { companyName?: string })?.companyName ?? '',
        status: p.status,
        approved: p.progress?.approved ?? 0,
        start: iso(p.startDate),
        expected: iso(p.expectedEndDate),
        overdue:
          p.expectedEndDate < now &&
          [ProjectStatus.PENDING, ProjectStatus.ACTIVE, ProjectStatus.ON_HOLD].includes(
            p.status as never,
          ),
        contract: p.contractAmountMinor,
      })),
      totals: { code: 'TOTAL', contract: projects.reduce((s, p) => s + p.contractAmountMinor, 0) },
    };
  },

  async partners(q) {
    const partners = await User.find({
      role: Role.PARTNER,
      deletedAt: null,
      ...(q.partnerId ? { _id: q.partnerId } : {}),
    })
      .sort({ name: 1 })
      .lean();
    const ids = partners.map((p) => p._id);
    const taskMatch: Record<string, unknown> = {
      assigneeIds: { $in: ids },
      status: { $ne: TaskStatus.CANCELLED },
    };
    if (q.projectId) taskMatch.projectId = oid(q.projectId);
    const now = new Date();
    const [taskRows, minuteRows] = await Promise.all([
      Task.aggregate<{
        _id: Types.ObjectId;
        total: number;
        done: number;
        overdue: number;
        review: number;
      }>([
        { $match: taskMatch },
        { $unwind: '$assigneeIds' },
        { $match: { assigneeIds: { $in: ids } } },
        {
          $group: {
            _id: '$assigneeIds',
            total: { $sum: 1 },
            done: { $sum: { $cond: [{ $in: ['$status', DONE] }, 1, 0] } },
            review: {
              $sum: { $cond: [{ $eq: ['$status', TaskStatus.SUBMITTED_FOR_REVIEW] }, 1, 0] },
            },
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
      ]),
      TaskUpdate.aggregate<{ _id: Types.ObjectId; minutes: number }>([
        { $match: { partnerId: { $in: ids }, ...(range(q) ? { createdAt: range(q) } : {}) } },
        { $group: { _id: '$partnerId', minutes: { $sum: '$minutesSpent' } } },
      ]),
    ]);
    const t = new Map(taskRows.map((r) => [r._id.toString(), r]));
    const m = new Map(minuteRows.map((r) => [r._id.toString(), r.minutes]));
    return {
      title: 'Partner productivity report',
      columns: [
        { key: 'name', label: 'Partner' },
        { key: 'type', label: 'Type' },
        { key: 'status', label: 'Account' },
        { key: 'total', label: 'Assigned tasks' },
        { key: 'done', label: 'Completed' },
        { key: 'pending', label: 'Pending' },
        { key: 'review', label: 'Awaiting review' },
        { key: 'overdue', label: 'Overdue' },
        { key: 'hours', label: 'Hours logged' },
        { key: 'completion', label: 'Completion %' },
      ],
      rows: partners.map((p) => {
        const r = t.get(p._id.toString()) ?? { total: 0, done: 0, overdue: 0, review: 0 };
        return {
          name: p.name,
          type: p.partnerProfile?.partnerType ?? '',
          status: p.status,
          total: r.total,
          done: r.done,
          pending: r.total - r.done,
          review: r.review,
          overdue: r.overdue,
          hours: Math.round(((m.get(p._id.toString()) ?? 0) / 60) * 10) / 10,
          completion: r.total ? Math.round((r.done / r.total) * 1000) / 10 : 0,
        };
      }),
    };
  },

  async work(q) {
    const filter: Record<string, unknown> = {};
    if (q.partnerId) filter.partnerId = q.partnerId;
    if (range(q)) filter.date = range(q);
    const reports = await WorkReport.find(filter)
      .sort({ date: -1 })
      .limit(2000)
      .populate('partnerId', 'name')
      .lean();
    return {
      title: 'Daily and weekly work reports',
      columns: [
        { key: 'date', label: 'Date' },
        { key: 'type', label: 'Type' },
        { key: 'partner', label: 'Partner' },
        { key: 'hours', label: 'Hours' },
        { key: 'progress', label: 'Progress %' },
        { key: 'work', label: 'Work completed' },
        { key: 'problems', label: 'Problems' },
        { key: 'next', label: 'Next plan' },
      ],
      rows: reports.map((r) => ({
        date: iso(r.date),
        type: r.type,
        partner: (r.partnerId as unknown as { name?: string })?.name ?? '',
        hours: Math.round((r.minutesWorked / 60) * 10) / 10,
        progress: r.progressPercent ?? '',
        work: r.workCompleted,
        problems: r.problems ?? '',
        next: r.nextPlan ?? '',
      })),
      totals: {
        date: 'TOTAL',
        hours: Math.round((reports.reduce((s, r) => s + r.minutesWorked, 0) / 60) * 10) / 10,
      },
    };
  },

  async 'overdue-tasks'(q) {
    const filter: Record<string, unknown> = {
      status: { $nin: [...DONE, TaskStatus.CANCELLED] },
      dueDate: { $lt: new Date() },
    };
    if (q.projectId) filter.projectId = q.projectId;
    if (q.partnerId) filter.assigneeIds = q.partnerId;
    const tasks = await Task.find(filter)
      .sort({ dueDate: 1 })
      .populate('projectId', 'title projectCode')
      .populate('assigneeIds', 'name')
      .lean();
    return {
      title: 'Overdue tasks',
      columns: [
        { key: 'project', label: 'Project' },
        { key: 'task', label: 'Task' },
        { key: 'assignees', label: 'Assignees' },
        { key: 'status', label: 'Status' },
        { key: 'due', label: 'Due' },
        { key: 'days', label: 'Days overdue' },
        { key: 'submitted', label: 'Submitted %' },
        { key: 'approved', label: 'Approved %' },
      ],
      rows: tasks.map((t) => ({
        project: (t.projectId as unknown as { projectCode?: string })?.projectCode ?? '',
        task: t.title,
        assignees: (t.assigneeIds as unknown as { name: string }[]).map((a) => a.name).join('; '),
        status: t.status,
        due: iso(t.dueDate),
        days: Math.floor((Date.now() - new Date(t.dueDate!).getTime()) / 86_400_000),
        submitted: t.submittedProgress,
        approved: t.approvedProgress,
      })),
    };
  },

  async financial(q) {
    const filter: Record<string, unknown> = {
      status: { $nin: [InvoiceStatus.DRAFT, InvoiceStatus.CANCELLED] },
    };
    if (q.clientId) filter.clientId = q.clientId;
    if (q.projectId) filter.projectId = q.projectId;
    if (range(q)) filter.invoiceDate = range(q);
    const invoices = await Invoice.find(filter)
      .sort({ invoiceDate: -1 })
      .populate('clientId', 'companyName')
      .populate('projectId', 'projectCode')
      .lean();
    const sum = (k: 'totalMinor' | 'paidMinor' | 'balanceMinor' | 'refundedMinor') =>
      invoices.reduce((s, i) => s + (i[k] ?? 0), 0);
    return {
      title: 'Revenue, collections and outstanding balances',
      columns: [
        { key: 'number', label: 'Invoice' },
        { key: 'date', label: 'Date' },
        { key: 'client', label: 'Client' },
        { key: 'project', label: 'Project' },
        { key: 'status', label: 'Status' },
        { key: 'total', label: 'Total', money: true },
        { key: 'received', label: 'Received (net)', money: true },
        { key: 'balance', label: 'Outstanding', money: true },
        { key: 'due', label: 'Due' },
      ],
      rows: invoices.map((i) => ({
        number: i.invoiceNumber,
        date: iso(i.invoiceDate),
        client: (i.clientId as unknown as { companyName?: string })?.companyName ?? '',
        project: (i.projectId as unknown as { projectCode?: string })?.projectCode ?? '',
        status: i.status,
        total: i.totalMinor,
        received: i.paidMinor - (i.refundedMinor ?? 0),
        balance: i.balanceMinor,
        due: iso(i.dueDate),
      })),
      totals: {
        number: 'TOTAL',
        total: sum('totalMinor'),
        received: sum('paidMinor') - sum('refundedMinor'),
        balance: sum('balanceMinor'),
      },
    };
  },
};

export const reportsRouter = Router();
reportsRouter.use(authenticate, authorize(Role.ADMIN));
reportsRouter.get(
  '/:type',
  validate({ params: z.object({ type: z.enum(REPORT_TYPES) }), query: reportQuerySchema }),
  async (req, res: Response) => {
    const { type } = valid<{ type: ReportType }>(req, 'params');
    const q = valid<ReportQuery>(req, 'query');
    const report = await builders[type](q);
    if (q.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="innovexa-${type}-${new Date().toISOString().slice(0, 10)}.csv"`,
      );
      res.send(`${CSV_BOM}${toCsv(report)}`);
      return;
    }
    ok(res, report);
  },
);
