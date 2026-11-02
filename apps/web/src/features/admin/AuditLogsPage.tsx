import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { FormAlert, Select } from '@/components/ui/form';
import { Card, EmptyState, PageHeader, Skeleton } from '@/components/ui/misc';
import { errorMessage, getData } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';
import type { AuditLogEntry } from '@/types';

const ACTIONS = [
  'auth.login',
  'auth.invitation_accepted',
  'auth.password_reset',
  'auth.password_changed',
  'auth.logout_all',
  'user.invited',
  'user.invite_resent',
  'user.updated',
  'user.activated',
  'user.deactivated',
  'user.profile_updated',
];

export const describeAction = (action: string) =>
  ({
    'auth.login': 'signed in',
    'auth.invitation_accepted': 'activated their account',
    'auth.password_reset': 'reset their password',
    'auth.password_changed': 'changed their password',
    'auth.logout_all': 'signed out of all devices',
    'user.invited': 'invited a user',
    'user.invite_resent': 're-sent an invitation',
    'user.updated': 'updated a user',
    'user.activated': 'activated a user',
    'user.deactivated': 'deactivated a user',
    'user.profile_updated': 'updated their profile',
  })[action] ?? action;

export function AuditLogsPage() {
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const params = { page, limit: 25, ...(action && { action }) };
  const logs = useQuery({
    queryKey: ['audit-logs', params],
    queryFn: () => getData<AuditLogEntry[]>('/audit-logs', params),
    placeholderData: keepPreviousData,
  });
  const meta = logs.data?.meta;

  return (
    <>
      <PageHeader
        title="Audit logs"
        description="A record of sign-ins and administrative changes."
      />
      <Card>
        <div className="border-b border-slate-100 p-4">
          <Select
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setPage(1);
            }}
            className="sm:w-64"
            aria-label="Filter by action"
          >
            <option value="">All actions</option>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
        </div>
        {logs.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : logs.isError ? (
          <div className="p-4">
            <FormAlert>{errorMessage(logs.error)}</FormAlert>
          </div>
        ) : logs.data!.data.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck />}
            title="No activity"
            description="Nothing matches this filter yet."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">When</th>
                  <th className="px-4 py-3">Actor</th>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">IP address</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {logs.data!.data.map((l) => (
                  <tr key={l._id}>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                      {formatDateTime(l.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">
                        {l.actorId?.name ?? 'System'}
                      </div>
                      <div className="text-xs text-slate-500">
                        {l.actorId?.email ?? l.actorRole}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">
                        {l.action}
                      </code>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{l.ip ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {meta && meta.total > 0 && (
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm text-slate-600">
            <span>
              Page {meta.page} of {meta.totalPages}
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
    </>
  );
}
