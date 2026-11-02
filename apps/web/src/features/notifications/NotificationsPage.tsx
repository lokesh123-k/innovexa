import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Pagination, Tabs } from '@/components/ui/extra';
import { FormAlert } from '@/components/ui/form';
import { Card, EmptyState, PageHeader, Skeleton } from '@/components/ui/misc';
import { api, errorMessage, getData, postData, type ApiEnvelope } from '@/lib/api';
import { cn, formatDateTime, humanize } from '@/lib/utils';
import type { AppNotification } from '@/types';

type Meta = ApiEnvelope<unknown>['meta'] & { unread: number };

export function useUnreadNotifications() {
  return useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: async () =>
      (
        (await api.get<ApiEnvelope<AppNotification[]>>('/notifications', { params: { limit: 1 } }))
          .data.meta as Meta
      ).unread,
    refetchInterval: 60_000,
  });
}

export function useUnreadMessages() {
  return useQuery({
    queryKey: ['conversations', 'unread'],
    queryFn: async () =>
      (await getData<{ unread: number }>('/conversations/unread-count')).data.unread,
    refetchInterval: 60_000,
  });
}

export function NotificationsPage() {
  const [tab, setTab] = useState<'all' | 'unread'>('all');
  const [page, setPage] = useState(1);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const params = { page, limit: 20, ...(tab === 'unread' && { unreadOnly: 'true' }) };
  const list = useQuery({
    queryKey: ['notifications', params],
    queryFn: async () =>
      (await api.get<ApiEnvelope<AppNotification[]>>('/notifications', { params })).data,
    placeholderData: keepPreviousData,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  const readAll = useMutation({
    mutationFn: () => postData('/notifications/read-all'),
    onSuccess: invalidate,
  });
  const open = async (n: AppNotification) => {
    if (!n.readAt) await postData(`/notifications/${n._id}/read`).then(invalidate);
    if (n.link) navigate(n.link);
  };
  const meta = list.data?.meta as Meta | undefined;

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Assignments, approvals, messages and payment updates."
        actions={
          <Button
            variant="secondary"
            onClick={() => readAll.mutate()}
            loading={readAll.isPending}
            disabled={!meta?.unread}
          >
            <CheckCheck /> Mark all read
          </Button>
        }
      />
      <Tabs
        tabs={[
          { value: 'all', label: 'All' },
          { value: 'unread', label: 'Unread', count: meta?.unread },
        ]}
        value={tab}
        onChange={(v) => {
          setTab(v);
          setPage(1);
        }}
      />
      <Card>
        {list.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : list.isError ? (
          <div className="p-4">
            <FormAlert>{errorMessage(list.error)}</FormAlert>
          </div>
        ) : list.data!.data.length === 0 ? (
          <EmptyState
            icon={<Bell />}
            title="You're all caught up"
            description="New notifications will appear here."
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {list.data!.data.map((n) => (
              <li key={n._id}>
                <button
                  onClick={() => void open(n)}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50"
                >
                  <span
                    className={cn(
                      'mt-1.5 size-2 shrink-0 rounded-full',
                      n.readAt ? 'bg-transparent' : 'bg-brand-600',
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div
                      className={cn(
                        'text-sm',
                        n.readAt ? 'text-slate-700' : 'font-semibold text-slate-900',
                      )}
                    >
                      {n.title}
                    </div>
                    {n.body && <div className="mt-0.5 text-sm text-slate-500">{n.body}</div>}
                    <div className="mt-1 text-xs text-slate-400">
                      {humanize(n.type)} · {formatDateTime(n.createdAt)}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
        <Pagination meta={meta} onPage={setPage} />
      </Card>
    </>
  );
}
