import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  Clock,
  CreditCard,
  Download,
  FileText,
  FolderKanban,
  IndianRupee,
  ListChecks,
  MessageSquare,
  Milestone as MilestoneIcon,
  Wallet,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ProgressBar, StatTile, StatusBadge, TableShell, td, th } from '@/components/ui/extra';
import { FormAlert, Select } from '@/components/ui/form';
import { Card, CardHeader, EmptyState, PageHeader, Skeleton } from '@/components/ui/misc';
import { useAuth } from '@/features/auth/AuthProvider';
import { errorMessage, getData, postData } from '@/lib/api';
import { money } from '@/lib/format';
import { cn, formatDate, formatDateTime, humanize } from '@/lib/utils';
import type {
  Attachment,
  BillingTotals,
  Conversation,
  Invoice,
  Milestone,
  Project,
  UpcomingInstallment,
} from '@/types';

interface ClientDash {
  projects: { total: number; active: number; completed: number; pending: number };
  overallProgress: number;
  projectList: {
    id: string;
    title: string;
    projectCode: string;
    status: string;
    approvedProgress: number;
    expectedEndDate: string;
  }[];
  upcomingMilestones: { id: string; title: string; dueDate: string; project?: { title: string } }[];
  billing: BillingTotals;
  upcomingInstallments: UpcomingInstallment[];
  recentWork: { id: string; title: string; approvedAt: string; project?: { title: string } }[];
}

export function ClientDashboard() {
  const { user } = useAuth();
  const dash = useQuery({
    queryKey: ['dashboard', 'client'],
    queryFn: async () => (await getData<ClientDash>('/dashboard/client')).data,
  });
  if (dash.isLoading)
    return (
      <div className="grid gap-4 sm:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    );
  if (dash.isError) return <FormAlert>{errorMessage(dash.error)}</FormAlert>;
  const d = dash.data!;
  return (
    <>
      <PageHeader
        title={`Welcome, ${user?.name.split(' ')[0]}`}
        description="Your projects, approved progress and payments with Innovexa Digital."
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="My projects"
          value={d.projects.total}
          hint={`${d.projects.active} active · ${d.projects.completed} completed · ${d.projects.pending} pending`}
          icon={<FolderKanban />}
        />
        <StatTile
          label="Overall progress"
          value={`${d.overallProgress}%`}
          hint="Approved work only"
          icon={<CheckCircle2 />}
          tone="green"
        />
        <StatTile
          label="Total contract amount"
          value={money(d.billing.invoicedMinor)}
          hint="Across issued invoices"
          icon={<IndianRupee />}
        />
        <StatTile
          label="Outstanding"
          value={money(d.billing.outstandingMinor)}
          icon={<Wallet />}
          tone={d.billing.outstandingMinor > 0 ? 'amber' : 'green'}
        />
        <StatTile
          label="Advance paid"
          value={money(d.billing.advancePaidMinor)}
          hint={`of ${money(d.billing.advanceDueMinor)}`}
          icon={<CreditCard />}
          tone="green"
        />
        <StatTile
          label="Total paid"
          value={money(d.billing.receivedMinor)}
          icon={<CreditCard />}
          tone="green"
        />
        <StatTile
          label="Upcoming instalments"
          value={d.upcomingInstallments.length}
          hint="Next 60 days"
          icon={<CalendarClock />}
        />
        <StatTile
          label="Upcoming milestones"
          value={d.upcomingMilestones.length}
          icon={<MilestoneIcon />}
        />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Project progress"
            action={
              <Link
                to="/client/projects"
                className="text-xs font-medium text-brand-700 hover:underline"
              >
                All projects
              </Link>
            }
          />
          {d.projectList.length === 0 ? (
            <EmptyState
              icon={<FolderKanban />}
              title="No projects yet"
              description="Your projects will appear here once Innovexa sets them up."
            />
          ) : (
            <ul className="divide-y divide-slate-100">
              {d.projectList.map((p) => (
                <li key={p.id}>
                  <Link
                    to={`/client/projects/${p.id}`}
                    className="block px-5 py-3 hover:bg-slate-50"
                  >
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="font-medium text-slate-900">{p.title}</span>
                      <StatusBadge status={p.status} />
                    </div>
                    <div className="mt-2 flex items-center gap-3">
                      <ProgressBar value={p.approvedProgress} className="flex-1" />
                      <span className="w-12 text-right text-xs font-medium tabular-nums">
                        {p.approvedProgress}%
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      Expected completion {formatDate(p.expectedEndDate)}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader
            title="Upcoming payments"
            action={
              <Link
                to="/client/invoices"
                className="text-xs font-medium text-brand-700 hover:underline"
              >
                Invoices
              </Link>
            }
          />
          {d.upcomingInstallments.length === 0 ? (
            <p className="px-5 py-4 text-sm text-slate-500">No payments due soon.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {d.upcomingInstallments.map((i) => (
                <li key={i.id} className="flex justify-between gap-2 px-5 py-2.5">
                  <span>
                    {i.invoice?.invoiceNumber} · {humanize(i.kind)}
                    <div className="text-xs text-slate-500">due {formatDate(i.dueDate)}</div>
                  </span>
                  <span className="text-right tabular-nums">
                    {money(i.dueMinor)}
                    <div>
                      <StatusBadge status={i.status} />
                    </div>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Upcoming deadlines" />
          {d.upcomingMilestones.length === 0 ? (
            <p className="px-5 py-4 text-sm text-slate-500">No upcoming milestones.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {d.upcomingMilestones.map((m) => (
                <li key={m.id} className="px-5 py-2.5">
                  <div className="font-medium">{m.title}</div>
                  <div className="text-xs text-slate-500">
                    {m.project?.title} · {formatDate(m.dueDate)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader
            title="Recently approved work"
            action={
              <Link
                to="/client/completed-work"
                className="text-xs font-medium text-brand-700 hover:underline"
              >
                Completed work
              </Link>
            }
          />
          {d.recentWork.length === 0 ? (
            <p className="px-5 py-4 text-sm text-slate-500">
              Approved work updates will appear here.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {d.recentWork.map((w) => (
                <li key={w.id} className="flex justify-between gap-2 px-5 py-2.5">
                  <span>
                    <CheckCircle2 className="mr-1.5 inline size-4 text-emerald-600" />
                    {w.title} <span className="text-xs text-slate-500">· {w.project?.title}</span>
                  </span>
                  <span className="text-xs text-slate-500">{formatDate(w.approvedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

const useMyProjects = () =>
  useQuery({
    queryKey: ['projects', 'client'],
    queryFn: async () => (await getData<Project[]>('/projects', { limit: 100 })).data,
  });

/** Shared project picker for the client's per-project pages (remembers selection in the URL). */
function ProjectScoped({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: (projectId: string) => ReactNode;
}) {
  const projects = useMyProjects();
  const [params, setParams] = useSearchParams();
  const selected = params.get('project') ?? projects.data?.[0]?.id ?? '';
  return (
    <>
      <PageHeader
        title={title}
        description={description}
        actions={
          projects.data && projects.data.length > 1 ? (
            <Select
              value={selected}
              onChange={(e) => setParams({ project: e.target.value }, { replace: true })}
              className="w-64"
              aria-label="Project"
            >
              {projects.data.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </Select>
          ) : undefined
        }
      />
      {projects.isLoading ? (
        <Skeleton className="h-40" />
      ) : projects.isError ? (
        <FormAlert>{errorMessage(projects.error)}</FormAlert>
      ) : !selected ? (
        <Card>
          <EmptyState
            icon={<FolderKanban />}
            title="No projects yet"
            description="Your projects will appear here once they are set up."
          />
        </Card>
      ) : (
        children(selected)
      )}
    </>
  );
}

export function ClientProjectsPage() {
  const projects = useMyProjects();
  return (
    <>
      <PageHeader title="My projects" description="Only approved progress is shown." />
      {projects.isLoading ? (
        <Skeleton className="h-40" />
      ) : projects.isError ? (
        <FormAlert>{errorMessage(projects.error)}</FormAlert>
      ) : projects.data!.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FolderKanban />}
            title="No projects yet"
            description="Your projects will appear here once Innovexa sets them up."
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {projects.data!.map((p) => (
            <Link key={p.id} to={`/client/projects/${p.id}`}>
              <Card className="h-full p-5 transition-shadow hover:shadow-md">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold text-slate-900">{p.title}</div>
                    <div className="text-xs text-slate-500">
                      {p.projectCode} · {p.serviceCategory?.name}
                    </div>
                  </div>
                  <StatusBadge status={p.status} />
                </div>
                <div className="mt-4 flex items-center gap-3">
                  <ProgressBar value={p.approvedProgress} className="h-3 flex-1" />
                  <span className="text-sm font-semibold tabular-nums">{p.approvedProgress}%</span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-slate-600">
                  <div>
                    <div className="text-slate-400">Start</div>
                    {formatDate(p.startDate)}
                  </div>
                  <div>
                    <div className="text-slate-400">Expected</div>
                    {formatDate(p.expectedEndDate)}
                  </div>
                  <div>
                    <div className="text-slate-400">Work</div>
                    {p.taskCounts.done} done · {p.taskCounts.pending} pending
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

interface Timeline {
  project: {
    id: string;
    title: string;
    status: string;
    startDate: string;
    expectedEndDate: string;
    completedAt?: string;
    approvedProgress: number;
  };
  milestones: Milestone[];
  totals: { total: number; completed: number; pending: number; current: Milestone | null };
  history: { approved: number; at: string }[];
}

function TimelineView({ projectId }: { projectId: string }) {
  const tl = useQuery({
    queryKey: ['projects', projectId, 'timeline'],
    queryFn: async () => (await getData<Timeline>(`/projects/${projectId}/timeline`)).data,
  });
  if (tl.isLoading) return <Skeleton className="h-48" />;
  if (tl.isError) return <FormAlert>{errorMessage(tl.error)}</FormAlert>;
  const t = tl.data!;
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="p-5 lg:col-span-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-semibold text-slate-900">{t.project.title}</div>
          <StatusBadge status={t.project.status} />
        </div>
        <div className="mt-4 flex items-center gap-3">
          <ProgressBar value={t.project.approvedProgress} className="h-3 flex-1" />
          <span className="text-lg font-semibold tabular-nums">{t.project.approvedProgress}%</span>
        </div>
        <div className="mt-3 grid gap-3 text-sm sm:grid-cols-4">
          <div>
            <div className="text-xs text-slate-500">Start date</div>
            {formatDate(t.project.startDate)}
          </div>
          <div>
            <div className="text-xs text-slate-500">Expected completion</div>
            {formatDate(t.project.expectedEndDate)}
          </div>
          <div>
            <div className="text-xs text-slate-500">Milestones</div>
            {t.totals.completed} of {t.totals.total} completed
          </div>
          <div>
            <div className="text-xs text-slate-500">Current milestone</div>
            {t.totals.current?.title ?? (t.totals.total ? 'All complete' : '—')}
          </div>
        </div>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader title="Timeline" />
        {t.milestones.length === 0 ? (
          <p className="px-5 py-4 text-sm text-slate-500">
            Milestones will be added by the Innovexa team.
          </p>
        ) : (
          <ol className="relative space-y-6 px-6 py-5">
            {t.milestones.map((m, i) => {
              const done = m.status === 'COMPLETED';
              const current = t.totals.current?.id === m.id;
              return (
                <li key={m.id} className="relative pl-8">
                  {i < t.milestones.length - 1 && (
                    <span
                      className="absolute left-[11px] top-6 h-full w-px bg-slate-200"
                      aria-hidden
                    />
                  )}
                  <span
                    className={cn(
                      'absolute left-0 top-0.5 grid size-6 place-items-center rounded-full border-2 text-[10px] font-bold',
                      done
                        ? 'border-emerald-500 bg-emerald-500 text-white'
                        : current
                          ? 'border-brand-600 bg-white text-brand-700'
                          : 'border-slate-300 bg-white text-slate-400',
                    )}
                  >
                    {done ? '✓' : i + 1}
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-900">{m.title}</span>
                    {current && <StatusBadge status="IN_PROGRESS" label="Current" />}
                    {done && <StatusBadge status="COMPLETED" />}
                  </div>
                  {m.description && (
                    <p className="mt-0.5 text-sm text-slate-600">{m.description}</p>
                  )}
                  <div className="mt-0.5 text-xs text-slate-500">
                    {done
                      ? `Completed ${formatDate(m.completedAt)}`
                      : `Expected ${formatDate(m.dueDate)}`}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Card>
      <Card>
        <CardHeader title="Approved progress history" />
        <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto text-sm">
          {[...t.history].reverse().map((h, i) => (
            <li key={i} className="flex justify-between px-5 py-2">
              <span className="font-medium tabular-nums">{h.approved}%</span>
              <span className="text-xs text-slate-500">{formatDateTime(h.at)}</span>
            </li>
          ))}
          {t.history.length === 0 && (
            <li className="px-5 py-3 text-slate-500">No approved progress yet.</li>
          )}
        </ul>
      </Card>
    </div>
  );
}

export function ClientTimelinePage() {
  return (
    <ProjectScoped
      title="Project timeline"
      description="Milestones, delivery dates and approved progress."
    >
      {(id) => <TimelineView projectId={id} />}
    </ProjectScoped>
  );
}

export function ClientMilestonesPage() {
  return (
    <ProjectScoped title="Milestones" description="Completed and pending milestones.">
      {(id) => <MilestoneList projectId={id} />}
    </ProjectScoped>
  );
}

function MilestoneList({ projectId }: { projectId: string }) {
  const ms = useQuery({
    queryKey: ['projects', projectId, 'milestones'],
    queryFn: async () => (await getData<Milestone[]>(`/projects/${projectId}/milestones`)).data,
  });
  if (ms.isLoading) return <Skeleton className="h-32" />;
  const done = ms.data?.filter((m) => m.status === 'COMPLETED') ?? [];
  const pending = ms.data?.filter((m) => m.status !== 'COMPLETED') ?? [];
  const list = (items: Milestone[], empty: string) =>
    items.length === 0 ? (
      <p className="px-5 py-4 text-sm text-slate-500">{empty}</p>
    ) : (
      <ul className="divide-y divide-slate-100 text-sm">
        {items.map((m) => (
          <li key={m.id} className="flex justify-between gap-2 px-5 py-3">
            <div>
              <div className="font-medium">{m.title}</div>
              {m.description && <div className="text-xs text-slate-500">{m.description}</div>}
            </div>
            <div className="text-right text-xs text-slate-500">
              <StatusBadge status={m.status} />
              <div className="mt-1">
                {m.completedAt
                  ? `Done ${formatDate(m.completedAt)}`
                  : `Due ${formatDate(m.dueDate)}`}
              </div>
            </div>
          </li>
        ))}
      </ul>
    );
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title={`Completed (${done.length})`} />
        {list(done, 'No completed milestones yet.')}
      </Card>
      <Card>
        <CardHeader title={`Pending (${pending.length})`} />
        {list(pending, 'Nothing pending.')}
      </Card>
    </div>
  );
}

interface WorkItem {
  id: string;
  title: string;
  approvedProgress: number;
  dueDate?: string;
  approvedAt?: string;
  state: string;
}

function WorkList({ projectId, which }: { projectId: string; which: 'completed' | 'pending' }) {
  const work = useQuery({
    queryKey: ['projects', projectId, 'work'],
    queryFn: async () =>
      (await getData<{ completed: WorkItem[]; pending: WorkItem[] }>(`/projects/${projectId}/work`))
        .data,
  });
  if (work.isLoading) return <Skeleton className="h-32" />;
  if (work.isError) return <FormAlert>{errorMessage(work.error)}</FormAlert>;
  const items = work.data![which];
  return (
    <Card>
      {items.length === 0 ? (
        <EmptyState
          icon={which === 'completed' ? <CheckCircle2 /> : <Clock />}
          title={which === 'completed' ? 'No approved work yet' : 'No pending work'}
          description={
            which === 'completed'
              ? 'Work appears here after Innovexa approves it.'
              : 'All planned work is complete.'
          }
        />
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((w) => (
            <li key={w.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
              <span className="min-w-0 flex-1 font-medium text-slate-900">{w.title}</span>
              {which === 'pending' && (
                <div className="flex w-40 items-center gap-2">
                  <ProgressBar value={w.approvedProgress} className="flex-1" />
                  <span className="text-xs tabular-nums">{w.approvedProgress}%</span>
                </div>
              )}
              <StatusBadge status={w.state} />
              <span className="w-32 text-right text-xs text-slate-500">
                {which === 'completed'
                  ? `Approved ${formatDate(w.approvedAt)}`
                  : w.dueDate
                    ? `Target ${formatDate(w.dueDate)}`
                    : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function CompletedWorkPage() {
  return (
    <ProjectScoped title="Completed work" description="Work approved by the Innovexa team.">
      {(id) => <WorkList projectId={id} which="completed" />}
    </ProjectScoped>
  );
}

export function PendingWorkPage() {
  return (
    <ProjectScoped
      title="Pending work"
      description="Planned work still in progress (approved progress shown)."
    >
      {(id) => <WorkList projectId={id} which="pending" />}
    </ProjectScoped>
  );
}

function DeliverableFiles({ projectId }: { projectId: string }) {
  const files = useQuery({
    queryKey: ['files', 'PROJECT', projectId],
    queryFn: async () =>
      (
        await getData<(Attachment & { createdAt: string; mimeType?: string })[]>('/files', {
          kind: 'PROJECT',
          refId: projectId,
        })
      ).data,
  });
  if (files.isLoading) return <Skeleton className="h-32" />;
  if (files.isError) return <FormAlert>{errorMessage(files.error)}</FormAlert>;
  return (
    <Card>
      {files.data!.length === 0 ? (
        <EmptyState
          icon={<FileText />}
          title="No deliverables yet"
          description="Files approved for you by Innovexa will appear here."
        />
      ) : (
        <ul className="divide-y divide-slate-100">
          {files.data!.map((f) => (
            <li key={f.id} className="flex items-center gap-3 px-5 py-3 text-sm">
              <FileText className="size-4 text-slate-400" />
              <span className="min-w-0 flex-1 truncate font-medium">{f.name}</span>
              <span className="text-xs text-slate-500">{formatDate(f.createdAt)}</span>
              <a href={f.url}>
                <Button size="sm" variant="secondary">
                  <Download /> Download
                </Button>
              </a>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function ClientFilesPage() {
  return (
    <ProjectScoped
      title="Files & deliverables"
      description="Admin-approved deliverables you can download."
    >
      {(id) => <DeliverableFiles projectId={id} />}
    </ProjectScoped>
  );
}

export function ClientProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'timeline' | 'completed' | 'pending' | 'files'>('timeline');
  const project = useQuery({
    queryKey: ['projects', id],
    queryFn: async () => (await getData<Project>(`/projects/${id}`)).data,
  });
  const invoices = useQuery({
    queryKey: ['invoices', 'project', id],
    queryFn: async () => (await getData<Invoice[]>('/invoices', { projectId: id })).data,
  });
  const startChat = async () => {
    const c = await postData<Conversation>('/conversations', { projectId: id });
    navigate(`/client/messages?c=${c.id}`);
  };
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [id]);
  if (project.isLoading) return <Skeleton className="h-64" />;
  if (project.isError) return <FormAlert>{errorMessage(project.error)}</FormAlert>;
  const p = project.data!;
  return (
    <>
      <Link
        to="/client/projects"
        className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="size-4" /> My projects
      </Link>
      <PageHeader
        title={p.title}
        description={`${p.projectCode} · ${p.serviceCategory?.name ?? ''}`}
        actions={
          <>
            <StatusBadge status={p.status} />
            <Button variant="secondary" onClick={() => void startChat()}>
              <MessageSquare /> Message Innovexa
            </Button>
            <Link to="/client/change-requests">
              <Button variant="secondary">
                <ListChecks /> Request a change
              </Button>
            </Link>
          </>
        }
      />
      {p.description && (
        <Card className="mb-6 p-5 text-sm text-slate-700">
          <p className="whitespace-pre-wrap">{p.description}</p>
        </Card>
      )}
      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200">
        {(['timeline', 'completed', 'pending', 'files'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium',
              tab === t ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500',
            )}
          >
            {
              {
                timeline: 'Timeline',
                completed: 'Completed work',
                pending: 'Pending work',
                files: 'Files & deliverables',
              }[t]
            }
          </button>
        ))}
      </div>
      {tab === 'timeline' && <TimelineView projectId={p.id} />}
      {tab === 'completed' && <WorkList projectId={p.id} which="completed" />}
      {tab === 'pending' && <WorkList projectId={p.id} which="pending" />}
      {tab === 'files' && <DeliverableFiles projectId={p.id} />}
      {!!invoices.data?.length && (
        <Card className="mt-6">
          <CardHeader title="Invoices for this project" />
          <ul className="divide-y divide-slate-100 text-sm">
            {invoices.data.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <Link to={`/client/invoices/${i.id}`} className="font-medium hover:text-brand-700">
                  {i.invoiceNumber}
                </Link>
                <StatusBadge status={i.status} />
                <span className="ml-auto tabular-nums">
                  {money(i.totalMinor)} · balance {money(Math.max(0, i.balanceMinor))}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

export function ClientInvoicesPage() {
  const invoices = useQuery({
    queryKey: ['invoices', 'client'],
    queryFn: async () => (await getData<Invoice[]>('/invoices', { limit: 100 })).data,
  });
  return (
    <>
      <PageHeader
        title="Invoices & payments"
        description="Total project amount, advance, EMI schedule and remaining balance."
      />
      {invoices.isLoading ? (
        <Skeleton className="h-40" />
      ) : invoices.isError ? (
        <FormAlert>{errorMessage(invoices.error)}</FormAlert>
      ) : invoices.data!.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FileText />}
            title="No invoices yet"
            description="Invoices from Innovexa will appear here."
          />
        </Card>
      ) : (
        <Card>
          <TableShell minWidth={760}>
            <thead>
              <tr>
                <th className={th}>Invoice</th>
                <th className={th}>Project</th>
                <th className={th}>Status</th>
                <th className={`${th} text-right`}>Total</th>
                <th className={`${th} text-right`}>Advance paid</th>
                <th className={`${th} text-right`}>Paid</th>
                <th className={`${th} text-right`}>Balance</th>
                <th className={th}>Next due</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invoices.data!.map((i) => (
                <tr key={i.id} className="hover:bg-slate-50/60">
                  <td className={td}>
                    <Link
                      to={`/client/invoices/${i.id}`}
                      className="font-medium text-slate-900 hover:text-brand-700"
                    >
                      {i.invoiceNumber}
                    </Link>
                    <div className="text-xs text-slate-500">{humanize(i.paymentTerms)}</div>
                  </td>
                  <td className={td}>{i.project?.title}</td>
                  <td className={td}>
                    <StatusBadge status={i.status} />
                  </td>
                  <td className={`${td} text-right tabular-nums`}>{money(i.totalMinor)}</td>
                  <td className={`${td} text-right tabular-nums`}>{money(i.advancePaidMinor)}</td>
                  <td className={`${td} text-right tabular-nums`}>{money(i.paidMinor)}</td>
                  <td className={`${td} text-right tabular-nums`}>
                    {money(Math.max(0, i.balanceMinor))}
                  </td>
                  <td className={td}>
                    {i.nextDue
                      ? `${money(i.nextDue.dueMinor)} · ${formatDate(i.nextDue.dueDate)}`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </Card>
      )}
    </>
  );
}
