import type { Types } from 'mongoose';
import { Role, UserStatus, type NotificationType } from '@innovexa/shared';
import { env } from '../../config/env.js';
import { emitToUsers } from '../../sockets/io.js';
import { pageMeta } from '../../utils/http.js';
import { actionEmail, sendMailSafe } from '../../utils/mailer.js';
import { User } from '../users/user.model.js';
import { Notification } from './notification.model.js';

type Id = Types.ObjectId | string;

export interface NotifyInput {
  recipients: readonly Id[];
  type: NotificationType;
  title: string;
  body?: string;
  /** In-app path, e.g. /partner/tasks/<id>. */
  link?: string;
  data?: Record<string, unknown>;
  /** Also send an email (for events people should not miss). */
  email?: boolean;
  /** Never notify the person who caused the event. */
  exclude?: Id;
}

/** Persists in-app notifications, pushes them over Socket.IO, and optionally emails. */
export async function notify(input: NotifyInput): Promise<void> {
  const exclude = input.exclude?.toString();
  const recipients = [...new Set(input.recipients.map(String))].filter((id) => id !== exclude);
  if (recipients.length === 0) return;

  const docs = await Notification.insertMany(
    recipients.map((recipientId) => ({
      recipientId,
      type: input.type,
      title: input.title,
      body: input.body,
      link: input.link,
      data: input.data,
    })),
  );
  for (const doc of docs) {
    emitToUsers([doc.recipientId.toString()], 'notification:new', {
      id: doc._id.toString(),
      type: doc.type,
      title: doc.title,
      body: doc.body,
      link: doc.link,
      createdAt: doc.createdAt,
    });
  }

  if (input.email) {
    const users = await User.find({ _id: { $in: recipients }, status: UserStatus.ACTIVE })
      .select('email name')
      .lean();
    for (const u of users) {
      sendMailSafe({
        to: u.email,
        subject: input.title,
        ...actionEmail({
          greeting: `Hi ${u.name},`,
          body: input.body ?? input.title,
          actionLabel: 'Open Innovexa',
          url: `${env().APP_URL}${input.link ?? '/'}`,
        }),
      });
    }
  }
}

export async function adminIds(): Promise<Types.ObjectId[]> {
  const admins = await User.find({ role: Role.ADMIN, status: UserStatus.ACTIVE, deletedAt: null })
    .select('_id')
    .lean();
  return admins.map((a) => a._id);
}

export async function notifyAdmins(input: Omit<NotifyInput, 'recipients'>): Promise<void> {
  await notify({ ...input, recipients: await adminIds() });
}

export async function listNotifications(
  userId: Types.ObjectId,
  q: { page: number; limit: number; unreadOnly?: boolean },
) {
  const filter = { recipientId: userId, ...(q.unreadOnly ? { readAt: null } : {}) };
  const [items, total, unread] = await Promise.all([
    Notification.find(filter)
      .sort({ createdAt: -1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .lean(),
    Notification.countDocuments(filter),
    Notification.countDocuments({ recipientId: userId, readAt: null }),
  ]);
  return { items, unread, meta: pageMeta(q.page, q.limit, total) };
}

export async function markRead(userId: Types.ObjectId, id?: string): Promise<number> {
  const res = await Notification.updateMany(
    { recipientId: userId, readAt: null, ...(id ? { _id: id } : {}) },
    { $set: { readAt: new Date() } },
  );
  return res.modifiedCount;
}
