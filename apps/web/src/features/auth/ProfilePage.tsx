import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { MonitorSmartphone } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { z } from 'zod';
import { passwordSchema, phoneSchema } from '@innovexa/shared';
import { Button } from '@/components/ui/button';
import { Field, FormAlert, Input } from '@/components/ui/form';
import { Avatar, Badge, Card, CardHeader, Dialog, PageHeader } from '@/components/ui/misc';
import { api, errorMessage, type ApiEnvelope } from '@/lib/api';
import { formatDateTime, humanize } from '@/lib/utils';
import type { User } from '@/types';
import { useAuth } from './AuthProvider';

const profileForm = z.object({
  name: z.string().trim().min(2, 'Enter your name').max(100),
  phone: z.union([phoneSchema, z.literal('')]),
});
type ProfileForm = z.infer<typeof profileForm>;

const passwordForm = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: passwordSchema,
    confirm: z.string(),
  })
  .refine((v) => v.newPassword === v.confirm, {
    message: 'Passwords do not match',
    path: ['confirm'],
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    message: 'Choose a different password',
    path: ['newPassword'],
  });
type PasswordForm = z.infer<typeof passwordForm>;

export function ProfilePage() {
  const { user, setUser, logout } = useAuth();
  const navigate = useNavigate();
  const [confirmSignOutAll, setConfirmSignOutAll] = useState(false);

  const profile = useForm<ProfileForm>({
    resolver: zodResolver(profileForm),
    values: { name: user?.name ?? '', phone: user?.phone ?? '' },
  });
  const saveProfile = useMutation({
    mutationFn: (v: ProfileForm) =>
      api.patch<ApiEnvelope<User>>('/users/me', { name: v.name, phone: v.phone || null }),
    onSuccess: (res) => {
      setUser(res.data.data);
      toast.success('Profile updated');
    },
  });

  const pw = useForm<PasswordForm>({ resolver: zodResolver(passwordForm) });
  const changePassword = useMutation({
    mutationFn: (v: PasswordForm) =>
      api.post('/auth/change-password', {
        currentPassword: v.currentPassword,
        newPassword: v.newPassword,
      }),
    onSuccess: () => {
      pw.reset({ currentPassword: '', newPassword: '', confirm: '' });
      toast.success('Password changed. Other devices were signed out.');
    },
  });

  const signOutAll = useMutation({
    mutationFn: () => api.post('/auth/logout-all'),
    onSuccess: async () => {
      await logout().catch(() => undefined);
      navigate('/login', { replace: true });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (!user) return null;

  return (
    <>
      <PageHeader title="My profile" description="Manage your details and account security." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-5">
          <div className="flex items-center gap-4">
            <Avatar name={user.name} className="size-14 text-base" />
            <div className="min-w-0">
              <div className="truncate font-semibold text-slate-900">{user.name}</div>
              <div className="truncate text-sm text-slate-500">{user.email}</div>
            </div>
          </div>
          <dl className="mt-6 space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Role</dt>
              <dd>
                <Badge tone="blue">{humanize(user.role)}</Badge>
              </dd>
            </div>
            {user.partnerProfile && (
              <>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">Partner type</dt>
                  <dd className="text-slate-900">{humanize(user.partnerProfile.partnerType)}</dd>
                </div>
                {user.partnerProfile.category && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-500">Category</dt>
                    <dd className="text-slate-900">{user.partnerProfile.category}</dd>
                  </div>
                )}
              </>
            )}
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Email</dt>
              <dd>
                {user.emailVerified ? (
                  <Badge tone="green">Verified</Badge>
                ) : (
                  <Badge tone="amber">Unverified</Badge>
                )}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Last sign-in</dt>
              <dd className="text-right text-slate-900">{formatDateTime(user.lastLoginAt)}</dd>
            </div>
          </dl>
        </Card>

        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Personal details" />
            <form
              onSubmit={profile.handleSubmit((v) => saveProfile.mutate(v))}
              className="space-y-4 p-5"
              noValidate
            >
              {saveProfile.isError && <FormAlert>{errorMessage(saveProfile.error)}</FormAlert>}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Full name"
                  htmlFor="p-name"
                  error={profile.formState.errors.name?.message}
                >
                  <Input id="p-name" {...profile.register('name')} />
                </Field>
                <Field
                  label="Phone"
                  htmlFor="p-phone"
                  error={profile.formState.errors.phone?.message}
                >
                  <Input id="p-phone" type="tel" {...profile.register('phone')} />
                </Field>
              </div>
              <div className="flex justify-end">
                <Button
                  type="submit"
                  loading={saveProfile.isPending}
                  disabled={!profile.formState.isDirty}
                >
                  Save changes
                </Button>
              </div>
            </form>
          </Card>

          <Card>
            <CardHeader
              title="Change password"
              description="Changing your password signs out your other devices."
            />
            <form
              onSubmit={pw.handleSubmit((v) => changePassword.mutate(v))}
              className="space-y-4 p-5"
              noValidate
            >
              {changePassword.isError && (
                <FormAlert>{errorMessage(changePassword.error)}</FormAlert>
              )}
              <Field
                label="Current password"
                htmlFor="cur"
                error={pw.formState.errors.currentPassword?.message}
              >
                <Input
                  id="cur"
                  type="password"
                  autoComplete="current-password"
                  {...pw.register('currentPassword')}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="New password"
                  htmlFor="new"
                  error={pw.formState.errors.newPassword?.message}
                >
                  <Input
                    id="new"
                    type="password"
                    autoComplete="new-password"
                    {...pw.register('newPassword')}
                  />
                </Field>
                <Field
                  label="Confirm new password"
                  htmlFor="confirm"
                  error={pw.formState.errors.confirm?.message}
                >
                  <Input
                    id="confirm"
                    type="password"
                    autoComplete="new-password"
                    {...pw.register('confirm')}
                  />
                </Field>
              </div>
              <div className="flex justify-end">
                <Button type="submit" loading={changePassword.isPending}>
                  Update password
                </Button>
              </div>
            </form>
          </Card>

          <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <MonitorSmartphone className="mt-0.5 size-5 text-slate-400" />
              <div>
                <div className="text-sm font-semibold text-slate-900">Sign out everywhere</div>
                <p className="text-sm text-slate-500">End every session, including this one.</p>
              </div>
            </div>
            <Button variant="secondary" onClick={() => setConfirmSignOutAll(true)}>
              Sign out all devices
            </Button>
          </Card>
        </div>
      </div>

      <Dialog
        open={confirmSignOutAll}
        onClose={() => setConfirmSignOutAll(false)}
        title="Sign out of all devices?"
      >
        <p className="text-sm text-slate-600">
          You will need to sign in again on every device, including this one.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmSignOutAll(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={signOutAll.isPending}
            onClick={() => signOutAll.mutate()}
          >
            Sign out everywhere
          </Button>
        </div>
      </Dialog>
    </>
  );
}
