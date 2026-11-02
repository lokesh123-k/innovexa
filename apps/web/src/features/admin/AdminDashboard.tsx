import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Briefcase,
  Building2,
  CheckCircle2,
  ClipboardList,
  FolderKanban,
  IndianRupee,
  Wallet,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fromMinor } from '@innovexa/shared';
import { ProgressBar, StatTile, StatusBadge } from '@/components/ui/extra';
import { FormAlert } from '@/components/ui/form';
import { Avatar, Card, CardHeader, EmptyState, PageHeader, Skeleton } from '@/components/ui/misc';
import { useAuth } from '@/features/auth/AuthProvider';
import { errorMessage, getData } from '@/lib/api';
import { money } from '@/lib/format';
import { formatDate, formatDateTime, humanize } from '@/lib/utils';
import type { AuditLogEntry, BillingTotals, UpcomingInstallment, UserRef } from '@/types';
import { describeAction } from './AuditLogsPage';

interface AdminDash {
  clients: number;
  activePartners: number;
  projects: {
    total: number;
    active: number;
    completed: number;
    pending: number;
    onHold: number;
    overdue: number;
  };
  tasks: {
    total: number;
    done: number;
    pending: number;
    awaitingReview: number;
    revision: number;
    overdue: number;
    completionPercent: number;
  };
  billing: BillingTotals;
  upcomingInstallments: UpcomingInstallment[];
  recentMessages: {
    id: string;
    sender: UserRef;
    body: string;
    conversation: { _id: string; audience: string };
    createdAt: string;
  }[];
  recentActivity: AuditLogEntry[];
  activeProjects: {
    id: string;
    title: string;
    projectCode: string;
    approved: number;
    submitted: number;
    expectedEndDate: string;
  }[];
  revenueByMonth: { month: string; amountMinor: number }[];
}

export function AdminDashboard() {
  const { user } = useAuth();
  const dash = useQuery({
    queryKey: ['dashboard', 'admin'],
    queryFn: async () => (await getData<AdminDash>('/dashboard/admin')).data,
    refetchInterval: 60_000,
  });

  if (dash.isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    );
  }
  if (dash.isError) return <FormAlert>{errorMessage(dash.error)}</FormAlert>;
  const d = dash.data!;
  const revenue = d.revenueByMonth.map((r) => ({
    month: r.month,
    amount: Number(fromMinor(r.amountMinor)),
  }));

  return (
    <>
      <PageHeader
        title={`Welcome back, ${user?.name.split(' ')[0]}`}
        description="Company overview for Innovexa Digital."
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Active clients" value={d.clients} icon={<Building2 />} />
        <StatTile label="Active partners" value={d.activePartners} icon={<Briefcase />} />
        <StatTile
          label="Projects"
          value={d.projects.total}
          hint={`${d.projects.active} active · ${d.projects.completed} completed · ${d.projects.pending} pending`}
          icon={<FolderKanban />}
        />
        <StatTile
          label="Overdue projects"
          value={d.projects.overdue}
          icon={<AlertTriangle />}
          tone={d.projects.overdue ? 'red' : 'green'}
        />
        <StatTile
          label="Tasks"
          value={d.tasks.total}
          hint={`${d.tasks.pending} pending · ${d.tasks.overdue} overdue`}
          icon={<ClipboardList />}
        />
        <Link to="/admin/approvals">
          <StatTile
            label="Pending approvals"
            value={d.tasks.awaitingReview}
            hint="Click to review"
            icon={<CheckCircle2 />}
            tone={d.tasks.awaitingReview ? 'amber' : 'green'}
          />
        </Link>
        <StatTile
          label="Partner work completion"
          value={`${d.tasks.completionPercent}%`}
          hint={`${d.tasks.done} of ${d.tasks.total} tasks approved`}
          icon={<CheckCircle2 />}
          tone="green"
        />
        <StatTile
          label="Project revenue"
          value={money(d.billing.invoicedMinor)}
          hint={`${money(d.billing.receivedMinor)} received · ${money(d.billing.outstandingMinor)} pending`}
          icon={<IndianRupee />}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Collections (last 6 months)"
            description="Net verified payments received"
          />
          <div className="h-64 p-4">
            {revenue.length === 0 ? (
              <EmptyState
                icon={<Wallet />}
                title="No payments yet"
                description="Recorded payments will chart here."
              />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={revenue}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#64748b' }} />
                  <YAxis
                    tick={{ fontSize: 12, fill: '#64748b' }}
                    tickFormatter={(v: number) =>
                      `₹${v >= 100000 ? `${Math.round(v / 1000)}k` : v}`
                    }
                    width={64}
                  />
                  <Tooltip
                    formatter={(v: number) => [`₹${v.toLocaleString('en-IN')}`, 'Received']}
                  />
                  <Bar dataKey="amount" fill="#1d40d8" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader
            title="Upcoming payment dates"
            action={
              <Link
                to="/admin/invoices"
                className="text-xs font-medium text-brand-700 hover:underline"
              >
                Invoices
              </Link>
            }
          />
          {d.upcomingInstallments.length === 0 ? (
            <p className="px-5 py-4 text-sm text-slate-500">Nothing due in the next 30 days.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {d.upcomingInstallments.map((i) => (
                <li key={i.id} className="px-5 py-2.5">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium">{i.invoice?.clientId?.companyName}</span>
                    <span className="tabular-nums">{money(i.dueMinor)}</span>
                  </div>
                  <div className="flex justify-between text-xs text-slate-500">
                    <span>
                      {i.invoice?.invoiceNumber} · {humanize(i.kind)}
                    </span>
                    <span>
                      {formatDate(i.dueDate)} <StatusBadge status={i.status} />
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader
            title="Active projects"
            description="Approved vs submitted progress"
            action={
              <Link
                to="/admin/projects"
                className="text-xs font-medium text-brand-700 hover:underline"
              >
                All projects
              </Link>
            }
          />
          {d.activeProjects.length === 0 ? (
            <p className="px-5 py-4 text-sm text-slate-500">No active projects.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {d.activeProjects.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                  <Link
                    to={`/admin/projects/${p.id}`}
                    className="min-w-0 flex-1 truncate font-medium text-slate-900 hover:text-brand-700"
                  >
                    {p.projectCode} · {p.title}
                  </Link>
                  <div className="flex w-56 items-center gap-2">
                    <ProgressBar value={p.approved} secondary={p.submitted} className="flex-1" />
                    <span className="w-10 text-right text-xs tabular-nums">{p.approved}%</span>
                  </div>
                  <span className="w-24 text-right text-xs text-slate-500">
                    due {formatDate(p.expectedEndDate)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader
            title="Recent messages"
            action={
              <Link
                to="/admin/messages"
                className="text-xs font-medium text-brand-700 hover:underline"
              >
                Messages
              </Link>
            }
          />
          {d.recentMessages.length === 0 ? (
            <p className="px-5 py-4 text-sm text-slate-500">No messages yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {d.recentMessages.map((m) => (
                <li key={m.id}>
                  <Link
                    to={`/admin/messages?c=${m.conversation?._id}`}
                    className="flex gap-3 px-5 py-2.5 hover:bg-slate-50"
                  >
                    <Avatar name={m.sender?.name ?? '?'} />
                    <div className="min-w-0 text-sm">
                      <div className="font-medium">{m.sender?.name}</div>
                      <div className="truncate text-slate-500">{m.body || 'Attachment'}</div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="lg:col-span-3">
          <CardHeader
            title="Recent activity"
            action={
              <Link
                to="/admin/audit-logs"
                className="text-xs font-medium text-brand-700 hover:underline"
              >
                Audit logs
              </Link>
            }
          />
          <ul className="divide-y divide-slate-100">
            {d.recentActivity.map((a) => (
              <li key={a._id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                <Avatar name={a.actorId?.name ?? 'System'} />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{a.actorId?.name ?? 'System'}</span>{' '}
                  <span className="text-slate-600">{describeAction(a.action)}</span>
                </span>
                <time className="text-xs text-slate-500">{formatDateTime(a.createdAt)}</time>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
