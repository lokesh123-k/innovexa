import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { DetailList, StatusBadge } from '@/components/ui/extra';
import { FormAlert, Input } from '@/components/ui/form';
import { Card, CardHeader, PageHeader, Skeleton } from '@/components/ui/misc';
import { errorMessage, getData, patchData, postData } from '@/lib/api';
import { humanize } from '@/lib/utils';
import type { ServiceCategory } from '@/types';

interface SettingsStatus {
  environment: string;
  email: {
    transport: string;
    from: string;
    ok: boolean;
    host?: string;
    user?: string;
    error?: string;
  };
  payments: { enabled: boolean; provider: string; keyId?: string };
  storage: { provider: string; maxUploadMb: number };
  jobs: { enabled: boolean };
  security: { cookieSecure: boolean; rateLimit: boolean; lockoutAfter: number };
}

export function SettingsPage() {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const categories = useQuery({
    queryKey: ['service-categories', 'all'],
    queryFn: async () =>
      (await getData<ServiceCategory[]>('/service-categories', { all: 'true' })).data,
  });
  const status = useQuery({
    queryKey: ['settings-status'],
    queryFn: async () => (await getData<SettingsStatus>('/dashboard/settings-status')).data,
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['service-categories'] });
    void qc.invalidateQueries({ queryKey: ['options', 'categories'] });
  };
  const add = useMutation({
    mutationFn: () => postData('/service-categories', { name }),
    onSuccess: () => {
      setName('');
      toast.success('Category added');
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const toggle = useMutation({
    mutationFn: (c: ServiceCategory) =>
      patchData(`/service-categories/${c._id}`, { isActive: !c.isActive }),
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const s = status.data;
  const testEmail = useMutation({
    mutationFn: () => postData<{ to: string }>('/dashboard/email-test'),
    onSuccess: (r) =>
      toast.success(`Test email sent to ${r.to}. Check the inbox (and spam folder).`),
    onError: (e) => toast.error(errorMessage(e), { duration: 12_000 }),
  });

  return (
    <>
      <PageHeader title="Settings" description="Service categories and platform configuration." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Service categories"
            description="Used when creating projects. Deactivated categories stay on existing projects."
          />
          <form
            className="flex gap-2 border-b border-slate-100 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              add.mutate();
            }}
          >
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="New category name"
              aria-label="New category name"
            />
            <Button type="submit" loading={add.isPending} disabled={name.trim().length < 2}>
              <Plus /> Add
            </Button>
          </form>
          {categories.isLoading ? (
            <Skeleton className="m-4 h-24" />
          ) : categories.isError ? (
            <div className="p-4">
              <FormAlert>{errorMessage(categories.error)}</FormAlert>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {categories.data!.map((c) => (
                <li
                  key={c._id}
                  className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm"
                >
                  <span>
                    {c.name}
                    {c.isSystem && <span className="ml-2 text-xs text-slate-400">default</span>}
                  </span>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={c.isActive ? 'ACTIVE' : 'INACTIVE'} />
                    <Button size="sm" variant="ghost" onClick={() => toggle.mutate(c)}>
                      {c.isActive ? 'Deactivate' : 'Activate'}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader
            title="Platform status"
            description="Read-only. Configure these with server environment variables."
            action={
              <Button
                size="sm"
                variant="secondary"
                onClick={() => testEmail.mutate()}
                loading={testEmail.isPending}
                disabled={!s?.email.ok || s.email.transport !== 'smtp'}
              >
                Send test email
              </Button>
            }
          />
          <div className="p-5">
            {!s ? (
              <Skeleton className="h-32" />
            ) : (
              <DetailList
                items={[
                  ['Environment', humanize(s.environment)],
                  [
                    'Email delivery',
                    s.email.transport !== 'smtp' ? (
                      <span className="text-amber-700">
                        Not configured: emails are not sent (EMAIL_TRANSPORT={s.email.transport})
                      </span>
                    ) : s.email.ok ? (
                      <span className="text-emerald-700">
                        Connected · {s.email.host} as {s.email.user}
                      </span>
                    ) : (
                      <span className="text-red-600">Failed · {s.email.error}</span>
                    ),
                  ],
                  ['Sender', s.email.from],
                  [
                    'Online payments',
                    s.payments.enabled
                      ? `Razorpay enabled (${s.payments.keyId})`
                      : 'Disabled — set RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET',
                  ],
                  [
                    'File storage',
                    `${humanize(s.storage.provider)} · max ${s.storage.maxUploadMb} MB per file`,
                  ],
                  ['Reminder jobs', s.jobs.enabled ? 'Running every 30 minutes' : 'Disabled'],
                  ['Secure cookies', s.security.cookieSecure ? 'On' : 'Off (development)'],
                  ['Rate limiting', s.security.rateLimit ? 'On' : 'Off'],
                  ['Account lockout', `After ${s.security.lockoutAfter} failed sign-ins`],
                ]}
              />
            )}
          </div>
        </Card>
      </div>
    </>
  );
}
