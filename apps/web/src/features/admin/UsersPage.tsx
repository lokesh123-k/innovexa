import { zodResolver } from '@hookform/resolvers/zod';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, MailPlus, Search, Send, UserPlus, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  PARTNER_TYPES,
  PartnerType,
  Role,
  UserStatus,
  emailSchema,
  formatMoney,
  phoneSchema,
  toMinor,
} from '@innovexa/shared';
import { Button } from '@/components/ui/button';
import { Field, FormAlert, Input, Select } from '@/components/ui/form';
import {
  Avatar,
  Badge,
  Card,
  Dialog,
  EmptyState,
  PageHeader,
  Skeleton,
} from '@/components/ui/misc';
import { api, errorMessage, getData, postData, type ApiEnvelope } from '@/lib/api';
import { formatDateTime, humanize } from '@/lib/utils';
import type { User } from '@/types';
import { InviteEmailStatus, announceInvite } from './InviteStatus';

const STATUS_TONE = { ACTIVE: 'green', INVITED: 'amber', INACTIVE: 'neutral' } as const;
const ROLE_TONE = { ADMIN: 'blue', PARTNER: 'neutral', CLIENT: 'neutral' } as const;

function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function UsersPage({ fixedRole }: { fixedRole?: Role }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [role, setRole] = useState<string>(fixedRole ?? '');
  const [partnerType, setPartnerType] = useState('');
  const [page, setPage] = useState(1);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [confirming, setConfirming] = useState<User | null>(null);
  const search = useDebounced(q);
  const qc = useQueryClient();

  useEffect(() => {
    setPage(1);
  }, [search, status, role, partnerType]);

  const params = {
    page,
    limit: 15,
    ...(search && { q: search }),
    ...(status && { status }),
    ...(role && { role }),
    ...(partnerType && { partnerType }),
  };
  const users = useQuery({
    queryKey: ['users', params],
    queryFn: () => getData<User[]>('/users', params),
    placeholderData: keepPreviousData,
  });

  const setUserStatus = useMutation({
    mutationFn: (u: User) =>
      api.patch(`/users/${u.id}/status`, {
        status: u.status === UserStatus.ACTIVE ? UserStatus.INACTIVE : UserStatus.ACTIVE,
      }),
    onSuccess: (_r, u) => {
      toast.success(
        u.status === UserStatus.ACTIVE
          ? `${u.name} was deactivated and signed out`
          : `${u.name} was reactivated`,
      );
      setConfirming(null);
      void qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const resend = useMutation({
    mutationFn: (u: User) => postData<User>(`/users/${u.id}/resend-invite`),
    onSuccess: (user) => {
      announceInvite(user);
      void qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (e) => {
      toast.error(errorMessage(e), { duration: 12_000 });
      void qc.invalidateQueries({ queryKey: ['users'] });
    },
  });

  const isPartners = fixedRole === Role.PARTNER;
  const meta = users.data?.meta;

  return (
    <>
      <PageHeader
        title={isPartners ? 'Partners' : 'Users & access'}
        description={
          isPartners
            ? 'Employees, freelancers and contractors who work on Innovexa projects.'
            : 'Everyone with access to the Innovexa portals.'
        }
        actions={
          <Button onClick={() => setInviteOpen(true)}>
            <UserPlus /> {isPartners ? 'Add partner' : 'Invite user'}
          </Button>
        }
      />

      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name or email"
              className="pl-9"
              aria-label="Search users"
            />
          </div>
          <div className="grid grid-cols-2 gap-3 md:flex">
            {!fixedRole && (
              <Select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                aria-label="Role"
                className="md:w-36"
              >
                <option value="">All roles</option>
                {Object.values(Role).map((r) => (
                  <option key={r} value={r}>
                    {humanize(r)}
                  </option>
                ))}
              </Select>
            )}
            {isPartners && (
              <Select
                value={partnerType}
                onChange={(e) => setPartnerType(e.target.value)}
                aria-label="Partner type"
                className="md:w-44"
              >
                <option value="">All types</option>
                {PARTNER_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {humanize(t)}
                  </option>
                ))}
              </Select>
            )}
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              aria-label="Status"
              className="md:w-36"
            >
              <option value="">All statuses</option>
              {Object.values(UserStatus).map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {users.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : users.isError ? (
          <div className="p-4">
            <FormAlert>{errorMessage(users.error)}</FormAlert>
          </div>
        ) : users.data!.data.length === 0 ? (
          <EmptyState
            icon={<Users />}
            title={
              search || status || partnerType
                ? 'No matches'
                : isPartners
                  ? 'No partners yet'
                  : 'No users yet'
            }
            description={
              search || status || partnerType
                ? 'Try a different search or filter.'
                : 'Send an invitation to get started.'
            }
            action={
              !search && !status && !partnerType ? (
                <Button size="sm" onClick={() => setInviteOpen(true)}>
                  <MailPlus /> Send invitation
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">{isPartners ? 'Type' : 'Role'}</th>
                  {isPartners && <th className="px-4 py-3">Rate / hr</th>}
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Last sign-in</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.data!.data.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={u.name} />
                        <div className="min-w-0">
                          {u.role === Role.PARTNER ? (
                            <Link
                              to={`/admin/partners/${u.id}`}
                              className="block truncate font-medium text-slate-900 hover:text-brand-700"
                            >
                              {u.name}
                            </Link>
                          ) : (
                            <div className="truncate font-medium text-slate-900">{u.name}</div>
                          )}
                          <div className="truncate text-xs text-slate-500">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {isPartners ? (
                        <div>
                          <div className="text-slate-800">
                            {u.partnerProfile ? humanize(u.partnerProfile.partnerType) : '—'}
                          </div>
                          {u.partnerProfile?.category && (
                            <div className="text-xs text-slate-500">
                              {u.partnerProfile.category}
                            </div>
                          )}
                        </div>
                      ) : (
                        <Badge tone={ROLE_TONE[u.role]}>{humanize(u.role)}</Badge>
                      )}
                    </td>
                    {isPartners && (
                      <td className="px-4 py-3 tabular-nums text-slate-700">
                        {u.partnerProfile?.hourlyRateMinor != null
                          ? formatMoney(u.partnerProfile.hourlyRateMinor)
                          : '—'}
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <Badge tone={STATUS_TONE[u.status]}>{humanize(u.status)}</Badge>
                      <InviteEmailStatus user={u} />
                    </td>
                    <td className="px-4 py-3 text-slate-600">{formatDateTime(u.lastLoginAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        {u.status === UserStatus.INVITED ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            loading={resend.isPending && resend.variables?.id === u.id}
                            onClick={() => resend.mutate(u)}
                          >
                            <Send /> Resend
                          </Button>
                        ) : (
                          <Button size="sm" variant="ghost" onClick={() => setConfirming(u)}>
                            {u.status === UserStatus.ACTIVE ? 'Deactivate' : 'Activate'}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {meta && meta.total > 0 && (
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm text-slate-600">
            <span>
              {(meta.page - 1) * meta.limit + 1}–{Math.min(meta.page * meta.limit, meta.total)} of{' '}
              {meta.total}
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={meta.page <= 1}
                onClick={() => setPage((p) => p - 1)}
                aria-label="Previous page"
              >
                <ChevronLeft />
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={meta.page >= meta.totalPages}
                onClick={() => setPage((p) => p + 1)}
                aria-label="Next page"
              >
                <ChevronRight />
              </Button>
            </div>
          </div>
        )}
      </Card>

      <InviteDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        defaultRole={fixedRole ?? Role.PARTNER}
        lockRole={!!fixedRole}
      />

      <Dialog
        open={!!confirming}
        onClose={() => setConfirming(null)}
        title={
          confirming?.status === UserStatus.ACTIVE
            ? `Deactivate ${confirming?.name}?`
            : `Reactivate ${confirming?.name}?`
        }
      >
        <p className="text-sm text-slate-600">
          {confirming?.status === UserStatus.ACTIVE
            ? 'They will be signed out on every device immediately and will not be able to sign in until reactivated. Their records are kept.'
            : 'They will be able to sign in again with their existing password.'}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirming(null)}>
            Cancel
          </Button>
          <Button
            variant={confirming?.status === UserStatus.ACTIVE ? 'danger' : 'primary'}
            loading={setUserStatus.isPending}
            onClick={() => confirming && setUserStatus.mutate(confirming)}
          >
            {confirming?.status === UserStatus.ACTIVE ? 'Deactivate' : 'Reactivate'}
          </Button>
        </div>
      </Dialog>
    </>
  );
}

const inviteForm = z.object({
  name: z.string().trim().min(2, 'Enter a name').max(100),
  email: emailSchema,
  phone: z.union([phoneSchema, z.literal('')]),
  role: z.enum([Role.ADMIN, Role.PARTNER]),
  partnerType: z.enum(PARTNER_TYPES),
  category: z.string().trim().max(80),
  designation: z.string().trim().max(80),
  hourlyRate: z
    .string()
    .trim()
    .refine((v) => v === '' || /^\d+(\.\d{1,2})?$/.test(v), 'Enter an amount like 1500 or 1500.50'),
});
type InviteForm = z.infer<typeof inviteForm>;

function InviteDialog({
  open,
  onClose,
  defaultRole,
  lockRole,
}: {
  open: boolean;
  onClose: () => void;
  defaultRole: Role;
  lockRole: boolean;
}) {
  const qc = useQueryClient();
  const defaults: InviteForm = {
    name: '',
    email: '',
    phone: '',
    role: defaultRole === Role.ADMIN ? Role.ADMIN : Role.PARTNER,
    partnerType: PartnerType.FREELANCER,
    category: '',
    designation: '',
    hourlyRate: '',
  };
  const form = useForm<InviteForm>({ resolver: zodResolver(inviteForm), defaultValues: defaults });
  const role = form.watch('role');
  const { errors } = form.formState;

  const invite = useMutation({
    mutationFn: (v: InviteForm) =>
      api.post<ApiEnvelope<User>>('/users/invite', {
        name: v.name,
        email: v.email,
        role: v.role,
        ...(v.phone && { phone: v.phone }),
        ...(v.role === Role.PARTNER && {
          partnerProfile: {
            partnerType: v.partnerType,
            ...(v.category && { category: v.category }),
            ...(v.designation && { designation: v.designation }),
            ...(v.hourlyRate && { hourlyRateMinor: toMinor(v.hourlyRate) }),
          },
        }),
      }),
    onSuccess: (res) => {
      announceInvite(res.data.data);
      void qc.invalidateQueries({ queryKey: ['users'] });
      form.reset(defaults);
      onClose();
    },
  });

  const close = () => {
    invite.reset();
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={role === Role.PARTNER ? 'Add a partner' : 'Invite an admin'}
      description="They'll receive an email link to set their password."
    >
      <form onSubmit={form.handleSubmit((v) => invite.mutate(v))} className="space-y-4" noValidate>
        {invite.isError && <FormAlert>{errorMessage(invite.error)}</FormAlert>}
        {!lockRole && (
          <Field
            label="Access"
            htmlFor="role"
            hint="Client logins are created from a client record (coming with the Clients module)."
          >
            <Select id="role" {...form.register('role')}>
              <option value={Role.PARTNER}>Partner</option>
              <option value={Role.ADMIN}>Admin</option>
            </Select>
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" htmlFor="name" error={errors.name?.message}>
            <Input id="name" aria-invalid={!!errors.name} {...form.register('name')} />
          </Field>
          <Field label="Email" htmlFor="invite-email" error={errors.email?.message}>
            <Input
              id="invite-email"
              type="email"
              aria-invalid={!!errors.email}
              {...form.register('email')}
            />
          </Field>
        </div>
        <Field label="Phone (optional)" htmlFor="phone" error={errors.phone?.message}>
          <Input id="phone" type="tel" aria-invalid={!!errors.phone} {...form.register('phone')} />
        </Field>
        {role === Role.PARTNER && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Partner type" htmlFor="partnerType">
                <Select id="partnerType" {...form.register('partnerType')}>
                  {PARTNER_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {humanize(t)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Category" htmlFor="category" hint="e.g. Web Development">
                <Input id="category" {...form.register('category')} />
              </Field>
              <Field label="Designation" htmlFor="designation">
                <Input id="designation" {...form.register('designation')} />
              </Field>
              <Field
                label="Hourly rate (₹)"
                htmlFor="hourlyRate"
                error={errors.hourlyRate?.message}
                hint="Visible to admins only"
              >
                <Input
                  id="hourlyRate"
                  inputMode="decimal"
                  aria-invalid={!!errors.hourlyRate}
                  {...form.register('hourlyRate')}
                />
              </Field>
            </div>
          </>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={close}>
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
