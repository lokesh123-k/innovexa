import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, MessageSquare, Plus, Send } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Role } from '@innovexa/shared';
import { Button } from '@/components/ui/button';
import { AttachmentList, FilePicker, Textarea } from '@/components/ui/extra';
import { Field, FormAlert, Input, Select } from '@/components/ui/form';
import { Avatar, Card, Dialog, EmptyState, PageHeader, Skeleton } from '@/components/ui/misc';
import { useAuth } from '@/features/auth/AuthProvider';
import { errorMessage, getData, postData, uploadFile } from '@/lib/api';
import { useDebounced } from '@/lib/hooks';
import { cn, formatDateTime, humanize } from '@/lib/utils';
import type { ChatMessage, Conversation, Project, User } from '@/types';

function ConversationList({
  items,
  activeId,
  onSelect,
}: {
  items: Conversation[];
  activeId?: string;
  onSelect: (id: string) => void;
}) {
  const { user } = useAuth();
  return (
    <ul className="divide-y divide-slate-100">
      {items.map((c) => {
        const name = user?.role === Role.ADMIN ? c.user?.name : 'Innovexa team';
        return (
          <li key={c.id}>
            <button
              onClick={() => onSelect(c.id)}
              className={cn(
                'flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50',
                activeId === c.id && 'bg-brand-50/60',
              )}
            >
              <div className="relative">
                <Avatar name={name ?? '?'} />
                {user?.role === Role.ADMIN && c.online && (
                  <span
                    className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-white bg-emerald-500"
                    aria-label="Online"
                  />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-slate-900">{name}</span>
                  {c.unread > 0 && (
                    <span className="rounded-full bg-brand-600 px-1.5 text-xs font-semibold text-white">
                      {c.unread}
                    </span>
                  )}
                </div>
                <div className="truncate text-xs text-slate-500">
                  {c.project
                    ? `${c.project.projectCode ?? ''} ${c.project.title}`
                    : user?.role === Role.ADMIN
                      ? humanize(c.audience)
                      : 'General'}
                </div>
                {c.lastMessagePreview && (
                  <div className="mt-0.5 truncate text-xs text-slate-400">
                    {c.lastMessagePreview}
                  </div>
                )}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Thread({ conversation, onBack }: { conversation: Conversation; onBack: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const bottom = useRef<HTMLDivElement>(null);
  const messages = useQuery({
    queryKey: ['messages', conversation.id],
    queryFn: async () =>
      (await getData<ChatMessage[]>(`/conversations/${conversation.id}/messages`, { limit: 100 }))
        .data,
  });

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
    if (messages.data?.some((m) => !m.readBy.some((r) => r.userId === user?.id))) {
      void postData(`/conversations/${conversation.id}/read`).then(() =>
        qc.invalidateQueries({ queryKey: ['conversations'] }),
      );
    }
  }, [messages.data, conversation.id, user?.id, qc]);

  const send = useMutation({
    mutationFn: async () => {
      const uploaded = await Promise.all(
        files.map((f) => uploadFile(f, 'CONVERSATION', conversation.id)),
      );
      return postData(`/conversations/${conversation.id}/messages`, {
        body,
        attachmentIds: uploaded.map((u) => u.id),
      });
    },
    onSuccess: () => {
      setBody('');
      setFiles([]);
      void qc.invalidateQueries({ queryKey: ['messages', conversation.id] });
      void qc.invalidateQueries({ queryKey: ['conversations'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const title = user?.role === Role.ADMIN ? conversation.user?.name : 'Innovexa team';
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
        <button
          onClick={onBack}
          className="rounded-md p-1 text-slate-500 hover:bg-slate-100 lg:hidden"
          aria-label="Back"
        >
          <ArrowLeft className="size-4" />
        </button>
        <Avatar name={title ?? '?'} />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-900">{title}</div>
          <div className="truncate text-xs text-slate-500">
            {conversation.project
              ? `${conversation.project.projectCode ?? ''} ${conversation.project.title}`
              : 'General conversation'}
            {user?.role === Role.ADMIN && ` · ${conversation.online ? 'Online' : 'Offline'}`}
          </div>
        </div>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50/50 px-4 py-4">
        {messages.isLoading ? (
          <Skeleton className="h-16" />
        ) : messages.isError ? (
          <FormAlert>{errorMessage(messages.error)}</FormAlert>
        ) : messages.data!.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-500">No messages yet. Say hello.</p>
        ) : (
          messages.data!.map((m) => {
            const mine = m.sender?._id === user?.id;
            const readByOther = m.readBy.some((r) => r.userId !== m.sender?._id);
            return (
              <div key={m.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
                <div
                  className={cn(
                    'max-w-[85%] rounded-2xl px-3.5 py-2 text-sm shadow-sm sm:max-w-[70%]',
                    mine ? 'bg-brand-700 text-white' : 'bg-white text-slate-800',
                  )}
                >
                  {!mine && (
                    <div className="mb-0.5 text-xs font-semibold text-brand-700">
                      {m.sender?.name}
                    </div>
                  )}
                  {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                  <AttachmentList files={m.attachments} />
                  <div
                    className={cn('mt-1 text-[10px]', mine ? 'text-brand-100' : 'text-slate-400')}
                  >
                    {formatDateTime(m.createdAt)}
                    {mine && (readByOther ? ' · Read' : ' · Sent')}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottom} />
      </div>
      <form
        className="space-y-2 border-t border-slate-100 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (body.trim() || files.length) send.mutate();
        }}
      >
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write a message…"
          className="min-h-16"
          maxLength={5000}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (body.trim() || files.length) send.mutate();
            }
          }}
          aria-label="Message"
        />
        <div className="flex items-start justify-between gap-2">
          <FilePicker files={files} onChange={setFiles} max={5} />
          <Button type="submit" loading={send.isPending} disabled={!body.trim() && !files.length}>
            <Send /> Send
          </Button>
        </div>
      </form>
    </div>
  );
}

function NewConversationDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { user } = useAuth();
  const isAdmin = user?.role === Role.ADMIN;
  const [q, setQ] = useState('');
  const [userId, setUserId] = useState('');
  const [projectId, setProjectId] = useState('');
  const search = useDebounced(q);
  const people = useQuery({
    queryKey: ['users', 'messageable', search],
    queryFn: async () =>
      (
        await getData<User[]>('/users', { q: search || undefined, status: 'ACTIVE', limit: 30 })
      ).data.filter((u) => u.role !== Role.ADMIN),
    enabled: open && isAdmin,
  });
  const projects = useQuery({
    queryKey: ['projects', 'mine-for-messages'],
    queryFn: async () => (await getData<Project[]>('/projects', { limit: 100 })).data,
    enabled: open,
  });
  const create = useMutation({
    mutationFn: () =>
      postData<Conversation>('/conversations', {
        ...(isAdmin && { userId }),
        ...(projectId && { projectId }),
      }),
    onSuccess: (c) => {
      onCreated(c.id);
      onClose();
    },
  });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New conversation"
      description={isAdmin ? 'Message a partner or a client.' : 'Message the Innovexa team.'}
    >
      <div className="space-y-4">
        {create.isError && <FormAlert>{errorMessage(create.error)}</FormAlert>}
        {isAdmin && (
          <>
            <Field label="Search people" htmlFor="msg-q">
              <Input
                id="msg-q"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Name or email"
              />
            </Field>
            <Field label="Person" htmlFor="msg-user">
              <Select id="msg-user" value={userId} onChange={(e) => setUserId(e.target.value)}>
                <option value="">Select…</option>
                {people.data?.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} · {humanize(u.role)} · {u.email}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        )}
        <Field label="About a project (optional)" htmlFor="msg-project">
          <Select id="msg-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">General</option>
            {projects.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.projectCode} · {p.title}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => create.mutate()}
            loading={create.isPending}
            disabled={isAdmin && !userId}
          >
            Start conversation
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

export function MessagesPage() {
  const [params, setParams] = useSearchParams();
  const activeId = params.get('c') ?? undefined;
  const [creating, setCreating] = useState(false);
  const { user } = useAuth();
  const conversations = useQuery({
    queryKey: ['conversations'],
    queryFn: async () => (await getData<Conversation[]>('/conversations')).data,
    refetchInterval: 60_000,
  });
  const active = useMemo(
    () => conversations.data?.find((c) => c.id === activeId),
    [conversations.data, activeId],
  );
  const select = (id?: string) => setParams(id ? { c: id } : {}, { replace: true });

  return (
    <>
      <PageHeader
        title="Messages"
        description={
          user?.role === Role.ADMIN
            ? 'Conversations with partners and clients.'
            : 'Talk to the Innovexa team.'
        }
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> New conversation
          </Button>
        }
      />
      <Card className="grid h-[calc(100vh-13rem)] min-h-[28rem] overflow-hidden lg:grid-cols-[20rem_1fr]">
        <div
          className={cn(
            'min-h-0 overflow-y-auto border-r border-slate-100',
            active && 'hidden lg:block',
          )}
        >
          {conversations.isLoading ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-14" />
              <Skeleton className="h-14" />
            </div>
          ) : conversations.isError ? (
            <div className="p-4">
              <FormAlert>{errorMessage(conversations.error)}</FormAlert>
            </div>
          ) : conversations.data!.length === 0 ? (
            <EmptyState
              icon={<MessageSquare />}
              title="No conversations"
              description="Start one to get in touch."
            />
          ) : (
            <ConversationList items={conversations.data!} activeId={activeId} onSelect={select} />
          )}
        </div>
        <div className={cn('min-h-0', !active && 'hidden lg:block')}>
          {active ? (
            <Thread key={active.id} conversation={active} onBack={() => select()} />
          ) : (
            <div className="grid h-full place-items-center">
              <EmptyState
                icon={<MessageSquare />}
                title="Select a conversation"
                description="Messages are delivered in real time."
              />
            </div>
          )}
        </div>
      </Card>
      <NewConversationDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => select(id)}
      />
    </>
  );
}
