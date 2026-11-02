import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, FolderKanban, Plus, Search, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  MILESTONE_STATUSES,
  PRIORITIES,
  PROJECT_STATUSES,
  Priority,
  toMinor,
} from '@innovexa/shared';
import { Button } from '@/components/ui/button';
import {
  ConfirmDialog,
  DetailList,
  Pagination,
  ProgressBar,
  StatusBadge,
  TableShell,
  Tabs,
  Textarea,
  td,
  th,
} from '@/components/ui/extra';
import { Field, FormAlert, Input, Select } from '@/components/ui/form';
import { Card, CardHeader, Dialog, EmptyState, PageHeader, Skeleton } from '@/components/ui/misc';
import { api, errorMessage, getData, patchData, postData, uploadFile } from '@/lib/api';
import { money } from '@/lib/format';
import { fromDateInput, toDateInput, useDebounced } from '@/lib/hooks';
import { formatDate, formatDateTime, humanize } from '@/lib/utils';
import type { Attachment, Invoice, Project, Task } from '@/types';
import { useCategoryOptions, useClientOptions } from './options';
import { PartnerPicker, TaskFormDialog } from './TaskForm';

const amount = (v: string) => (v.trim() ? toMinor(v) : undefined);

export function ProjectsPage() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const search = useDebounced(q);
  const params = { page, limit: 15, ...(search && { q: search }), ...(status && { status }) };
  const projects = useQuery({
    queryKey: ['projects', params],
    queryFn: () => getData<Project[]>('/projects', params),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader
        title="Projects"
        description="Every client engagement, its schedule, team and approved progress."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> New project
          </Button>
        }
      />
      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              placeholder="Search title or code"
              className="pl-9"
              aria-label="Search projects"
            />
          </div>
          <Select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            className="sm:w-44"
            aria-label="Status"
          >
            <option value="">All statuses</option>
            {PROJECT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </Select>
        </div>
        {projects.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : projects.isError ? (
          <div className="p-4">
            <FormAlert>{errorMessage(projects.error)}</FormAlert>
          </div>
        ) : projects.data!.data.length === 0 ? (
          <EmptyState
            icon={<FolderKanban />}
            title="No projects"
            description="Create a project for a client to start planning work."
            action={
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus /> New project
              </Button>
            }
          />
        ) : (
          <TableShell minWidth={860}>
            <thead>
              <tr>
                <th className={th}>Project</th>
                <th className={th}>Client</th>
                <th className={th}>Status</th>
                <th className={th}>Approved progress</th>
                <th className={th}>Pending work</th>
                <th className={th}>Expected completion</th>
                <th className={`${th} text-right`}>Contract</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {projects.data!.data.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50/60">
                  <td className={td}>
                    <Link
                      to={`/admin/projects/${p.id}`}
                      className="font-medium text-slate-900 hover:text-brand-700"
                    >
                      {p.title}
                    </Link>
                    <div className="text-xs text-slate-500">
                      {p.projectCode} · {p.serviceCategory?.name}
                    </div>
                  </td>
                  <td className={td}>{p.client?.companyName}</td>
                  <td className={td}>
                    <StatusBadge status={p.status} />
                  </td>
                  <td className={`${td} w-48`}>
                    <div className="flex items-center gap-2">
                      <ProgressBar
                        value={p.approvedProgress}
                        secondary={p.submittedProgress}
                        className="flex-1"
                      />
                      <span className="w-12 text-right text-xs tabular-nums text-slate-600">
                        {p.approvedProgress}%
                      </span>
                    </div>
                  </td>
                  <td className={td}>
                    {p.taskCounts.pending} task{p.taskCounts.pending === 1 ? '' : 's'}
                    {p.taskCounts.overdue > 0 && (
                      <span className="ml-1 text-xs text-red-600">
                        ({p.taskCounts.overdue} overdue)
                      </span>
                    )}
                  </td>
                  <td className={td}>{formatDate(p.expectedEndDate)}</td>
                  <td className={`${td} text-right tabular-nums`}>
                    {money(p.contractAmountMinor)}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
        <Pagination meta={projects.data?.meta} onPage={setPage} />
      </Card>
      <ProjectFormDialog open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

function ProjectFormDialog({
  open,
  onClose,
  project,
}: {
  open: boolean;
  onClose: () => void;
  project?: Project;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const clients = useClientOptions();
  const categories = useCategoryOptions();
  const editing = !!project;
  const [form, setForm] = useState({
    title: project?.title ?? '',
    clientId: project?.client?._id ?? '',
    serviceCategoryId: project?.serviceCategory?._id ?? '',
    description: project?.description ?? '',
    requirements: project?.requirements ?? '',
    budget: project?.budgetMinor != null ? String(project.budgetMinor / 100) : '',
    contract: project?.contractAmountMinor != null ? String(project.contractAmountMinor / 100) : '',
    startDate: toDateInput(project?.startDate ?? new Date()),
    expectedEndDate: toDateInput(project?.expectedEndDate),
    priority: project?.priority ?? Priority.MEDIUM,
    internalNotes: project?.internalNotes ?? '',
  });
  const [partners, setPartners] = useState<string[]>(project?.partners?.map((p) => p._id) ?? []);
  const [milestones, setMilestones] = useState<{ title: string; dueDate: string }[]>([]);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = useMutation({
    mutationFn: () => {
      const body = {
        title: form.title,
        clientId: form.clientId,
        serviceCategoryId: form.serviceCategoryId,
        description: form.description || undefined,
        requirements: form.requirements || undefined,
        budgetMinor: amount(form.budget),
        contractAmountMinor: amount(form.contract) ?? 0,
        startDate: fromDateInput(form.startDate),
        expectedEndDate: fromDateInput(form.expectedEndDate),
        priority: form.priority,
        partnerIds: partners,
        internalNotes: form.internalNotes || undefined,
      };
      return editing
        ? patchData<Project>(`/projects/${project.id}`, body)
        : postData<Project>('/projects', {
            ...body,
            milestones: milestones
              .filter((m) => m.title.trim())
              .map((m) => ({ title: m.title, dueDate: fromDateInput(m.dueDate) })),
          });
    },
    onSuccess: (p) => {
      toast.success(editing ? 'Project updated' : 'Project created');
      void qc.invalidateQueries({ queryKey: ['projects'] });
      void qc.invalidateQueries({ queryKey: ['options', 'projects'] });
      onClose();
      if (!editing) navigate(`/admin/projects/${p.id}`);
    },
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? 'Edit project' : 'New project'}
      className="sm:max-w-2xl"
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        {save.isError && <FormAlert>{errorMessage(save.error)}</FormAlert>}
        <Field label="Project title" htmlFor="p-title">
          <Input id="p-title" required value={form.title} onChange={set('title')} maxLength={150} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Client"
            htmlFor="p-client"
            hint={clients.data?.length === 0 ? 'Add a client first.' : undefined}
          >
            <Select id="p-client" required value={form.clientId} onChange={set('clientId')}>
              <option value="">Select a client…</option>
              {clients.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.companyName} ({c.clientCode})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Service category" htmlFor="p-cat">
            <Select
              id="p-cat"
              required
              value={form.serviceCategoryId}
              onChange={set('serviceCategoryId')}
            >
              <option value="">Select…</option>
              {categories.data?.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Start date" htmlFor="p-start">
            <Input
              id="p-start"
              type="date"
              required
              value={form.startDate}
              onChange={set('startDate')}
            />
          </Field>
          <Field label="Expected completion" htmlFor="p-end">
            <Input
              id="p-end"
              type="date"
              required
              value={form.expectedEndDate}
              onChange={set('expectedEndDate')}
            />
          </Field>
          <Field label="Contract amount (₹)" htmlFor="p-contract">
            <Input
              id="p-contract"
              inputMode="decimal"
              required
              pattern="^\d+(\.\d{1,2})?$"
              value={form.contract}
              onChange={set('contract')}
            />
          </Field>
          <Field label="Internal budget (₹, optional)" htmlFor="p-budget" hint="Admin only">
            <Input
              id="p-budget"
              inputMode="decimal"
              pattern="^\d+(\.\d{1,2})?$"
              value={form.budget}
              onChange={set('budget')}
            />
          </Field>
          <Field label="Priority" htmlFor="p-prio">
            <Select id="p-prio" value={form.priority} onChange={set('priority')}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {humanize(p)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Description" htmlFor="p-desc">
          <Textarea
            id="p-desc"
            value={form.description}
            onChange={set('description')}
            maxLength={5000}
          />
        </Field>
        <Field label="Requirements" htmlFor="p-req">
          <Textarea
            id="p-req"
            value={form.requirements}
            onChange={set('requirements')}
            maxLength={5000}
          />
        </Field>
        <div>
          <div className="mb-1.5 text-sm font-medium text-slate-700">Assigned partners</div>
          <PartnerPicker value={partners} onChange={setPartners} />
        </div>
        {!editing && (
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">Milestones</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setMilestones((m) => [...m, { title: '', dueDate: '' }])}
              >
                <Plus /> Add milestone
              </Button>
            </div>
            <div className="space-y-2">
              {milestones.map((m, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    placeholder={`Milestone ${i + 1}`}
                    value={m.title}
                    onChange={(e) =>
                      setMilestones((all) =>
                        all.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)),
                      )
                    }
                    aria-label={`Milestone ${i + 1} title`}
                  />
                  <Input
                    type="date"
                    className="w-44"
                    value={m.dueDate}
                    onChange={(e) =>
                      setMilestones((all) =>
                        all.map((x, j) => (j === i ? { ...x, dueDate: e.target.value } : x)),
                      )
                    }
                    aria-label={`Milestone ${i + 1} due date`}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setMilestones((all) => all.filter((_, j) => j !== i))}
                    aria-label="Remove milestone"
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
        <Field label="Internal notes" htmlFor="p-notes" hint="Never shown to partners or clients">
          <Textarea
            id="p-notes"
            value={form.internalNotes}
            onChange={set('internalNotes')}
            maxLength={5000}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            {editing ? 'Save changes' : 'Create project'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'overview' | 'milestones' | 'tasks' | 'files' | 'billing'>(
    'overview',
  );
  const [editing, setEditing] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const project = useQuery({
    queryKey: ['projects', id],
    queryFn: async () => (await getData<Project>(`/projects/${id}`)).data,
  });
  const setStatus = useMutation({
    mutationFn: (status: string) => patchData(`/projects/${id}`, { status }),
    onSuccess: () => {
      toast.success('Status updated');
      void qc.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (project.isLoading) return <Skeleton className="h-64" />;
  if (project.isError) return <FormAlert>{errorMessage(project.error)}</FormAlert>;
  const p = project.data!;

  return (
    <>
      <Link
        to="/admin/projects"
        className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="size-4" /> Projects
      </Link>
      <PageHeader
        title={p.title}
        description={`${p.projectCode} · ${p.client?.companyName} · ${p.serviceCategory?.name ?? ''}`}
        actions={
          <>
            <Select
              value={p.status}
              onChange={(e) => setStatus.mutate(e.target.value)}
              aria-label="Project status"
              className="w-40"
            >
              {PROJECT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </Select>
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button onClick={() => setTaskOpen(true)}>
              <Plus /> Add task
            </Button>
          </>
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4 sm:col-span-2">
          <div className="flex justify-between text-sm">
            <span className="font-medium text-slate-700">Approved progress (client-visible)</span>
            <span className="font-semibold tabular-nums">{p.approvedProgress}%</span>
          </div>
          <ProgressBar
            value={p.approvedProgress}
            secondary={p.submittedProgress}
            className="mt-2 h-3"
          />
          <p className="mt-1.5 text-xs text-slate-500">
            Submitted (awaiting approval): {p.submittedProgress ?? 0}%
          </p>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase text-slate-500">Tasks</div>
          <div className="mt-1 text-xl font-semibold">
            {p.taskCounts.done}/{p.taskCounts.total} done
          </div>
          <div className="text-xs text-slate-500">
            {p.taskCounts.awaitingReview} awaiting review · {p.taskCounts.overdue} overdue
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase text-slate-500">Schedule</div>
          <div className="mt-1 text-sm">
            {formatDate(p.startDate)} → {formatDate(p.expectedEndDate)}
          </div>
          <div className="text-xs text-slate-500">
            Contract {money(p.contractAmountMinor)} · Budget {money(p.budgetMinor)}
          </div>
        </Card>
      </div>
      <Tabs
        tabs={[
          { value: 'overview', label: 'Overview' },
          { value: 'milestones', label: 'Milestones', count: p.milestones?.length },
          { value: 'tasks', label: 'Tasks', count: p.taskCounts.total },
          { value: 'files', label: 'Files & deliverables' },
          { value: 'billing', label: 'Invoices' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'overview' && (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="p-5 lg:col-span-2">
            <DetailList
              items={[
                ['Description', <p className="whitespace-pre-wrap">{p.description || '—'}</p>],
                ['Requirements', <p className="whitespace-pre-wrap">{p.requirements || '—'}</p>],
                ['Priority', humanize(p.priority)],
                ['Completed on', formatDate(p.completedAt)],
                ['Internal notes', <p className="whitespace-pre-wrap">{p.internalNotes || '—'}</p>],
              ]}
            />
          </Card>
          <Card>
            <CardHeader title="Team" />
            <ul className="divide-y divide-slate-100">
              {p.partners?.length ? (
                p.partners.map((u) => (
                  <li key={u._id} className="px-5 py-2.5 text-sm">
                    <Link
                      to={`/admin/partners/${u._id}`}
                      className="font-medium text-slate-900 hover:text-brand-700"
                    >
                      {u.name}
                    </Link>
                    <div className="text-xs text-slate-500">
                      {u.partnerProfile?.partnerType ? humanize(u.partnerProfile.partnerType) : ''}
                    </div>
                  </li>
                ))
              ) : (
                <li className="px-5 py-4 text-sm text-slate-500">No partners assigned.</li>
              )}
            </ul>
          </Card>
          <Card className="lg:col-span-3">
            <CardHeader
              title="Progress history"
              description="Recalculated on the server whenever work is approved, cancelled or reopened."
            />
            <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto text-sm">
              {[...(p.progressHistory ?? [])].reverse().map((h, i) => (
                <li key={i} className="flex justify-between gap-4 px-5 py-2">
                  <span>{h.reason}</span>
                  <span className="tabular-nums text-slate-600">
                    {h.approved}% approved · {h.submitted}% submitted · {formatDateTime(h.at)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
      {tab === 'milestones' && <MilestonesTab project={p} />}
      {tab === 'tasks' && <ProjectTasksTab projectId={p.id} />}
      {tab === 'files' && <ProjectFilesTab projectId={p.id} />}
      {tab === 'billing' && <ProjectInvoicesTab projectId={p.id} />}
      {editing && <ProjectFormDialog open onClose={() => setEditing(false)} project={p} />}
      <TaskFormDialog open={taskOpen} onClose={() => setTaskOpen(false)} projectId={p.id} />
    </>
  );
}

function MilestonesTab({ project }: { project: Project }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['projects', project.id] });
  const add = useMutation({
    mutationFn: () =>
      postData(`/projects/${project.id}/milestones`, {
        title,
        ...(dueDate && { dueDate: fromDateInput(dueDate) }),
      }),
    onSuccess: () => {
      setTitle('');
      setDueDate('');
      void refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: string; status?: string; clientVisible?: boolean }) =>
      patchData(`/milestones/${id}`, body),
    onSuccess: () => void refresh(),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/milestones/${id}`),
    onSuccess: () => {
      setDeleting(null);
      void refresh();
    },
  });
  return (
    <Card>
      <form
        className="flex flex-col gap-2 border-b border-slate-100 p-4 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <Input
          placeholder="New milestone title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-label="Milestone title"
        />
        <Input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="sm:w-44"
          aria-label="Due date"
        />
        <Button type="submit" loading={add.isPending} disabled={title.trim().length < 2}>
          <Plus /> Add
        </Button>
      </form>
      {!project.milestones?.length ? (
        <EmptyState
          icon={<FolderKanban />}
          title="No milestones"
          description="Milestones structure the client timeline."
        />
      ) : (
        <ul className="divide-y divide-slate-100">
          {project.milestones.map((m) => (
            <li key={m.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-slate-900">
                  {m.order + 1}. {m.title}
                </div>
                <div className="text-xs text-slate-500">
                  Due {formatDate(m.dueDate)}
                  {m.completedAt && ` · completed ${formatDate(m.completedAt)}`}
                </div>
              </div>
              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={m.clientVisible}
                  onChange={(e) => update.mutate({ id: m.id, clientVisible: e.target.checked })}
                />
                Visible to client
              </label>
              <Select
                value={m.status}
                onChange={(e) => update.mutate({ id: m.id, status: e.target.value })}
                className="sm:w-40"
                aria-label={`Status of ${m.title}`}
              >
                {MILESTONE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {humanize(s)}
                  </option>
                ))}
              </Select>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setDeleting(m.id)}
                aria-label={`Delete ${m.title}`}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={!!deleting}
        title="Delete milestone?"
        description="Tasks linked to it stay in the project without a milestone."
        confirmLabel="Delete"
        danger
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}
        onClose={() => setDeleting(null)}
      />
    </Card>
  );
}

export function TaskRows({ tasks, base = '/admin/tasks' }: { tasks: Task[]; base?: string }) {
  return (
    <TableShell minWidth={760}>
      <thead>
        <tr>
          <th className={th}>Task</th>
          <th className={th}>Assignees</th>
          <th className={th}>Priority</th>
          <th className={th}>Status</th>
          <th className={th}>Progress (approved / submitted)</th>
          <th className={th}>Due</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {tasks.map((t) => (
          <tr key={t.id} className="hover:bg-slate-50/60">
            <td className={td}>
              <Link
                to={`${base}/${t.id}`}
                className="font-medium text-slate-900 hover:text-brand-700"
              >
                {t.title}
              </Link>
              <div className="text-xs text-slate-500">
                {t.project?.projectCode} {t.project?.title}
              </div>
            </td>
            <td className={td}>
              {t.assignees?.map((a) => a.name).join(', ') || (
                <span className="text-slate-400">Unassigned</span>
              )}
            </td>
            <td className={td}>
              <StatusBadge status={t.priority} />
            </td>
            <td className={td}>
              <StatusBadge status={t.status} />
            </td>
            <td className={`${td} w-56`}>
              <div className="flex items-center gap-2">
                <ProgressBar
                  value={t.approvedProgress}
                  secondary={t.submittedProgress}
                  className="flex-1"
                />
                <span className="text-xs tabular-nums text-slate-600">
                  {t.approvedProgress}/{t.submittedProgress}%
                </span>
              </div>
            </td>
            <td className={td}>
              {formatDate(t.dueDate)}
              {t.isOverdue && <div className="text-xs font-medium text-red-600">Overdue</div>}
            </td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}

function ProjectTasksTab({ projectId }: { projectId: string }) {
  const tasks = useQuery({
    queryKey: ['tasks', 'project', projectId],
    queryFn: async () => (await getData<Task[]>('/tasks', { projectId, limit: 100 })).data,
  });
  return (
    <Card>
      {tasks.isLoading ? (
        <Skeleton className="m-4 h-20" />
      ) : tasks.isError ? (
        <div className="p-4">
          <FormAlert>{errorMessage(tasks.error)}</FormAlert>
        </div>
      ) : tasks.data!.length === 0 ? (
        <EmptyState
          icon={<FolderKanban />}
          title="No tasks yet"
          description="Use “Add task” to plan and assign work."
        />
      ) : (
        <TaskRows tasks={tasks.data!} />
      )}
    </Card>
  );
}

interface FileRow extends Attachment {
  visibility: 'INTERNAL' | 'CLIENT';
  createdAt: string;
  owner?: { name: string; role: string };
}

function ProjectFilesTab({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [visibility, setVisibility] = useState<'CLIENT' | 'INTERNAL'>('CLIENT');
  const files = useQuery({
    queryKey: ['files', 'PROJECT', projectId],
    queryFn: async () =>
      (await getData<FileRow[]>('/files', { kind: 'PROJECT', refId: projectId })).data,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['files', 'PROJECT', projectId] });
  const upload = useMutation({
    mutationFn: (list: File[]) =>
      Promise.all(list.map((f) => uploadFile(f, 'PROJECT', projectId, visibility))),
    onSuccess: () => {
      toast.success('Uploaded');
      void refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const publish = useMutation({
    mutationFn: ({ id, published }: { id: string; published: boolean }) =>
      patchData(`/files/${id}/publish`, { published }),
    onSuccess: () => void refresh(),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-4">
        <Select
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as 'CLIENT' | 'INTERNAL')}
          className="w-56"
          aria-label="Visibility for new uploads"
        >
          <option value="CLIENT">Deliverable (visible to client)</option>
          <option value="INTERNAL">Internal only</option>
        </Select>
        <input
          ref={input}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            const l = Array.from(e.target.files ?? []);
            if (l.length) upload.mutate(l);
            e.target.value = '';
          }}
        />
        <Button onClick={() => input.current?.click()} loading={upload.isPending}>
          <Upload /> Upload files
        </Button>
        <span className="text-xs text-slate-500">
          Partner task files can be shared from the task page.
        </span>
      </div>
      {files.isLoading ? (
        <Skeleton className="m-4 h-16" />
      ) : !files.data?.length ? (
        <EmptyState
          icon={<Upload />}
          title="No files"
          description="Upload deliverables to share them with the client."
        />
      ) : (
        <ul className="divide-y divide-slate-100">
          {files.data.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
              <a
                href={f.url}
                className="min-w-0 flex-1 truncate font-medium text-brand-700 hover:underline"
              >
                {f.name}
              </a>
              <span className="text-xs text-slate-500">
                {f.owner?.name} · {formatDate(f.createdAt)}
              </span>
              <StatusBadge
                status={f.visibility === 'CLIENT' ? 'ACTIVE' : 'DRAFT'}
                label={f.visibility === 'CLIENT' ? 'Shared with client' : 'Internal'}
              />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => publish.mutate({ id: f.id, published: f.visibility !== 'CLIENT' })}
              >
                {f.visibility === 'CLIENT' ? 'Make internal' : 'Share with client'}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ProjectInvoicesTab({ projectId }: { projectId: string }) {
  const invoices = useQuery({
    queryKey: ['invoices', 'project', projectId],
    queryFn: async () => (await getData<Invoice[]>('/invoices', { projectId, limit: 50 })).data,
  });
  return (
    <Card>
      <div className="flex justify-end border-b border-slate-100 p-3">
        <Link
          to={`/admin/invoices?new=${projectId}`}
          className="text-sm font-medium text-brand-700 hover:underline"
        >
          Create invoice for this project
        </Link>
      </div>
      {!invoices.data?.length ? (
        <EmptyState
          icon={<FolderKanban />}
          title="No invoices"
          description="Invoices for this project will be listed here."
        />
      ) : (
        <ul className="divide-y divide-slate-100">
          {invoices.data.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
              <Link
                to={`/admin/invoices/${i.id}`}
                className="font-medium text-slate-900 hover:text-brand-700"
              >
                {i.invoiceNumber}
              </Link>
              <StatusBadge status={i.status} />
              <span className="ml-auto tabular-nums">
                {money(i.totalMinor)} · balance {money(Math.max(0, i.balanceMinor))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
