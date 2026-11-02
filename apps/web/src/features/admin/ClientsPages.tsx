import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Building2, MailPlus, MessageSquare, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { CLIENT_STATUSES, ClientStatus } from '@innovexa/shared';
import { Button } from '@/components/ui/button';
import {
  ConfirmDialog,
  DetailList,
  Pagination,
  ProgressBar,
  StatTile,
  StatusBadge,
  TableShell,
  Textarea,
  td,
  th,
} from '@/components/ui/extra';
import { Field, FormAlert, Input, Select } from '@/components/ui/form';
import { Card, CardHeader, Dialog, EmptyState, PageHeader, Skeleton } from '@/components/ui/misc';
import { errorMessage, getData, patchData, postData } from '@/lib/api';
import { InviteEmailStatus, announceInvite } from './InviteStatus';
import { money } from '@/lib/format';
import { useDebounced } from '@/lib/hooks';
import { formatDate, formatDateTime, humanize } from '@/lib/utils';
import type {
  BillingTotals,
  ClientRecord,
  Conversation,
  Invoice,
  Project,
  UpcomingInstallment,
  User,
} from '@/types';

export function ClientsPage() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const search = useDebounced(q);
  const params = { page, limit: 15, ...(search && { q: search }), ...(status && { status }) };
  const clients = useQuery({
    queryKey: ['clients', params],
    queryFn: () => getData<ClientRecord[]>('/clients', params),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <PageHeader
        title="Clients"
        description="Client companies, their logins, projects and balances."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> Add client
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
              placeholder="Search company, contact, email or code"
              className="pl-9"
              aria-label="Search clients"
            />
          </div>
          <Select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            className="sm:w-40"
            aria-label="Status"
          >
            <option value="">All statuses</option>
            {CLIENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </Select>
        </div>
        {clients.isLoading ? (
          <Skeleton className="m-4 h-32" />
        ) : clients.isError ? (
          <div className="p-4">
            <FormAlert>{errorMessage(clients.error)}</FormAlert>
          </div>
        ) : clients.data!.data.length === 0 ? (
          <EmptyState
            icon={<Building2 />}
            title="No clients yet"
            description="Add a client, then create their portal login."
            action={
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus /> Add client
              </Button>
            }
          />
        ) : (
          <TableShell minWidth={820}>
            <thead>
              <tr>
                <th className={th}>Client</th>
                <th className={th}>Contact</th>
                <th className={th}>Projects</th>
                <th className={th}>Logins</th>
                <th className={`${th} text-right`}>Invoiced</th>
                <th className={`${th} text-right`}>Outstanding</th>
                <th className={th}>Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {clients.data!.data.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50/60">
                  <td className={td}>
                    <Link
                      to={`/admin/clients/${c.id}`}
                      className="font-medium text-slate-900 hover:text-brand-700"
                    >
                      {c.companyName}
                    </Link>
                    <div className="text-xs text-slate-500">{c.clientCode}</div>
                  </td>
                  <td className={td}>
                    {c.contactName}
                    <div className="text-xs text-slate-500">{c.email}</div>
                  </td>
                  <td className={td}>
                    {c.projectCount}{' '}
                    <span className="text-xs text-slate-500">({c.activeProjects} active)</span>
                  </td>
                  <td className={td}>{c.loginCount}</td>
                  <td className={`${td} text-right tabular-nums`}>{money(c.invoicedMinor)}</td>
                  <td className={`${td} text-right tabular-nums`}>{money(c.outstandingMinor)}</td>
                  <td className={td}>
                    <StatusBadge status={c.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
        <Pagination meta={clients.data?.meta} onPage={setPage} />
      </Card>
      {creating && <ClientFormDialog onClose={() => setCreating(false)} />}
    </>
  );
}

function ClientFormDialog({ onClose, client }: { onClose: () => void; client?: ClientRecord }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [f, setF] = useState({
    companyName: client?.companyName ?? '',
    contactName: client?.contactName ?? '',
    email: client?.email ?? '',
    phone: client?.phone ?? '',
    gstin: client?.gstin ?? '',
    line1: client?.address?.line1 ?? '',
    city: client?.address?.city ?? '',
    state: client?.address?.state ?? '',
    postalCode: client?.address?.postalCode ?? '',
    notes: client?.notes ?? '',
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((x) => ({ ...x, [k]: e.target.value }));
  const save = useMutation({
    mutationFn: () => {
      const body = {
        companyName: f.companyName,
        contactName: f.contactName,
        email: f.email,
        ...(f.phone && { phone: f.phone }),
        ...(f.gstin && { gstin: f.gstin }),
        address: { line1: f.line1, city: f.city, state: f.state, postalCode: f.postalCode },
        ...(f.notes && { notes: f.notes }),
      };
      return client
        ? patchData<ClientRecord>(`/clients/${client.id}`, body)
        : postData<ClientRecord>('/clients', body);
    },
    onSuccess: (c) => {
      toast.success(client ? 'Client updated' : 'Client added');
      void qc.invalidateQueries({ queryKey: ['clients'] });
      void qc.invalidateQueries({ queryKey: ['options', 'clients'] });
      onClose();
      if (!client) navigate(`/admin/clients/${c.id}`);
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={client ? 'Edit client' : 'Add client'}
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
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company name" htmlFor="c-company">
            <Input id="c-company" required value={f.companyName} onChange={set('companyName')} />
          </Field>
          <Field label="Contact person" htmlFor="c-contact">
            <Input id="c-contact" required value={f.contactName} onChange={set('contactName')} />
          </Field>
          <Field label="Email" htmlFor="c-email">
            <Input id="c-email" type="email" required value={f.email} onChange={set('email')} />
          </Field>
          <Field label="Phone" htmlFor="c-phone">
            <Input id="c-phone" type="tel" value={f.phone} onChange={set('phone')} />
          </Field>
          <Field label="GSTIN" htmlFor="c-gstin">
            <Input id="c-gstin" value={f.gstin} onChange={set('gstin')} maxLength={20} />
          </Field>
          <Field label="Address" htmlFor="c-line1">
            <Input id="c-line1" value={f.line1} onChange={set('line1')} />
          </Field>
          <Field label="City" htmlFor="c-city">
            <Input id="c-city" value={f.city} onChange={set('city')} />
          </Field>
          <Field label="State" htmlFor="c-state">
            <Input id="c-state" value={f.state} onChange={set('state')} />
          </Field>
          <Field label="Postal code" htmlFor="c-pin">
            <Input id="c-pin" value={f.postalCode} onChange={set('postalCode')} />
          </Field>
        </div>
        <Field label="Internal notes" htmlFor="c-notes" hint="Never shown to the client">
          <Textarea id="c-notes" value={f.notes} onChange={set('notes')} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            {client ? 'Save changes' : 'Add client'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

interface ClientDetail extends ClientRecord {
  logins: User[];
  projects: Project[];
  invoices: Invoice[];
  totals: BillingTotals;
  upcomingInstallments: UpcomingInstallment[];
}

export function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [confirmStatus, setConfirmStatus] = useState(false);
  const detail = useQuery({
    queryKey: ['clients', id],
    queryFn: async () => (await getData<ClientDetail>(`/clients/${id}`)).data,
  });
  const toggle = useMutation({
    mutationFn: (status: string) => patchData(`/clients/${id}/status`, { status }),
    onSuccess: () => {
      toast.success('Client status updated');
      setConfirmStatus(false);
      void qc.invalidateQueries({ queryKey: ['clients'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const message = useMutation({
    mutationFn: (userId: string) => postData<Conversation>('/conversations', { userId }),
    onSuccess: (c) => navigate(`/admin/messages?c=${c.id}`),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const resend = useMutation({
    mutationFn: (userId: string) => postData<User>(`/users/${userId}/resend-invite`),
    onSuccess: (user) => {
      announceInvite(user);
      void qc.invalidateQueries({ queryKey: ['clients', id] });
    },
    onError: (e) => {
      toast.error(errorMessage(e), { duration: 12_000 });
      void qc.invalidateQueries({ queryKey: ['clients', id] });
    },
  });

  if (detail.isLoading) return <Skeleton className="h-64" />;
  if (detail.isError) return <FormAlert>{errorMessage(detail.error)}</FormAlert>;
  const c = detail.data!;
  const activeLogin = c.logins.find((l) => l.status === 'ACTIVE');

  return (
    <>
      <Link
        to="/admin/clients"
        className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="size-4" /> Clients
      </Link>
      <PageHeader
        title={c.companyName}
        description={`${c.clientCode} · ${c.contactName} · ${c.email}`}
        actions={
          <>
            <StatusBadge status={c.status} />
            {activeLogin && (
              <Button
                variant="secondary"
                onClick={() => message.mutate(activeLogin.id)}
                loading={message.isPending}
              >
                <MessageSquare /> Message
              </Button>
            )}
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button variant="ghost" onClick={() => setConfirmStatus(true)}>
              {c.status === ClientStatus.ACTIVE ? 'Deactivate' : 'Activate'}
            </Button>
          </>
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Total invoiced"
          value={money(c.totals.invoicedMinor)}
          hint={`${c.totals.invoiceCount} invoices`}
        />
        <StatTile
          label="Advance paid"
          value={money(c.totals.advancePaidMinor)}
          hint={`of ${money(c.totals.advanceDueMinor)} advance`}
          tone="green"
        />
        <StatTile label="Received" value={money(c.totals.receivedMinor)} tone="green" />
        <StatTile
          label="Pending balance"
          value={money(c.totals.outstandingMinor)}
          tone={c.totals.outstandingMinor > 0 ? 'amber' : 'green'}
        />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader
              title="Projects"
              action={
                <Link
                  to="/admin/projects"
                  className="text-xs font-medium text-brand-700 hover:underline"
                >
                  New project
                </Link>
              }
            />
            {c.projects.length === 0 ? (
              <p className="px-5 py-4 text-sm text-slate-500">No projects yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {c.projects.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <Link
                        to={`/admin/projects/${p.id}`}
                        className="font-medium text-slate-900 hover:text-brand-700"
                      >
                        {p.title}
                      </Link>
                      <div className="text-xs text-slate-500">
                        {p.projectCode} · due {formatDate(p.expectedEndDate)}
                      </div>
                    </div>
                    <div className="flex w-48 items-center gap-2">
                      <ProgressBar value={p.approvedProgress} className="flex-1" />
                      <span className="text-xs tabular-nums">{p.approvedProgress}%</span>
                    </div>
                    <StatusBadge status={p.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader
              title="Invoices"
              action={
                <Link
                  to="/admin/invoices"
                  className="text-xs font-medium text-brand-700 hover:underline"
                >
                  Create invoice
                </Link>
              }
            />
            {c.invoices.length === 0 ? (
              <p className="px-5 py-4 text-sm text-slate-500">No invoices yet.</p>
            ) : (
              <TableShell minWidth={560}>
                <thead>
                  <tr>
                    <th className={th}>Invoice</th>
                    <th className={th}>Status</th>
                    <th className={`${th} text-right`}>Total</th>
                    <th className={`${th} text-right`}>Advance paid</th>
                    <th className={`${th} text-right`}>Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {c.invoices.map((i) => (
                    <tr key={i.id}>
                      <td className={td}>
                        <Link
                          to={`/admin/invoices/${i.id}`}
                          className="font-medium hover:text-brand-700"
                        >
                          {i.invoiceNumber}
                        </Link>
                        <div className="text-xs text-slate-500">{i.project?.title}</div>
                      </td>
                      <td className={td}>
                        <StatusBadge status={i.status} />
                      </td>
                      <td className={`${td} text-right tabular-nums`}>{money(i.totalMinor)}</td>
                      <td className={`${td} text-right tabular-nums`}>
                        {money(i.advancePaidMinor)}
                      </td>
                      <td className={`${td} text-right tabular-nums`}>
                        {money(Math.max(0, i.balanceMinor))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
            )}
          </Card>
          <Card>
            <CardHeader title="Upcoming instalments (90 days)" />
            {c.upcomingInstallments.length === 0 ? (
              <p className="px-5 py-4 text-sm text-slate-500">Nothing due.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {c.upcomingInstallments.map((i) => (
                  <li key={i.id} className="flex flex-wrap justify-between gap-2 px-5 py-2.5">
                    <span>
                      {i.invoice?.invoiceNumber} · {humanize(i.kind)} #{i.number}
                    </span>
                    <span className="tabular-nums">
                      {money(i.dueMinor)} due {formatDate(i.dueDate)}{' '}
                      <StatusBadge status={i.status} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="space-y-6">
          <Card className="p-5">
            <DetailList
              items={[
                ['Phone', c.phone],
                ['GSTIN', c.gstin],
                [
                  'Address',
                  [c.address?.line1, c.address?.city, c.address?.state, c.address?.postalCode]
                    .filter(Boolean)
                    .join(', ') || '—',
                ],
                ['Notes', c.notes],
              ]}
            />
          </Card>
          <Card>
            <CardHeader
              title="Portal logins"
              action={
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setInviting(true)}
                  disabled={c.status !== ClientStatus.ACTIVE}
                >
                  <MailPlus /> Create login
                </Button>
              }
            />
            {c.logins.length === 0 ? (
              <p className="px-5 py-4 text-sm text-slate-500">
                No logins yet. Create one so the client can track progress and pay.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {c.logins.map((u) => (
                  <li key={u.id} className="px-5 py-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{u.name}</span>
                      <StatusBadge status={u.status} />
                    </div>
                    <InviteEmailStatus user={u} />
                    <div className="text-xs text-slate-500">
                      {u.email} · last sign-in {formatDateTime(u.lastLoginAt)}
                    </div>
                    <div className="mt-1 flex gap-3">
                      {u.status === 'INVITED' && (
                        <button
                          className="text-xs font-medium text-brand-700 hover:underline"
                          onClick={() => resend.mutate(u.id)}
                        >
                          Resend invitation
                        </button>
                      )}
                      {u.status === 'ACTIVE' && (
                        <button
                          className="text-xs font-medium text-brand-700 hover:underline"
                          onClick={() => message.mutate(u.id)}
                        >
                          Message
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
      {editing && <ClientFormDialog client={c} onClose={() => setEditing(false)} />}
      {inviting && (
        <InviteLoginDialog
          clientId={c.id}
          defaultName={c.contactName}
          defaultEmail={c.email}
          onClose={() => setInviting(false)}
        />
      )}
      <ConfirmDialog
        open={confirmStatus}
        title={
          c.status === ClientStatus.ACTIVE ? 'Deactivate this client?' : 'Activate this client?'
        }
        description={
          c.status === ClientStatus.ACTIVE
            ? 'All portal logins for this client are signed out and blocked. Records are kept.'
            : 'Logins disabled by deactivation can sign in again.'
        }
        confirmLabel={c.status === ClientStatus.ACTIVE ? 'Deactivate' : 'Activate'}
        danger={c.status === ClientStatus.ACTIVE}
        loading={toggle.isPending}
        onConfirm={() =>
          toggle.mutate(
            c.status === ClientStatus.ACTIVE ? ClientStatus.INACTIVE : ClientStatus.ACTIVE,
          )
        }
        onClose={() => setConfirmStatus(false)}
      />
    </>
  );
}

function InviteLoginDialog({
  clientId,
  defaultName,
  defaultEmail,
  onClose,
}: {
  clientId: string;
  defaultName: string;
  defaultEmail: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(defaultName);
  const [email, setEmail] = useState(defaultEmail);
  const invite = useMutation({
    mutationFn: () => postData<User>(`/clients/${clientId}/logins`, { name, email }),
    onSuccess: (user) => {
      announceInvite(user);
      void qc.invalidateQueries({ queryKey: ['clients', clientId] });
      onClose();
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title="Create client login"
      description="The client receives an email link to set their password."
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          invite.mutate();
        }}
      >
        {invite.isError && <FormAlert>{errorMessage(invite.error)}</FormAlert>}
        <Field label="Name" htmlFor="l-name">
          <Input id="l-name" required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Email" htmlFor="l-email">
          <Input
            id="l-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={invite.isPending}>
            <MailPlus /> Send invitation
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
