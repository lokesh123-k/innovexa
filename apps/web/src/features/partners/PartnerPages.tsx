import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  Clock,
  Columns3,
  FileClock,
  FolderKanban,
  List,
  Send,
  Timer,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import { PROGRESS_PRESETS, TaskStatus, WorkReportType } from '@innovexa/shared';
import { Button } from '@/components/ui/button';
import {
  AttachmentList,
  DetailList,
  FilePicker,
  ProgressBar,
  StatTile,
  StatusBadge,
  Tabs,
  Textarea,
} from '@/components/ui/extra';
import { Field, FormAlert, Input, Select } from '@/components/ui/form';
import { Card, CardHeader, EmptyState, PageHeader, Skeleton } from '@/components/ui/misc';
import { TaskRows } from '@/features/admin/ProjectsPages';
import { TaskBoard, UpdateHistory } from '@/features/admin/TasksPages';
import { useAuth } from '@/features/auth/AuthProvider';
import { errorMessage, getData, postData, uploadFile } from '@/lib/api';
import { minutesToHours } from '@/lib/format';
import { fromDateInput, toDateInput } from '@/lib/hooks';
import { cn, formatDate, formatDateTime, humanize } from '@/lib/utils';
import type { Milestone, Project, Task, TaskUpdateEntry, WorkReport } from '@/types';

interface PartnerDash {
  activeProjects: number;
  tasks: {
    total: number;
    done: number;
    pending: number;
    awaitingReview: number;
    revision: number;
    overdue: number;
    inProgress: number;
    completionPercent: number;
  };
  upcomingDeadlines: {
    id: string;
    title: string;
    dueDate: string;
    priority: string;
    status: string;
    submittedProgress: number;
    approvedProgress: number;
    projectId?: { title: string };
  }[];
  weekly: { minutes: number; tasksCompleted: number };
  monthly: { minutes: number; tasksCompleted: number };
  revisionRequests: { id: string; title: string; project?: { title: string }; feedback?: string }[];
}

const useDash = () =>
  useQuery({
    queryKey: ['dashboard', 'partner'],
    queryFn: async () => (await getData<PartnerDash>('/dashboard/partner')).data,
  });

export function PartnerDashboard() {
  const { user } = useAuth();
  const dash = useDash();
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
  const p = user?.partnerProfile;
  return (
    <>
      <PageHeader
        title={`Hello, ${user?.name.split(' ')[0]}`}
        description={
          p
            ? `${humanize(p.partnerType)}${p.category ? ` · ${p.category}` : ''}`
            : 'Your daily work at a glance.'
        }
        actions={
          <Link to="/partner/daily-updates">
            <Button>
              <FileClock /> Submit daily report
            </Button>
          </Link>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="My projects" value={d.activeProjects} icon={<FolderKanban />} />
        <StatTile
          label="Assigned tasks"
          value={d.tasks.total}
          hint={`${d.tasks.inProgress} in progress`}
          icon={<ClipboardList />}
        />
        <StatTile label="Completed" value={d.tasks.done} icon={<CheckCircle2 />} tone="green" />
        <StatTile label="Pending" value={d.tasks.pending} icon={<Clock />} />
        <StatTile
          label="Overdue"
          value={d.tasks.overdue}
          icon={<AlertTriangle />}
          tone={d.tasks.overdue ? 'red' : 'green'}
        />
        <StatTile
          label="Waiting for approval"
          value={d.tasks.awaitingReview}
          icon={<Send />}
          tone="amber"
        />
        <StatTile
          label="This week"
          value={minutesToHours(d.weekly.minutes)}
          hint={`${d.weekly.tasksCompleted} tasks approved`}
          icon={<Timer />}
        />
        <StatTile
          label="Work completion"
          value={`${d.tasks.completionPercent}%`}
          hint={`Last 30 days: ${minutesToHours(d.monthly.minutes)} · ${d.monthly.tasksCompleted} approved`}
          icon={<CheckCircle2 />}
          tone="green"
        />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Upcoming deadlines"
            action={
              <Link
                to="/partner/tasks"
                className="text-xs font-medium text-brand-700 hover:underline"
              >
                All tasks
              </Link>
            }
          />
          {d.upcomingDeadlines.length === 0 ? (
            <EmptyState
              icon={<ClipboardList />}
              title="No deadlines"
              description="Tasks with due dates appear here."
            />
          ) : (
            <ul className="divide-y divide-slate-100">
              {d.upcomingDeadlines.map((t) => {
                const overdue = new Date(t.dueDate) < new Date();
                return (
                  <li key={t.id}>
                    <Link
                      to={`/partner/tasks/${t.id}`}
                      className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm hover:bg-slate-50"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-slate-900">{t.title}</div>
                        <div className="text-xs text-slate-500">{t.projectId?.title}</div>
                      </div>
                      <StatusBadge status={t.priority} />
                      <span
                        className={cn(
                          'text-xs',
                          overdue ? 'font-semibold text-red-600' : 'text-slate-500',
                        )}
                      >
                        {overdue ? 'Overdue · ' : ''}
                        {formatDate(t.dueDate)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Revision requests" description="Feedback from the Innovexa team" />
          {d.revisionRequests.length === 0 ? (
            <EmptyState
              icon={<CheckCircle2 />}
              title="No revisions requested"
              description="Rejected work and feedback will show here."
            />
          ) : (
            <ul className="divide-y divide-slate-100">
              {d.revisionRequests.map((r) => (
                <li key={r.id}>
                  <Link
                    to={`/partner/tasks/${r.id}`}
                    className="block px-5 py-3 text-sm hover:bg-slate-50"
                  >
                    <div className="font-medium text-slate-900">{r.title}</div>
                    {r.feedback && (
                      <p className="mt-1 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-900">
                        {r.feedback}
                      </p>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

export function PartnerProjectsPage() {
  const projects = useQuery({
    queryKey: ['projects', 'partner'],
    queryFn: async () => (await getData<Project[]>('/projects', { limit: 100 })).data,
  });
  return (
    <>
      <PageHeader title="My projects" description="Projects you are allocated to." />
      {projects.isLoading ? (
        <Skeleton className="h-40" />
      ) : projects.isError ? (
        <FormAlert>{errorMessage(projects.error)}</FormAlert>
      ) : projects.data!.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FolderKanban />}
            title="No projects yet"
            description="You'll see projects here once the admin allocates you."
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.data!.map((p) => (
            <Link key={p.id} to={`/partner/projects/${p.id}`}>
              <Card className="h-full p-5 transition-shadow hover:shadow-md">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-semibold text-slate-900">{p.title}</div>
                  <StatusBadge status={p.status} />
                </div>
                <div className="mt-0.5 text-xs text-slate-500">
                  {p.projectCode} · {p.client?.companyName}
                </div>
                <ProgressBar value={p.approvedProgress} className="mt-4" />
                <div className="mt-2 flex justify-between text-xs text-slate-600">
                  <span>{p.approvedProgress}% approved</span>
                  <span>
                    My tasks: {p.taskCounts.done}/{p.taskCounts.total} done
                  </span>
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  Due {formatDate(p.expectedEndDate)}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

export function PartnerProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const project = useQuery({
    queryKey: ['projects', id],
    queryFn: async () =>
      (await getData<Project & { milestones: Milestone[] }>(`/projects/${id}`)).data,
  });
  const tasks = useQuery({
    queryKey: ['tasks', 'project', id],
    queryFn: async () => (await getData<Task[]>('/tasks', { projectId: id, limit: 100 })).data,
  });
  if (project.isLoading) return <Skeleton className="h-64" />;
  if (project.isError) return <FormAlert>{errorMessage(project.error)}</FormAlert>;
  const p = project.data!;
  return (
    <>
      <Link
        to="/partner/projects"
        className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="size-4" /> My projects
      </Link>
      <PageHeader
        title={p.title}
        description={`${p.projectCode} · ${p.client?.companyName}`}
        actions={<StatusBadge status={p.status} />}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <DetailList
            items={[
              ['Description', <p className="whitespace-pre-wrap">{p.description || '—'}</p>],
              ['Requirements', <p className="whitespace-pre-wrap">{p.requirements || '—'}</p>],
              ['Schedule', `${formatDate(p.startDate)} → ${formatDate(p.expectedEndDate)}`],
              ['Approved progress', `${p.approvedProgress}%`],
              ['Team', p.partners?.map((u) => u.name).join(', ')],
            ]}
          />
        </Card>
        <Card>
          <CardHeader title="Milestones" />
          <ul className="divide-y divide-slate-100 text-sm">
            {p.milestones?.map((m) => (
              <li key={m.id} className="flex justify-between gap-2 px-5 py-2.5">
                <span>{m.title}</span>
                <span className="text-xs text-slate-500">
                  {formatDate(m.dueDate)} <StatusBadge status={m.status} />
                </span>
              </li>
            ))}
            {!p.milestones?.length && <li className="px-5 py-3 text-slate-500">No milestones.</li>}
          </ul>
        </Card>
        <Card className="lg:col-span-3">
          <CardHeader title="My tasks in this project" />
          {tasks.data?.length ? (
            <TaskRows tasks={tasks.data} base="/partner/tasks" />
          ) : (
            <p className="px-5 py-4 text-sm text-slate-500">No tasks assigned to you here.</p>
          )}
        </Card>
      </div>
    </>
  );
}

export function PartnerTasksPage() {
  const [view, setView] = useState<'list' | 'board'>('board');
  const [status, setStatus] = useState('');
  const tasks = useQuery({
    queryKey: ['tasks', 'mine', status],
    queryFn: async () =>
      (await getData<Task[]>('/tasks', { limit: 100, ...(status && { status }) })).data,
  });
  return (
    <>
      <PageHeader
        title="My tasks"
        description="Tasks assigned to you by the Innovexa team."
        actions={
          <div className="flex gap-2">
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-48"
              aria-label="Status"
            >
              <option value="">All statuses</option>
              {Object.values(TaskStatus).map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </Select>
            <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
              <Button
                size="sm"
                variant={view === 'list' ? 'secondary' : 'ghost'}
                onClick={() => setView('list')}
              >
                <List /> List
              </Button>
              <Button
                size="sm"
                variant={view === 'board' ? 'secondary' : 'ghost'}
                onClick={() => setView('board')}
              >
                <Columns3 /> Board
              </Button>
            </div>
          </div>
        }
      />
      {tasks.isLoading ? (
        <Skeleton className="h-40" />
      ) : tasks.isError ? (
        <FormAlert>{errorMessage(tasks.error)}</FormAlert>
      ) : tasks.data!.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ClipboardList />}
            title="No tasks"
            description="New assignments will notify you and appear here."
          />
        </Card>
      ) : view === 'board' ? (
        <TaskBoard tasks={tasks.data!} base="/partner/tasks" />
      ) : (
        <Card>
          <TaskRows tasks={tasks.data!} base="/partner/tasks" />
        </Card>
      )}
    </>
  );
}

function ProgressForm({
  task,
  mode,
  onDone,
}: {
  task: Task;
  mode: 'update' | 'submit';
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [progress, setProgress] = useState(
    mode === 'submit' ? 100 : Math.max(task.submittedProgress, 10),
  );
  const [description, setDescription] = useState('');
  const [hours, setHours] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const save = useMutation({
    mutationFn: async () => {
      const uploaded = await Promise.all(files.map((f) => uploadFile(f, 'TASK', task.id)));
      return postData(`/tasks/${task.id}/${mode === 'submit' ? 'submit' : 'updates'}`, {
        newProgress: progress,
        description,
        minutesSpent: Math.round(Number(hours || 0) * 60),
        attachmentIds: uploaded.map((u) => u.id),
      });
    },
    onSuccess: () => {
      toast.success(mode === 'submit' ? 'Submitted for admin approval' : 'Progress updated');
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      onDone();
    },
  });
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      {save.isError && <FormAlert>{errorMessage(save.error)}</FormAlert>}
      <div>
        <div className="mb-1.5 text-sm font-medium text-slate-700">Progress: {progress}%</div>
        <div className="flex flex-wrap gap-1.5">
          {PROGRESS_PRESETS.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setProgress(v)}
              className={cn(
                'rounded-md border px-2.5 py-1 text-xs font-medium',
                progress === v
                  ? 'border-brand-600 bg-brand-50 text-brand-800'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50',
              )}
            >
              {v}%
            </button>
          ))}
          <Input
            type="number"
            min={0}
            max={100}
            value={progress}
            onChange={(e) =>
              setProgress(Math.max(0, Math.min(100, Math.round(Number(e.target.value)))))
            }
            className="h-8 w-20"
            aria-label="Custom percentage"
          />
        </div>
        <p className="mt-1 text-xs text-slate-500">
          This is your reported progress. It becomes client-visible only after admin approval.
        </p>
      </div>
      <Field
        label={mode === 'submit' ? 'What are you submitting?' : 'Work description'}
        htmlFor={`desc-${mode}`}
      >
        <Textarea
          id={`desc-${mode}`}
          required
          minLength={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      <Field label="Time spent (hours)" htmlFor={`hours-${mode}`}>
        <Input
          id={`hours-${mode}`}
          type="number"
          min={0}
          max={24}
          step="0.25"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          className="w-32"
        />
      </Field>
      <div>
        <div className="mb-1.5 text-sm font-medium text-slate-700">
          {mode === 'submit' ? 'Completed files' : 'Attachments'}
        </div>
        <FilePicker files={files} onChange={setFiles} />
      </div>
      <div className="flex justify-end">
        <Button type="submit" loading={save.isPending} disabled={description.trim().length < 3}>
          {mode === 'submit' ? (
            <>
              <Send /> Submit for approval
            </>
          ) : (
            'Save update'
          )}
        </Button>
      </div>
    </form>
  );
}

function IssueForm({ task, onDone }: { task: Task; onDone: () => void }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<'ISSUE' | 'CLARIFICATION'>('CLARIFICATION');
  const [description, setDescription] = useState('');
  const send = useMutation({
    mutationFn: () => postData(`/tasks/${task.id}/issues`, { kind, description }),
    onSuccess: () => {
      toast.success('Sent to the admin team');
      void qc.invalidateQueries({ queryKey: ['tasks', task.id] });
      onDone();
    },
  });
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        send.mutate();
      }}
    >
      {send.isError && <FormAlert>{errorMessage(send.error)}</FormAlert>}
      <Select
        value={kind}
        onChange={(e) => setKind(e.target.value as 'ISSUE' | 'CLARIFICATION')}
        aria-label="Type"
      >
        <option value="CLARIFICATION">Request clarification</option>
        <option value="ISSUE">Report a problem</option>
      </Select>
      <Textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Describe the question or problem"
        aria-label="Description"
      />
      <div className="flex justify-end">
        <Button type="submit" loading={send.isPending} disabled={description.trim().length < 3}>
          Send
        </Button>
      </div>
    </form>
  );
}

export function PartnerTaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<'update' | 'submit' | 'issue'>('update');
  const task = useQuery({
    queryKey: ['tasks', id],
    queryFn: async () => (await getData<Task>(`/tasks/${id}`)).data,
  });
  if (task.isLoading) return <Skeleton className="h-64" />;
  if (task.isError) return <FormAlert>{errorMessage(task.error)}</FormAlert>;
  const t = task.data!;
  const workable = (
    [
      TaskStatus.NOT_STARTED,
      TaskStatus.ASSIGNED,
      TaskStatus.IN_PROGRESS,
      TaskStatus.REVISION_REQUESTED,
    ] as string[]
  ).includes(t.status);
  const lastFeedback = [...t.reviewNotes].reverse().find((n) => n.comment);
  return (
    <>
      <Link
        to="/partner/tasks"
        className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="size-4" /> My tasks
      </Link>
      <PageHeader
        title={t.title}
        description={`${t.project?.projectCode ?? ''} ${t.project?.title ?? ''}`}
        actions={
          <>
            <StatusBadge status={t.priority} />
            <StatusBadge status={t.status} />
          </>
        }
      />
      {t.status === TaskStatus.REVISION_REQUESTED && lastFeedback && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>Revision requested:</strong> {lastFeedback.comment}
        </div>
      )}
      {t.status === TaskStatus.SUBMITTED_FOR_REVIEW && (
        <div className="mb-4 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-900">
          Your submission is awaiting admin review.
        </div>
      )}
      {t.status === TaskStatus.APPROVED && (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          Approved{lastFeedback ? `: ${lastFeedback.comment}` : '.'}
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card className="p-5">
            <div className="mb-4 grid gap-4 sm:grid-cols-2">
              <div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Approved</span>
                  <span className="font-semibold">{t.approvedProgress}%</span>
                </div>
                <ProgressBar value={t.approvedProgress} className="mt-1.5" />
              </div>
              <div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">My reported progress</span>
                  <span className="font-semibold">{t.submittedProgress}%</span>
                </div>
                <ProgressBar value={t.submittedProgress} className="mt-1.5" />
              </div>
            </div>
            <DetailList
              items={[
                ['Description', <p className="whitespace-pre-wrap">{t.description || '—'}</p>],
                ['Instructions', <p className="whitespace-pre-wrap">{t.instructions || '—'}</p>],
                [
                  'Expected deliverables',
                  <p className="whitespace-pre-wrap">{t.expectedDeliverables || '—'}</p>,
                ],
                ['Deadline', `${formatDate(t.dueDate)}${t.isOverdue ? ' (overdue)' : ''}`],
                [
                  'Estimated / logged',
                  `${t.estimatedHours ?? '—'}h · ${minutesToHours(t.loggedMinutes)} logged`,
                ],
              ]}
            />
            {!!t.attachments?.length && (
              <div className="mt-4">
                <div className="text-xs font-medium uppercase text-slate-500">Reference files</div>
                <AttachmentList files={t.attachments} />
              </div>
            )}
          </Card>
          <Card>
            <CardHeader title="My updates & admin feedback" />
            <UpdateHistory updates={t.updates} />
          </Card>
        </div>
        <Card className="p-5">
          {workable ? (
            <>
              <Tabs
                tabs={[
                  { value: 'update', label: 'Update progress' },
                  { value: 'submit', label: 'Submit work' },
                  { value: 'issue', label: 'Ask / report' },
                ]}
                value={tab}
                onChange={setTab}
              />
              {tab === 'update' && <ProgressForm task={t} mode="update" onDone={() => undefined} />}
              {tab === 'submit' && (
                <ProgressForm task={t} mode="submit" onDone={() => setTab('update')} />
              )}
              {tab === 'issue' && <IssueForm task={t} onDone={() => setTab('update')} />}
            </>
          ) : (
            <>
              <p className="mb-4 text-sm text-slate-600">
                Progress updates are paused while this task is {humanize(t.status).toLowerCase()}.
              </p>
              <IssueForm task={t} onDone={() => undefined} />
            </>
          )}
        </Card>
      </div>
    </>
  );
}

export function WorkReportsPage() {
  const qc = useQueryClient();
  const [type, setType] = useState<'DAILY' | 'WEEKLY'>(WorkReportType.DAILY);
  const [f, setF] = useState({
    date: toDateInput(new Date()),
    periodEnd: '',
    workCompleted: '',
    progressPercent: '',
    hours: '',
    problems: '',
    nextPlan: '',
  });
  const [taskIds, setTaskIds] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((x) => ({ ...x, [k]: e.target.value }));
  const tasks = useQuery({
    queryKey: ['tasks', 'mine', 'open'],
    queryFn: async () => (await getData<Task[]>('/tasks', { limit: 100 })).data,
  });
  const reports = useQuery({
    queryKey: ['work-reports', 'mine'],
    queryFn: async () => (await getData<WorkReport[]>('/work-reports', { limit: 50 })).data,
  });
  const submit = useMutation({
    mutationFn: async () => {
      const report = await postData<{ _id: string }>('/work-reports', {
        type,
        date: fromDateInput(f.date),
        ...(type === 'WEEKLY' && f.periodEnd && { periodEnd: fromDateInput(f.periodEnd) }),
        taskIds,
        workCompleted: f.workCompleted,
        ...(f.progressPercent && { progressPercent: Number(f.progressPercent) }),
        minutesWorked: Math.round(Number(f.hours || 0) * 60),
        ...(f.problems && { problems: f.problems }),
        ...(f.nextPlan && { nextPlan: f.nextPlan }),
      });
      await Promise.all(files.map((file) => uploadFile(file, 'WORK_REPORT', report._id)));
    },
    onSuccess: () => {
      toast.success(`${humanize(type)} report submitted`);
      setF((x) => ({
        ...x,
        workCompleted: '',
        progressPercent: '',
        hours: '',
        problems: '',
        nextPlan: '',
      }));
      setTaskIds([]);
      setFiles([]);
      void qc.invalidateQueries({ queryKey: ['work-reports'] });
    },
  });
  return (
    <>
      <PageHeader
        title="Daily work updates"
        description="Submit daily or weekly reports. Admins can view and filter all reports."
      />
      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="p-5 lg:col-span-2">
          <Tabs
            tabs={[
              { value: 'DAILY', label: 'Daily report' },
              { value: 'WEEKLY', label: 'Weekly report' },
            ]}
            value={type}
            onChange={setType}
          />
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              submit.mutate();
            }}
          >
            {submit.isError && <FormAlert>{errorMessage(submit.error)}</FormAlert>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={type === 'DAILY' ? 'Date' : 'Week starting'} htmlFor="wr-date">
                <Input
                  id="wr-date"
                  type="date"
                  required
                  max={toDateInput(new Date())}
                  value={f.date}
                  onChange={set('date')}
                />
              </Field>
              {type === 'WEEKLY' && (
                <Field label="Week ending" htmlFor="wr-end">
                  <Input id="wr-end" type="date" value={f.periodEnd} onChange={set('periodEnd')} />
                </Field>
              )}
              <Field label="Hours worked" htmlFor="wr-hours">
                <Input
                  id="wr-hours"
                  type="number"
                  min={0}
                  step="0.25"
                  required
                  value={f.hours}
                  onChange={set('hours')}
                />
              </Field>
              <Field label="Progress %" htmlFor="wr-progress">
                <Input
                  id="wr-progress"
                  type="number"
                  min={0}
                  max={100}
                  value={f.progressPercent}
                  onChange={set('progressPercent')}
                />
              </Field>
            </div>
            <div>
              <div className="mb-1.5 text-sm font-medium text-slate-700">Tasks worked on</div>
              <div className="max-h-32 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
                {tasks.data?.map((t) => (
                  <label key={t.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={taskIds.includes(t.id)}
                      onChange={(e) =>
                        setTaskIds((ids) =>
                          e.target.checked ? [...ids, t.id] : ids.filter((x) => x !== t.id),
                        )
                      }
                    />
                    {t.title}
                  </label>
                ))}
                {!tasks.data?.length && (
                  <p className="text-xs text-slate-500">No assigned tasks.</p>
                )}
              </div>
            </div>
            <Field label="Work completed" htmlFor="wr-work">
              <Textarea
                id="wr-work"
                required
                minLength={3}
                value={f.workCompleted}
                onChange={set('workCompleted')}
              />
            </Field>
            <Field label="Problems faced" htmlFor="wr-problems">
              <Textarea
                id="wr-problems"
                value={f.problems}
                onChange={set('problems')}
                className="min-h-16"
              />
            </Field>
            <Field
              label={type === 'DAILY' ? 'Plan for next working day' : 'Plan for next week'}
              htmlFor="wr-next"
            >
              <Textarea
                id="wr-next"
                value={f.nextPlan}
                onChange={set('nextPlan')}
                className="min-h-16"
              />
            </Field>
            <div>
              <div className="mb-1.5 text-sm font-medium text-slate-700">Attachments</div>
              <FilePicker files={files} onChange={setFiles} />
            </div>
            <Button type="submit" className="w-full" loading={submit.isPending}>
              Submit {type === 'DAILY' ? 'daily' : 'weekly'} report
            </Button>
          </form>
        </Card>
        <Card className="lg:col-span-3">
          <CardHeader title="My reports" />
          {reports.isLoading ? (
            <Skeleton className="m-4 h-24" />
          ) : !reports.data?.length ? (
            <EmptyState
              icon={<FileClock />}
              title="No reports yet"
              description="Your submitted reports will be listed here."
            />
          ) : (
            <ul className="divide-y divide-slate-100">
              {reports.data.map((r) => (
                <li key={r._id} className="px-5 py-3 text-sm">
                  <div className="flex flex-wrap justify-between gap-2">
                    <span className="font-medium">
                      {humanize(r.type)} · {formatDate(r.date)}
                      {r.periodEnd && ` – ${formatDate(r.periodEnd)}`}
                    </span>
                    <span className="text-slate-500">
                      {minutesToHours(r.minutesWorked)}
                      {r.progressPercent != null && ` · ${r.progressPercent}%`}
                    </span>
                  </div>
                  {r.taskIds.length > 0 && (
                    <div className="text-xs text-slate-500">
                      {r.taskIds.map((t) => t.title).join(', ')}
                    </div>
                  )}
                  <p className="mt-1 whitespace-pre-wrap text-slate-700">{r.workCompleted}</p>
                  {r.problems && (
                    <p className="mt-1 text-xs text-amber-800">Problems: {r.problems}</p>
                  )}
                  {r.nextPlan && (
                    <p className="mt-0.5 text-xs text-slate-500">Next: {r.nextPlan}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

export function TimeTrackingPage() {
  const [range, setRange] = useState<'7' | '30' | '90'>('7');
  const from = new Date(Date.now() - Number(range) * 86_400_000).toISOString();
  const to = new Date().toISOString();
  const summary = useQuery({
    queryKey: ['time', range],
    queryFn: async () =>
      (
        await getData<{
          byDay: { _id: string; minutes: number }[];
          byTask: { _id: string; title?: string; minutes: number; updates: number }[];
          reported: { _id: string; minutes: number; reports: number }[];
        }>('/work-reports/time/summary', { from, to })
      ).data,
  });
  const total = summary.data?.byDay.reduce((s, d) => s + d.minutes, 0) ?? 0;
  const reported = summary.data?.reported.reduce((s, r) => s + r.minutes, 0) ?? 0;
  return (
    <>
      <PageHeader
        title="Time tracking"
        description="Time logged on task updates and in your work reports."
        actions={
          <Select
            value={range}
            onChange={(e) => setRange(e.target.value as '7' | '30' | '90')}
            className="w-40"
            aria-label="Range"
          >
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </Select>
        }
      />
      {summary.isLoading ? (
        <Skeleton className="h-64" />
      ) : summary.isError ? (
        <FormAlert>{errorMessage(summary.error)}</FormAlert>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <StatTile label="Logged on tasks" value={minutesToHours(total)} icon={<Timer />} />
          <StatTile
            label="Reported in work reports"
            value={minutesToHours(reported)}
            icon={<FileClock />}
          />
          <StatTile
            label="Tasks worked on"
            value={summary.data!.byTask.length}
            icon={<ClipboardList />}
          />
          <Card className="lg:col-span-2">
            <CardHeader title="Hours per day" />
            <div className="h-64 p-4">
              {summary.data!.byDay.length === 0 ? (
                <EmptyState
                  icon={<Timer />}
                  title="No time logged"
                  description="Add hours when you update task progress."
                />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={summary.data!.byDay.map((d) => ({
                      day: d._id.slice(5),
                      hours: Math.round((d.minutes / 60) * 10) / 10,
                    }))}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="day" tick={{ fontSize: 12, fill: '#64748b' }} />
                    <YAxis tick={{ fontSize: 12, fill: '#64748b' }} width={32} />
                    <Tooltip formatter={(v: number) => [`${v}h`, 'Logged']} />
                    <Bar dataKey="hours" fill="#1d40d8" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </Card>
          <Card>
            <CardHeader title="By task" />
            <ul className="divide-y divide-slate-100 text-sm">
              {summary.data!.byTask.map((t) => (
                <li key={t._id} className="flex justify-between gap-2 px-5 py-2.5">
                  <Link to={`/partner/tasks/${t._id}`} className="truncate hover:text-brand-700">
                    {t.title}
                  </Link>
                  <span className="tabular-nums text-slate-600">{minutesToHours(t.minutes)}</span>
                </li>
              ))}
              {!summary.data!.byTask.length && (
                <li className="px-5 py-3 text-slate-500">Nothing yet.</li>
              )}
            </ul>
          </Card>
        </div>
      )}
    </>
  );
}

export function SubmissionsPage() {
  const [filter, setFilter] = useState<'all' | 'PENDING' | 'APPROVED' | 'REJECTED'>('all');
  const subs = useQuery({
    queryKey: ['tasks', 'my-updates', 'SUBMISSION'],
    queryFn: async () =>
      (await getData<TaskUpdateEntry[]>('/tasks/my-updates', { kind: 'SUBMISSION', limit: 100 }))
        .data,
  });
  const items = subs.data?.filter((s) => filter === 'all' || s.reviewStatus === filter) ?? [];
  const count = (st: string) => subs.data?.filter((s) => s.reviewStatus === st).length;
  return (
    <>
      <PageHeader
        title="Work submissions"
        description="Everything you've submitted for approval and the admin's decision."
      />
      <Tabs
        tabs={[
          { value: 'all', label: 'All', count: subs.data?.length },
          { value: 'PENDING', label: 'Pending', count: count('PENDING') },
          { value: 'APPROVED', label: 'Approved', count: count('APPROVED') },
          { value: 'REJECTED', label: 'Revision requested', count: count('REJECTED') },
        ]}
        value={filter}
        onChange={setFilter}
      />
      <Card>
        {subs.isLoading ? (
          <Skeleton className="m-4 h-24" />
        ) : subs.isError ? (
          <div className="p-4">
            <FormAlert>{errorMessage(subs.error)}</FormAlert>
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Send />}
            title="No submissions"
            description="Submit work from a task page when it's ready for review."
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {items.map((s) => (
              <li key={s.id} className="px-5 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    to={`/partner/tasks/${s.task?._id}`}
                    className="font-medium text-slate-900 hover:text-brand-700"
                  >
                    {s.task?.title}
                  </Link>
                  <StatusBadge
                    status={s.reviewStatus === 'REJECTED' ? 'REVISION_REQUESTED' : s.reviewStatus}
                    label={
                      s.reviewStatus === 'REJECTED'
                        ? 'Revision requested'
                        : humanize(s.reviewStatus)
                    }
                  />
                  <span className="text-xs text-slate-500">
                    {s.newProgress}% · {formatDateTime(s.createdAt)}
                  </span>
                </div>
                <p className="mt-1 text-slate-700">{s.description}</p>
                <AttachmentList files={s.attachments} />
                {s.reviewComment && (
                  <p className="mt-1 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-900">
                    Feedback: {s.reviewComment}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

export function PerformancePage() {
  const dash = useDash();
  const subs = useQuery({
    queryKey: ['tasks', 'my-updates', 'SUBMISSION'],
    queryFn: async () =>
      (await getData<TaskUpdateEntry[]>('/tasks/my-updates', { kind: 'SUBMISSION', limit: 100 }))
        .data,
  });
  if (dash.isLoading) return <Skeleton className="h-64" />;
  if (dash.isError) return <FormAlert>{errorMessage(dash.error)}</FormAlert>;
  const d = dash.data!;
  const reviewed = subs.data?.filter((s) => s.reviewStatus !== 'PENDING') ?? [];
  const firstTime = reviewed.length
    ? Math.round(
        (reviewed.filter((s) => s.reviewStatus === 'APPROVED').length / reviewed.length) * 100,
      )
    : 0;
  return (
    <>
      <PageHeader
        title="My performance"
        description="Personal performance report based on approved work."
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Completion rate"
          value={`${d.tasks.completionPercent}%`}
          hint={`${d.tasks.done} of ${d.tasks.total} tasks approved`}
          tone="green"
        />
        <StatTile
          label="Approval rate"
          value={`${firstTime}%`}
          hint={`${reviewed.length} reviewed submissions`}
          tone="green"
        />
        <StatTile
          label="Hours (30 days)"
          value={minutesToHours(d.monthly.minutes)}
          hint={`${minutesToHours(d.weekly.minutes)} this week`}
        />
        <StatTile
          label="Overdue tasks"
          value={d.tasks.overdue}
          tone={d.tasks.overdue ? 'red' : 'green'}
        />
      </div>
      <Card className="mt-6 p-5">
        <div className="mb-3 text-sm font-semibold text-slate-800">Work status</div>
        {[
          ['Approved / completed', d.tasks.done],
          ['In progress', d.tasks.inProgress],
          ['Waiting for approval', d.tasks.awaitingReview],
          ['Revision requested', d.tasks.revision],
        ].map(([label, n]) => (
          <div key={label as string} className="mb-3">
            <div className="flex justify-between text-sm">
              <span>{label}</span>
              <span className="tabular-nums">{n}</span>
            </div>
            <ProgressBar
              value={d.tasks.total ? ((n as number) / d.tasks.total) * 100 : 0}
              className="mt-1"
              label={label as string}
            />
          </div>
        ))}
      </Card>
    </>
  );
}
