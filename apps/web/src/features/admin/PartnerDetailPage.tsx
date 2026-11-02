import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, MessageSquare, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { PARTNER_TYPES, UserStatus, toMinor, fromMinor } from '@innovexa/shared';
import { Button } from '@/components/ui/button';
import {
  ConfirmDialog,
  DetailList,
  ProgressBar,
  StatTile,
  StatusBadge,
  Tabs,
} from '@/components/ui/extra';
import { Field, FormAlert, Input, Select } from '@/components/ui/form';
import { Card, Dialog, PageHeader, Skeleton } from '@/components/ui/misc';
import { errorMessage, getData, patchData, postData } from '@/lib/api';
import { minutesToHours, money } from '@/lib/format';
import { formatDate, formatDateTime, humanize } from '@/lib/utils';
import type { Conversation, Task, User, WorkReport } from '@/types';
import { TaskRows } from './ProjectsPages';
import { TaskFormDialog } from './TaskForm';

interface Overview {
  partner: User;
  projects: {
    id: string;
    title: string;
    projectCode: string;
    status: string;
    approvedProgress: number;
    expectedEndDate: string;
  }[];
  tasks: {
    total: number;
    done: number;
    pending: number;
    awaitingReview: number;
    revision: number;
    overdue: number;
    completionPercent: number;
  };
  time: { totalMinutes: number; last30DaysMinutes: number };
  reports: WorkReport[];
  recentUpdates: {
    id: string;
    kind: string;
    task?: { title: string };
    newProgress: number;
    description: string;
    minutesSpent: number;
    reviewStatus: string;
    createdAt: string;
  }[];
}

export function PartnerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'tasks' | 'projects' | 'reports' | 'activity'>('tasks');
  const [editing, setEditing] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const overview = useQuery({
    queryKey: ['partners', id, 'overview'],
    queryFn: async () => (await getData<Overview>(`/dashboard/partners/${id}`)).data,
  });
  const tasks = useQuery({
    queryKey: ['tasks', 'partner', id],
    queryFn: async () => (await getData<Task[]>('/tasks', { assigneeId: id, limit: 100 })).data,
  });
  const toggle = useMutation({
    mutationFn: (status: string) => patchData(`/users/${id}/status`, { status }),
    onSuccess: () => {
      toast.success('Account updated');
      setConfirm(false);
      void qc.invalidateQueries({ queryKey: ['partners', id] });
      void qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const message = useMutation({
    mutationFn: () => postData<Conversation>('/conversations', { userId: id }),
    onSuccess: (c) => navigate(`/admin/messages?c=${c.id}`),
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (overview.isLoading) return <Skeleton className="h-64" />;
  if (overview.isError) return <FormAlert>{errorMessage(overview.error)}</FormAlert>;
  const o = overview.data!;
  const p = o.partner;
  const active = p.status === UserStatus.ACTIVE;

  return (
    <>
      <Link
        to="/admin/partners"
        className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="size-4" /> Partners
      </Link>
      <PageHeader
        title={p.name}
        description={`${p.email}${p.partnerProfile ? ` · ${humanize(p.partnerProfile.partnerType)}` : ''}${p.partnerProfile?.category ? ` · ${p.partnerProfile.category}` : ''}`}
        actions={
          <>
            <StatusBadge status={p.status} />
            {active && (
              <Button
                variant="secondary"
                onClick={() => message.mutate()}
                loading={message.isPending}
              >
                <MessageSquare /> Message
              </Button>
            )}
            {active && (
              <Button onClick={() => setAssigning(true)}>
                <Plus /> Assign task
              </Button>
            )}
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Edit
            </Button>
            {p.status !== UserStatus.INVITED && (
              <Button variant="ghost" onClick={() => setConfirm(true)}>
                {active ? 'Deactivate' : 'Activate'}
              </Button>
            )}
          </>
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Completion"
          value={`${o.tasks.completionPercent}%`}
          hint={`${o.tasks.done} of ${o.tasks.total} tasks approved`}
          tone="green"
        />
        <StatTile
          label="Pending tasks"
          value={o.tasks.pending}
          hint={`${o.tasks.awaitingReview} awaiting review · ${o.tasks.revision} in revision`}
        />
        <StatTile
          label="Overdue"
          value={o.tasks.overdue}
          tone={o.tasks.overdue ? 'red' : 'green'}
        />
        <StatTile
          label="Hours logged"
          value={minutesToHours(o.time.totalMinutes)}
          hint={`${minutesToHours(o.time.last30DaysMinutes)} in the last 30 days`}
        />
      </div>
      <Card className="mb-6 p-5">
        <DetailList
          items={[
            ['Phone', p.phone],
            ['Designation', p.partnerProfile?.designation],
            ['Skills', p.partnerProfile?.skills?.join(', ') || '—'],
            [
              'Hourly rate (admin only)',
              p.partnerProfile?.hourlyRateMinor != null
                ? money(p.partnerProfile.hourlyRateMinor)
                : '—',
            ],
            ['Last sign-in', formatDateTime(p.lastLoginAt)],
            ['Joined', formatDate(p.createdAt)],
          ]}
        />
      </Card>
      <Tabs
        tabs={[
          { value: 'tasks', label: 'Assigned tasks', count: tasks.data?.length },
          { value: 'projects', label: 'Project allocations', count: o.projects.length },
          { value: 'reports', label: 'Daily & weekly reports', count: o.reports.length },
          { value: 'activity', label: 'Work progress' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'tasks' && (
        <Card>
          {tasks.data?.length ? (
            <TaskRows tasks={tasks.data} />
          ) : (
            <p className="px-5 py-4 text-sm text-slate-500">No tasks assigned.</p>
          )}
        </Card>
      )}
      {tab === 'projects' && (
        <Card>
          <ul className="divide-y divide-slate-100">
            {o.projects.map((pr) => (
              <li key={pr.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <Link
                  to={`/admin/projects/${pr.id}`}
                  className="min-w-0 flex-1 font-medium hover:text-brand-700"
                >
                  {pr.projectCode} · {pr.title}
                </Link>
                <div className="flex w-48 items-center gap-2">
                  <ProgressBar value={pr.approvedProgress} className="flex-1" />
                  <span className="text-xs">{pr.approvedProgress}%</span>
                </div>
                <StatusBadge status={pr.status} />
              </li>
            ))}
            {!o.projects.length && (
              <li className="px-5 py-4 text-sm text-slate-500">Not allocated to any project.</li>
            )}
          </ul>
        </Card>
      )}
      {tab === 'reports' && (
        <Card>
          <ul className="divide-y divide-slate-100">
            {o.reports.map((r) => (
              <li key={r._id} className="px-5 py-3 text-sm">
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="font-medium">
                    {humanize(r.type)} · {formatDate(r.date)}
                  </span>
                  <span className="text-slate-500">
                    {minutesToHours(r.minutesWorked)}
                    {r.progressPercent != null && ` · ${r.progressPercent}%`}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-slate-700">{r.workCompleted}</p>
                {r.problems && (
                  <p className="mt-1 text-xs text-amber-800">Problems: {r.problems}</p>
                )}
                {r.nextPlan && <p className="mt-0.5 text-xs text-slate-500">Next: {r.nextPlan}</p>}
              </li>
            ))}
            {!o.reports.length && (
              <li className="px-5 py-4 text-sm text-slate-500">No reports submitted.</li>
            )}
          </ul>
          <div className="border-t border-slate-100 px-5 py-3 text-right">
            <Link
              to={`/admin/reports?type=work&partnerId=${id}`}
              className="text-xs font-medium text-brand-700 hover:underline"
            >
              Filter all reports
            </Link>
          </div>
        </Card>
      )}
      {tab === 'activity' && (
        <Card>
          <ul className="divide-y divide-slate-100">
            {o.recentUpdates.map((u) => (
              <li key={u.id} className="px-5 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{u.task?.title}</span>
                  <StatusBadge status={u.reviewStatus} />
                  <span className="text-xs text-slate-500">
                    {humanize(u.kind)} · {u.newProgress}% · {minutesToHours(u.minutesSpent)}
                  </span>
                  <span className="ml-auto text-xs text-slate-400">
                    {formatDateTime(u.createdAt)}
                  </span>
                </div>
                <p className="mt-1 text-slate-700">{u.description}</p>
              </li>
            ))}
            {!o.recentUpdates.length && (
              <li className="px-5 py-4 text-sm text-slate-500">No updates yet.</li>
            )}
          </ul>
        </Card>
      )}
      {editing && <EditPartnerDialog partner={p} onClose={() => setEditing(false)} />}
      <TaskFormDialog open={assigning} onClose={() => setAssigning(false)} assigneeId={id} />
      <ConfirmDialog
        open={confirm}
        title={active ? `Deactivate ${p.name}?` : `Reactivate ${p.name}?`}
        description={
          active
            ? 'They are signed out everywhere immediately. Their tasks and history are kept.'
            : 'They can sign in again with their password.'
        }
        confirmLabel={active ? 'Deactivate' : 'Reactivate'}
        danger={active}
        loading={toggle.isPending}
        onConfirm={() => toggle.mutate(active ? UserStatus.INACTIVE : UserStatus.ACTIVE)}
        onClose={() => setConfirm(false)}
      />
    </>
  );
}

function EditPartnerDialog({ partner, onClose }: { partner: User; onClose: () => void }) {
  const qc = useQueryClient();
  const pp = partner.partnerProfile;
  const [f, setF] = useState({
    name: partner.name,
    phone: partner.phone ?? '',
    partnerType: pp?.partnerType ?? 'FREELANCER',
    category: pp?.category ?? '',
    designation: pp?.designation ?? '',
    skills: pp?.skills?.join(', ') ?? '',
    rate: pp?.hourlyRateMinor != null ? fromMinor(pp.hourlyRateMinor) : '',
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((x) => ({ ...x, [k]: e.target.value }));
  const save = useMutation({
    mutationFn: () =>
      patchData(`/users/${partner.id}`, {
        name: f.name,
        phone: f.phone || null,
        partnerProfile: {
          partnerType: f.partnerType,
          category: f.category,
          designation: f.designation,
          skills: f.skills
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          ...(f.rate && { hourlyRateMinor: toMinor(f.rate) }),
        },
      }),
    onSuccess: () => {
      toast.success('Partner updated');
      void qc.invalidateQueries({ queryKey: ['partners', partner.id] });
      void qc.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
  });
  return (
    <Dialog open onClose={onClose} title="Edit partner" className="sm:max-w-xl">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        {save.isError && <FormAlert>{errorMessage(save.error)}</FormAlert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="ep-name">
            <Input id="ep-name" required value={f.name} onChange={set('name')} />
          </Field>
          <Field label="Phone" htmlFor="ep-phone">
            <Input id="ep-phone" value={f.phone} onChange={set('phone')} />
          </Field>
          <Field label="Partner type" htmlFor="ep-type">
            <Select id="ep-type" value={f.partnerType} onChange={set('partnerType')}>
              {PARTNER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {humanize(t)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Category" htmlFor="ep-cat">
            <Input id="ep-cat" value={f.category} onChange={set('category')} />
          </Field>
          <Field label="Designation" htmlFor="ep-des">
            <Input id="ep-des" value={f.designation} onChange={set('designation')} />
          </Field>
          <Field label="Hourly rate (₹)" htmlFor="ep-rate">
            <Input
              id="ep-rate"
              inputMode="decimal"
              pattern="^\d+(\.\d{1,2})?$"
              value={f.rate}
              onChange={set('rate')}
            />
          </Field>
        </div>
        <Field label="Skills (comma separated)" htmlFor="ep-skills">
          <Input id="ep-skills" value={f.skills} onChange={set('skills')} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
