import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, FilePlus2, GitPullRequest } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { CHANGE_REQUEST_STATUSES, ChangeRequestStatus, Role, toMinor } from '@innovexa/shared';
import { Button } from '@/components/ui/button';
import {
  AttachmentList,
  FilePicker,
  StatusBadge,
  TableShell,
  Textarea,
  td,
  th,
} from '@/components/ui/extra';
import { Field, FormAlert, Input, Select } from '@/components/ui/form';
import { Card, CardHeader, Dialog, EmptyState, PageHeader, Skeleton } from '@/components/ui/misc';
import { PartnerPicker } from '@/features/admin/TaskForm';
import { useAuth } from '@/features/auth/AuthProvider';
import { errorMessage, getData, patchData, postData, uploadFile } from '@/lib/api';
import { money } from '@/lib/format';
import { formatDate, formatDateTime, humanize } from '@/lib/utils';
import type { ChangeRequest, Project } from '@/types';

function useBase() {
  const { user } = useAuth();
  return user?.role === Role.ADMIN ? '/admin' : '/client';
}

export function ChangeRequestsPage() {
  const { user } = useAuth();
  const base = useBase();
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const list = useQuery({
    queryKey: ['change-requests', status],
    queryFn: async () =>
      (
        await getData<ChangeRequest[]>('/change-requests', {
          limit: 100,
          ...(status && { status }),
        })
      ).data,
  });
  const isClient = user?.role === Role.CLIENT;
  return (
    <>
      <PageHeader
        title="Change requests"
        description={
          isClient
            ? 'Ask for changes to your project and follow their review.'
            : 'Client change requests awaiting review or response.'
        }
        actions={
          isClient ? (
            <Button onClick={() => setCreating(true)}>
              <FilePlus2 /> New change request
            </Button>
          ) : undefined
        }
      />
      <Card>
        <div className="border-b border-slate-100 p-4">
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="sm:w-52"
            aria-label="Status"
          >
            <option value="">All statuses</option>
            {CHANGE_REQUEST_STATUSES.map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </Select>
        </div>
        {list.isLoading ? (
          <Skeleton className="m-4 h-24" />
        ) : list.isError ? (
          <div className="p-4">
            <FormAlert>{errorMessage(list.error)}</FormAlert>
          </div>
        ) : list.data!.length === 0 ? (
          <EmptyState
            icon={<GitPullRequest />}
            title="No change requests"
            description={
              isClient
                ? 'Submit a request whenever you need something changed.'
                : 'Client requests will appear here.'
            }
          />
        ) : (
          <TableShell minWidth={640}>
            <thead>
              <tr>
                <th className={th}>Request</th>
                <th className={th}>Project</th>
                {!isClient && <th className={th}>Client</th>}
                <th className={th}>Status</th>
                <th className={th}>Submitted</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.data!.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50/60">
                  <td className={td}>
                    <Link
                      to={`${base}/change-requests/${c.id}`}
                      className="font-medium text-slate-900 hover:text-brand-700"
                    >
                      {c.title}
                    </Link>
                    <div className="text-xs text-slate-500">{c.requestCode}</div>
                  </td>
                  <td className={td}>{c.projectId?.title}</td>
                  {!isClient && <td className={td}>{c.clientId?.companyName}</td>}
                  <td className={td}>
                    <StatusBadge status={c.status} />
                  </td>
                  <td className={td}>{formatDate(c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </Card>
      {creating && <NewChangeRequestDialog onClose={() => setCreating(false)} />}
    </>
  );
}

function NewChangeRequestDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const projects = useQuery({
    queryKey: ['projects', 'mine'],
    queryFn: async () => (await getData<Project[]>('/projects', { limit: 100 })).data,
  });
  const [projectId, setProjectId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const create = useMutation({
    mutationFn: async () => {
      const cr = await postData<ChangeRequest>('/change-requests', {
        projectId,
        title,
        description,
      });
      await Promise.all(files.map((f) => uploadFile(f, 'CHANGE_REQUEST', cr.id)));
      return cr;
    },
    onSuccess: (cr) => {
      toast.success('Change request submitted');
      void qc.invalidateQueries({ queryKey: ['change-requests'] });
      onClose();
      navigate(`/client/change-requests/${cr.id}`);
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title="New change request"
      description="Describe what you would like changed. The team will review scope and cost before work starts."
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        {create.isError && <FormAlert>{errorMessage(create.error)}</FormAlert>}
        <Field label="Project" htmlFor="cr-project">
          <Select
            id="cr-project"
            required
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="">Select a project…</option>
            {projects.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Title" htmlFor="cr-title">
          <Input
            id="cr-title"
            required
            minLength={2}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <Field label="What should change?" htmlFor="cr-desc">
          <Textarea
            id="cr-desc"
            required
            minLength={10}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <div>
          <div className="mb-1.5 text-sm font-medium text-slate-700">
            Reference images or documents
          </div>
          <FilePicker files={files} onChange={setFiles} />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={create.isPending} disabled={!projectId}>
            Submit request
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function ChangeRequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const base = useBase();
  const qc = useQueryClient();
  const isAdmin = user?.role === Role.ADMIN;
  const [reply, setReply] = useState('');
  const [status, setStatus] = useState('');
  const [note, setNote] = useState('');
  const [orderOpen, setOrderOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const cr = useQuery({
    queryKey: ['change-requests', id],
    queryFn: async () => (await getData<ChangeRequest>(`/change-requests/${id}`)).data,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['change-requests'] });
  const respond = useMutation({
    mutationFn: () => postData(`/change-requests/${id}/responses`, { body: reply }),
    onSuccess: () => {
      setReply('');
      void refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const updateStatus = useMutation({
    mutationFn: () => patchData(`/change-requests/${id}/status`, { status, ...(note && { note }) }),
    onSuccess: () => {
      toast.success('Status updated');
      setNote('');
      void refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (cr.isLoading) return <Skeleton className="h-64" />;
  if (cr.isError) return <FormAlert>{errorMessage(cr.error)}</FormAlert>;
  const c = cr.data!;
  const closed =
    c.status === ChangeRequestStatus.REJECTED || c.status === ChangeRequestStatus.COMPLETED;

  return (
    <>
      <Link
        to={`${base}/change-requests`}
        className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="size-4" /> Change requests
      </Link>
      <PageHeader
        title={c.title}
        description={`${c.requestCode} · ${c.projectId?.title}${isAdmin ? ` · ${c.clientId?.companyName}` : ''}`}
        actions={<StatusBadge status={c.status} />}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card className="p-5">
            <p className="whitespace-pre-wrap text-sm text-slate-800">{c.description}</p>
            <AttachmentList files={c.attachments} />
            {c.changeOrder?.approvedAt && (
              <div className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                Approved change order: {c.changeOrder.description} —{' '}
                {money(c.changeOrder.amountMinor)} (approved {formatDate(c.changeOrder.approvedAt)})
              </div>
            )}
          </Card>
          <Card>
            <CardHeader title="Conversation" />
            <ul className="divide-y divide-slate-100">
              {(c.responses ?? []).map((r) => (
                <li key={r._id} className="px-5 py-3 text-sm">
                  <div className="flex justify-between text-xs text-slate-500">
                    <span className="font-medium text-slate-800">
                      {r.authorId?.name} · {humanize(r.authorId?.role ?? '')}
                    </span>
                    <span>{formatDateTime(r.at)}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-slate-700">{r.body}</p>
                </li>
              ))}
              {!c.responses?.length && (
                <li className="px-5 py-4 text-sm text-slate-500">No responses yet.</li>
              )}
            </ul>
            {!closed && (
              <form
                className="space-y-2 border-t border-slate-100 p-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  respond.mutate();
                }}
              >
                <Textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder={
                    isAdmin ? 'Reply to the client…' : 'Add details or answer a question…'
                  }
                  aria-label="Reply"
                />
                <div className="flex justify-end">
                  <Button type="submit" loading={respond.isPending} disabled={!reply.trim()}>
                    Send reply
                  </Button>
                </div>
              </form>
            )}
          </Card>
        </div>
        <div className="space-y-6">
          {isAdmin && (
            <Card className="space-y-3 p-5">
              <div className="text-sm font-semibold text-slate-900">Admin actions</div>
              <Field label="Update status" htmlFor="cr-status">
                <Select id="cr-status" value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="">Select…</option>
                  {CHANGE_REQUEST_STATUSES.filter((s) => s !== 'CONVERTED_TO_TASK').map((s) => (
                    <option key={s} value={s}>
                      {humanize(s)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Note for the client (optional)"
                className="min-h-16"
                aria-label="Status note"
              />
              <Button
                className="w-full"
                onClick={() => updateStatus.mutate()}
                loading={updateStatus.isPending}
                disabled={!status}
              >
                Update status
              </Button>
              <div className="border-t border-slate-100 pt-3" />
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => setOrderOpen(true)}
                disabled={!!c.changeOrder?.approvedAt}
              >
                Approve change order
              </Button>
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => setConvertOpen(true)}
                disabled={!!c.taskId}
              >
                Convert to task
              </Button>
              <p className="text-xs text-slate-500">
                Scope or price changes affect the contract only after a change order is approved.
              </p>
            </Card>
          )}
          <Card>
            <CardHeader title="History" />
            <ul className="divide-y divide-slate-100 text-sm">
              {[...(c.history ?? [])].reverse().map((h, i) => (
                <li key={i} className="px-5 py-2.5">
                  <StatusBadge status={h.status} />
                  {h.note && <p className="mt-1 text-slate-700">{h.note}</p>}
                  <div className="mt-0.5 text-xs text-slate-400">
                    {h.by?.name} · {formatDateTime(h.at)}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
      {orderOpen && <ChangeOrderDialog cr={c} onClose={() => setOrderOpen(false)} />}
      {convertOpen && <ConvertDialog cr={c} onClose={() => setConvertOpen(false)} />}
    </>
  );
}

function ChangeOrderDialog({ cr, onClose }: { cr: ChangeRequest; onClose: () => void }) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState(cr.title);
  const approve = useMutation({
    mutationFn: () =>
      postData(`/change-requests/${cr.id}/change-order`, {
        amountMinor: toMinor(amount || '0'),
        description,
      }),
    onSuccess: () => {
      toast.success('Change order approved — contract updated');
      void qc.invalidateQueries({ queryKey: ['change-requests'] });
      void qc.invalidateQueries({ queryKey: ['projects'] });
      onClose();
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title="Approve change order"
      description={`Current contract: ${money(cr.projectId?.contractAmountMinor)}. The amount is added to the project contract.`}
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          approve.mutate();
        }}
      >
        {approve.isError && <FormAlert>{errorMessage(approve.error)}</FormAlert>}
        <Field
          label="Additional amount (₹)"
          htmlFor="co-amt"
          hint="Use 0 for scope changes without a price change"
        >
          <Input
            id="co-amt"
            inputMode="decimal"
            pattern="^\d+(\.\d{1,2})?$"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Field label="Description" htmlFor="co-desc">
          <Input
            id="co-desc"
            required
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={approve.isPending}>
            Approve
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function ConvertDialog({ cr, onClose }: { cr: ChangeRequest; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [assignees, setAssignees] = useState<string[]>([]);
  const convert = useMutation({
    mutationFn: () =>
      postData<{ task: { id: string } }>(`/change-requests/${cr.id}/convert-to-task`, {
        assigneeIds: assignees,
      }),
    onSuccess: (r) => {
      toast.success('Task created from change request');
      void qc.invalidateQueries({ queryKey: ['change-requests'] });
      onClose();
      navigate(`/admin/tasks/${r.task.id}`);
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title="Convert to task"
      description="Creates a task in the project from this request."
    >
      {convert.isError && <FormAlert>{errorMessage(convert.error)}</FormAlert>}
      <div className="mb-1.5 text-sm font-medium text-slate-700">Assign partners (optional)</div>
      <PartnerPicker value={assignees} onChange={setAssignees} />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => convert.mutate()} loading={convert.isPending}>
          Create task
        </Button>
      </div>
    </Dialog>
  );
}
