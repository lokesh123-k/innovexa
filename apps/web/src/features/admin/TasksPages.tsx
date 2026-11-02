import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  Columns3,
  List,
  Plus,
  RotateCcw,
  Search,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ADMIN_SETTABLE_TASK_STATUSES, TASK_STATUSES, TaskStatus } from '@innovexa/shared';
import { Button } from '@/components/ui/button';
import {
  AttachmentList,
  ConfirmDialog,
  DetailList,
  Pagination,
  ProgressBar,
  StatusBadge,
  Textarea,
} from '@/components/ui/extra';
import { Field, FormAlert, Input, Select } from '@/components/ui/form';
import { Card, CardHeader, Dialog, EmptyState, PageHeader, Skeleton } from '@/components/ui/misc';
import { errorMessage, getData, patchData, postData } from '@/lib/api';
import { minutesToHours } from '@/lib/format';
import { useDebounced } from '@/lib/hooks';
import { cn, formatDate, formatDateTime, humanize } from '@/lib/utils';
import type { Task, TaskUpdateEntry } from '@/types';
import { usePartnerOptions, useProjectOptions } from './options';
import { TaskRows } from './ProjectsPages';
import { PartnerPicker, TaskFormDialog } from './TaskForm';

const BOARD_COLUMNS: { title: string; statuses: string[] }[] = [
  { title: 'To do', statuses: [TaskStatus.NOT_STARTED, TaskStatus.ASSIGNED] },
  {
    title: 'In progress',
    statuses: [TaskStatus.IN_PROGRESS, TaskStatus.REVISION_REQUESTED, TaskStatus.ON_HOLD],
  },
  { title: 'Review', statuses: [TaskStatus.SUBMITTED_FOR_REVIEW] },
  { title: 'Done', statuses: [TaskStatus.APPROVED, TaskStatus.COMPLETED] },
];

export function TaskBoard({ tasks, base }: { tasks: Task[]; base: string }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {BOARD_COLUMNS.map((col) => {
        const items = tasks.filter((t) => col.statuses.includes(t.status));
        return (
          <div key={col.title} className="rounded-xl bg-slate-100/70 p-3">
            <div className="mb-2 flex items-center justify-between px-1 text-sm font-semibold text-slate-700">
              {col.title}{' '}
              <span className="rounded-full bg-white px-2 text-xs text-slate-500">
                {items.length}
              </span>
            </div>
            <div className="space-y-2">
              {items.map((t) => (
                <Link
                  key={t.id}
                  to={`${base}/${t.id}`}
                  className="block rounded-lg border border-slate-200 bg-white p-3 shadow-sm hover:border-brand-300"
                >
                  <div className="text-sm font-medium text-slate-900">{t.title}</div>
                  <div className="mt-0.5 truncate text-xs text-slate-500">{t.project?.title}</div>
                  <ProgressBar
                    value={t.approvedProgress}
                    secondary={t.submittedProgress}
                    className="mt-2"
                  />
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                    <StatusBadge status={t.priority} />
                    {t.status !== col.statuses[0] && <StatusBadge status={t.status} />}
                    {t.dueDate && (
                      <span
                        className={cn(
                          'ml-auto',
                          t.isOverdue ? 'font-medium text-red-600' : 'text-slate-500',
                        )}
                      >
                        {formatDate(t.dueDate)}
                      </span>
                    )}
                  </div>
                </Link>
              ))}
              {items.length === 0 && (
                <p className="px-1 py-3 text-xs text-slate-400">Nothing here.</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function AdminTasksPage() {
  const [view, setView] = useState<'list' | 'board'>('list');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [projectId, setProjectId] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [overdue, setOverdue] = useState(false);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const search = useDebounced(q);
  const projects = useProjectOptions();
  const partners = usePartnerOptions();
  const params = {
    page: view === 'board' ? 1 : page,
    limit: view === 'board' ? 100 : 20,
    ...(search && { q: search }),
    ...(status && { status }),
    ...(projectId && { projectId }),
    ...(assigneeId && { assigneeId }),
    ...(overdue && { overdue: 'true' }),
  };
  const tasks = useQuery({
    queryKey: ['tasks', params],
    queryFn: () => getData<Task[]>('/tasks', params),
    placeholderData: keepPreviousData,
  });
  const reset = () => setPage(1);

  return (
    <>
      <PageHeader
        title="Tasks & assignments"
        description="Plan, assign and monitor work across all projects."
        actions={
          <>
            <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
              <Button
                size="sm"
                variant={view === 'list' ? 'secondary' : 'ghost'}
                onClick={() => setView('list')}
                aria-pressed={view === 'list'}
              >
                <List /> List
              </Button>
              <Button
                size="sm"
                variant={view === 'board' ? 'secondary' : 'ghost'}
                onClick={() => setView('board')}
                aria-pressed={view === 'board'}
              >
                <Columns3 /> Board
              </Button>
            </div>
            <Button onClick={() => setCreating(true)}>
              <Plus /> New task
            </Button>
          </>
        }
      />
      <Card className="mb-4">
        <div className="grid gap-3 p-4 md:grid-cols-[1fr_repeat(3,11rem)_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                reset();
              }}
              placeholder="Search tasks"
              className="pl-9"
              aria-label="Search tasks"
            />
          </div>
          <Select
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value);
              reset();
            }}
            aria-label="Project"
          >
            <option value="">All projects</option>
            {projects.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.projectCode} · {p.title}
              </option>
            ))}
          </Select>
          <Select
            value={assigneeId}
            onChange={(e) => {
              setAssigneeId(e.target.value);
              reset();
            }}
            aria-label="Partner"
          >
            <option value="">All partners</option>
            {partners.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              reset();
            }}
            aria-label="Status"
          >
            <option value="">All statuses</option>
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </Select>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={overdue}
              onChange={(e) => {
                setOverdue(e.target.checked);
                reset();
              }}
            />{' '}
            Overdue only
          </label>
        </div>
      </Card>
      {tasks.isLoading ? (
        <Skeleton className="h-40" />
      ) : tasks.isError ? (
        <FormAlert>{errorMessage(tasks.error)}</FormAlert>
      ) : tasks.data!.data.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ClipboardList />}
            title="No tasks found"
            description="Create a task and assign it to a partner."
            action={
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus /> New task
              </Button>
            }
          />
        </Card>
      ) : view === 'board' ? (
        <TaskBoard tasks={tasks.data!.data} base="/admin/tasks" />
      ) : (
        <Card>
          <TaskRows tasks={tasks.data!.data} />
          <Pagination meta={tasks.data?.meta} onPage={setPage} />
        </Card>
      )}
      <TaskFormDialog open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

export function UpdateHistory({
  updates,
  canPublish,
}: {
  updates?: TaskUpdateEntry[];
  canPublish?: boolean;
}) {
  const qc = useQueryClient();
  const publish = useMutation({
    mutationFn: (id: string) => patchData(`/files/${id}/publish`, { published: true }),
    onSuccess: () => {
      toast.success('Shared with the client as a deliverable');
      void qc.invalidateQueries({ queryKey: ['files'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!updates?.length) return <p className="px-5 py-4 text-sm text-slate-500">No updates yet.</p>;
  return (
    <ol className="divide-y divide-slate-100">
      {updates.map((u) => (
        <li key={u.id} className="px-5 py-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-900">{u.partner?.name}</span>
            <StatusBadge
              status={
                u.kind === 'SUBMISSION'
                  ? 'SUBMITTED_FOR_REVIEW'
                  : u.kind === 'PROGRESS'
                    ? 'IN_PROGRESS'
                    : 'ON_HOLD'
              }
              label={humanize(u.kind)}
            />
            {(u.kind === 'PROGRESS' || u.kind === 'SUBMISSION') && (
              <span className="text-xs text-slate-600">
                {u.previousProgress}% → {u.newProgress}%
              </span>
            )}
            {u.minutesSpent > 0 && (
              <span className="text-xs text-slate-500">{minutesToHours(u.minutesSpent)}</span>
            )}
            {u.kind !== 'ISSUE' && u.kind !== 'CLARIFICATION' && (
              <StatusBadge status={u.reviewStatus} />
            )}
            <span className="ml-auto text-xs text-slate-400">{formatDateTime(u.createdAt)}</span>
          </div>
          <p className="mt-1 whitespace-pre-wrap text-slate-700">{u.description}</p>
          <AttachmentList files={u.attachments} />
          {canPublish && u.attachments.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-2">
              {u.attachments.map((a) => (
                <button
                  key={a.id}
                  onClick={() => publish.mutate(a.id)}
                  className="text-xs font-medium text-brand-700 hover:underline"
                >
                  Share “{a.name}” with client
                </button>
              ))}
            </div>
          )}
          {u.reviewComment && (
            <p className="mt-1 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-900">
              Admin feedback: {u.reviewComment}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}

function ReviewDialog({ task, open, onClose }: { task: Task; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [decision, setDecision] = useState<'APPROVE' | 'REQUEST_REVISION'>('APPROVE');
  const [approved, setApproved] = useState(task.submittedProgress);
  const [comment, setComment] = useState('');
  const review = useMutation({
    mutationFn: () =>
      postData(`/tasks/${task.id}/review`, {
        decision,
        ...(decision === 'APPROVE' && { approvedProgress: approved }),
        ...(comment && { comment }),
      }),
    onSuccess: () => {
      toast.success(
        decision === 'APPROVE' ? 'Work approved — project progress updated' : 'Revision requested',
      );
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      void qc.invalidateQueries({ queryKey: ['projects'] });
      onClose();
    },
  });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Review: ${task.title}`}
      description={`Submitted at ${task.submittedProgress}%. Only approved progress is shown to the client.`}
    >
      <div className="space-y-4">
        {review.isError && <FormAlert>{errorMessage(review.error)}</FormAlert>}
        <div className="grid grid-cols-2 gap-2">
          {(['APPROVE', 'REQUEST_REVISION'] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDecision(d)}
              className={cn(
                'rounded-lg border px-3 py-2 text-sm font-medium',
                decision === d
                  ? 'border-brand-600 bg-brand-50 text-brand-800'
                  : 'border-slate-200 text-slate-600',
              )}
            >
              {d === 'APPROVE' ? 'Approve' : 'Request revision'}
            </button>
          ))}
        </div>
        {decision === 'APPROVE' && (
          <Field
            label={`Approved progress: ${approved}%`}
            htmlFor="approved-range"
            hint="Approve less than submitted if part of the work is accepted."
          >
            <input
              id="approved-range"
              type="range"
              min={0}
              max={task.submittedProgress}
              value={approved}
              onChange={(e) => setApproved(Number(e.target.value))}
              className="w-full"
            />
          </Field>
        )}
        <Field
          label={decision === 'APPROVE' ? 'Comment (optional)' : 'What needs to change?'}
          htmlFor="review-comment"
        >
          <Textarea
            id="review-comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={5000}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={decision === 'APPROVE' ? 'primary' : 'danger'}
            onClick={() => review.mutate()}
            loading={review.isPending}
          >
            {decision === 'APPROVE' ? 'Approve work' : 'Request revision'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

export function AdminTaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [assignOpen, setAssignOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [confirm, setConfirm] = useState<'cancel' | 'reopen' | null>(null);
  const [assignees, setAssignees] = useState<string[]>([]);
  const task = useQuery({
    queryKey: ['tasks', id],
    queryFn: async () => (await getData<Task>(`/tasks/${id}`)).data,
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['tasks'] });
    void qc.invalidateQueries({ queryKey: ['projects'] });
  };
  const assign = useMutation({
    mutationFn: () => postData(`/tasks/${id}/assign`, { assigneeIds: assignees }),
    onSuccess: () => {
      toast.success('Assignment updated');
      setAssignOpen(false);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const setStatus = useMutation({
    mutationFn: (status: string) => patchData(`/tasks/${id}`, { status }),
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const action = useMutation({
    mutationFn: (a: 'cancel' | 'reopen') => postData(`/tasks/${id}/${a}`),
    onSuccess: () => {
      setConfirm(null);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (task.isLoading) return <Skeleton className="h-64" />;
  if (task.isError) return <FormAlert>{errorMessage(task.error)}</FormAlert>;
  const t = task.data!;
  const settable = (ADMIN_SETTABLE_TASK_STATUSES as readonly string[]).includes(t.status);

  return (
    <>
      <Link
        to="/admin/tasks"
        className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="size-4" /> Tasks
      </Link>
      <PageHeader
        title={t.title}
        description={`${t.project?.projectCode ?? ''} ${t.project?.title ?? ''}`}
        actions={
          <>
            <StatusBadge status={t.status} />
            {t.status === TaskStatus.SUBMITTED_FOR_REVIEW && (
              <Button onClick={() => setReviewOpen(true)}>
                <CheckCircle2 /> Review submission
              </Button>
            )}
            {t.status !== TaskStatus.CANCELLED && (
              <Button
                variant="secondary"
                onClick={() => {
                  setAssignees(t.assignees.map((a) => a._id));
                  setAssignOpen(true);
                }}
              >
                Assign / reassign
              </Button>
            )}
            {settable && (
              <Select
                value={t.status}
                onChange={(e) => setStatus.mutate(e.target.value)}
                className="w-40"
                aria-label="Task status"
              >
                {ADMIN_SETTABLE_TASK_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {humanize(s)}
                  </option>
                ))}
              </Select>
            )}
            {t.status === TaskStatus.CANCELLED ||
            t.status === TaskStatus.APPROVED ||
            t.status === TaskStatus.COMPLETED ? (
              <Button variant="ghost" onClick={() => setConfirm('reopen')}>
                <RotateCcw /> Reopen
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => setConfirm('cancel')}>
                Cancel task
              </Button>
            )}
          </>
        }
      />
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
                  <span className="text-slate-600">Submitted by partner</span>
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
                ['Assignees', t.assignees.map((a) => a.name).join(', ') || 'Unassigned'],
                ['Priority', humanize(t.priority)],
                [
                  'Dates',
                  `${formatDate(t.startDate)} → ${formatDate(t.dueDate)}${t.isOverdue ? ' (overdue)' : ''}`,
                ],
                [
                  'Estimate / logged',
                  `${t.estimatedHours ?? '—'}h estimated · ${minutesToHours(t.loggedMinutes)} logged`,
                ],
                ['Weight', String(t.weight)],
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
            <CardHeader
              title="Progress updates & submissions"
              description="Partner files can be shared with the client as deliverables."
            />
            <UpdateHistory updates={t.updates} canPublish />
          </Card>
        </div>
        <Card>
          <CardHeader title="Review history" />
          {t.reviewNotes.length === 0 ? (
            <p className="px-5 py-4 text-sm text-slate-500">No reviews yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {[...t.reviewNotes].reverse().map((n, i) => (
                <li key={i} className="px-5 py-3 text-sm">
                  <StatusBadge status={n.decision} />
                  {n.approvedProgress !== undefined && (
                    <span className="ml-2 text-xs text-slate-600">{n.approvedProgress}%</span>
                  )}
                  {n.comment && <p className="mt-1 text-slate-700">{n.comment}</p>}
                  <div className="mt-1 text-xs text-slate-400">{formatDateTime(n.at)}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Dialog
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        title="Assign partners"
        description="New assignees are notified and added to the project team."
      >
        <PartnerPicker value={assignees} onChange={setAssignees} />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setAssignOpen(false)}>
            Cancel
          </Button>
          <Button onClick={() => assign.mutate()} loading={assign.isPending}>
            Save assignment
          </Button>
        </div>
      </Dialog>
      {reviewOpen && <ReviewDialog task={t} open onClose={() => setReviewOpen(false)} />}
      <ConfirmDialog
        open={!!confirm}
        title={confirm === 'cancel' ? 'Cancel this task?' : 'Reopen this task?'}
        description={
          confirm === 'cancel'
            ? 'Cancelled tasks are excluded from project progress. You can reopen it later.'
            : 'The task returns to its assignees and project progress is recalculated.'
        }
        confirmLabel={confirm === 'cancel' ? 'Cancel task' : 'Reopen'}
        danger={confirm === 'cancel'}
        loading={action.isPending}
        onConfirm={() => confirm && action.mutate(confirm)}
        onClose={() => setConfirm(null)}
      />
    </>
  );
}

interface QueueItem {
  task: Task;
  submission: TaskUpdateEntry | null;
}

export function ApprovalsPage() {
  const queue = useQuery({
    queryKey: ['tasks', 'review-queue'],
    queryFn: async () => (await getData<QueueItem[]>('/tasks/review-queue')).data,
  });
  const [reviewing, setReviewing] = useState<Task | null>(null);
  return (
    <>
      <PageHeader
        title="Work approvals"
        description="Partner submissions waiting for your review. Partners can never approve their own work."
      />
      {queue.isLoading ? (
        <Skeleton className="h-40" />
      ) : queue.isError ? (
        <FormAlert>{errorMessage(queue.error)}</FormAlert>
      ) : queue.data!.length === 0 ? (
        <Card>
          <EmptyState
            icon={<CheckCircle2 />}
            title="Nothing to review"
            description="New submissions will appear here and in your notifications."
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {queue.data!.map(({ task, submission }) => (
            <Card key={task.id} className="p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <Link
                    to={`/admin/tasks/${task.id}`}
                    className="font-semibold text-slate-900 hover:text-brand-700"
                  >
                    {task.title}
                  </Link>
                  <div className="text-xs text-slate-500">
                    {task.project?.projectCode} {task.project?.title} ·{' '}
                    {task.assignees.map((a) => a.name).join(', ')}
                  </div>
                </div>
                <Button onClick={() => setReviewing(task)}>Review</Button>
              </div>
              {submission && (
                <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">
                  <div className="text-xs text-slate-500">
                    Submitted {formatDateTime(submission.createdAt)} · {submission.previousProgress}
                    % → {submission.newProgress}%
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-slate-800">
                    {submission.description}
                  </p>
                  <AttachmentList files={submission.attachments} />
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
      {reviewing && <ReviewDialog task={reviewing} open onClose={() => setReviewing(null)} />}
    </>
  );
}
