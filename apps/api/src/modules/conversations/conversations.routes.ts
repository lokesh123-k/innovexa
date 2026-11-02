import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import {
  ConversationType,
  FileScope,
  NotificationType,
  Role,
  UserStatus,
  createConversationSchema,
  idParamSchema,
  listMessagesQuerySchema,
  sendMessageSchema,
  type CreateConversationInput,
  type SendMessageInput,
} from '@innovexa/shared';
import { authenticate, currentUser } from '../../middleware/authenticate';
import { valid, validate } from '../../middleware/validate';
import { emitToRole, emitToUsers, isOnline } from '../../sockets/io';
import type { AuthUser } from '../../types/express';
import { AppError } from '../../utils/AppError';
import { escapeRegex, ok } from '../../utils/http';
import { assertOwnAttachments } from '../files/files.service';
import { FileModel } from '../files/file.model';
import { Message } from '../messages/message.model';
import { notify, notifyAdmins } from '../notifications/notification.service';
import { Project } from '../projects/project.model';
import { User } from '../users/user.model';
import { Conversation } from './conversation.model';

/**
 * Threads are always between one partner/client and the Innovexa admin team.
 * Partners and clients can never see each other's threads.
 */
function scope(user: AuthUser) {
  return user.role === Role.ADMIN ? {} : { userId: user._id };
}

async function load(user: AuthUser, id: string) {
  const conv = await Conversation.findOne({ _id: id, ...scope(user) });
  if (!conv) throw AppError.notFound('Conversation');
  return conv;
}

async function unreadCounts(user: AuthUser, conversationIds: Types.ObjectId[]) {
  const rows = await Message.aggregate<{ _id: Types.ObjectId; n: number }>([
    {
      $match: {
        conversationId: { $in: conversationIds },
        senderId: { $ne: user._id },
        'readBy.userId': { $ne: user._id },
        deletedAt: null,
      },
    },
    { $group: { _id: '$conversationId', n: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [r._id.toString(), r.n]));
}

function conversationView(
  c: Record<string, unknown> & { _id: Types.ObjectId; userId: unknown },
  unread = 0,
) {
  const counterpart = c.userId as { _id?: Types.ObjectId } | undefined;
  return {
    id: c._id.toString(),
    type: c.type,
    audience: c.audience,
    title: c.title,
    user: c.userId,
    project: c.projectId,
    lastMessageAt: c.lastMessageAt,
    lastMessagePreview: c.lastMessagePreview,
    unread,
    online: counterpart?._id ? isOnline(counterpart._id.toString()) : false,
    createdAt: c.createdAt,
  };
}

async function messageView(
  m: Record<string, unknown> & { _id: Types.ObjectId; attachmentIds: Types.ObjectId[] },
) {
  const files = m.attachmentIds.length
    ? await FileModel.find({ _id: { $in: m.attachmentIds } })
        .select('originalName size mimeType')
        .lean()
    : [];
  return {
    id: m._id.toString(),
    conversationId: String(m.conversationId),
    sender: m.senderId,
    body: m.body,
    attachments: files.map((f) => ({
      id: f._id.toString(),
      name: f.originalName,
      size: f.size,
      url: `/api/v1/files/${f._id.toString()}/download`,
    })),
    readBy: m.readBy,
    createdAt: m.createdAt,
  };
}

type Audience = typeof Role.PARTNER | typeof Role.CLIENT;

export const conversationsRouter = Router();
conversationsRouter.use(authenticate);

conversationsRouter.get(
  '/',
  validate({
    query: z.object({
      q: z.string().trim().max(100).optional(),
      audience: z.enum([Role.PARTNER, Role.CLIENT]).optional(),
    }),
  }),
  async (req, res) => {
    const user = currentUser(req);
    const q = valid<{ q?: string; audience?: Role }>(req, 'query');
    const filter: Record<string, unknown> = { ...scope(user) };
    if (user.role === Role.ADMIN && q.audience) filter.audience = q.audience;
    if (user.role === Role.ADMIN && q.q) {
      const rx = new RegExp(escapeRegex(q.q), 'i');
      const users = await User.find({ $or: [{ name: rx }, { email: rx }] })
        .select('_id')
        .limit(100)
        .lean();
      filter.userId = { $in: users.map((u) => u._id) };
    }
    const items = await Conversation.find(filter)
      .sort({ lastMessageAt: -1, createdAt: -1 })
      .limit(200)
      .populate('userId', 'name email role')
      .populate('projectId', 'title projectCode')
      .lean();
    const unread = await unreadCounts(
      user,
      items.map((i) => i._id),
    );
    ok(
      res,
      items.map((c) => conversationView(c, unread.get(c._id.toString()) ?? 0)),
    );
  },
);

conversationsRouter.get('/unread-count', async (req, res) => {
  const user = currentUser(req);
  const ids = (await Conversation.find(scope(user)).select('_id').lean()).map((c) => c._id);
  const counts = await unreadCounts(user, ids);
  ok(res, { unread: [...counts.values()].reduce((s, n) => s + n, 0) });
});

conversationsRouter.post('/', validate({ body: createConversationSchema }), async (req, res) => {
  const user = currentUser(req);
  const input = valid<CreateConversationInput>(req, 'body');
  let counterpartId: Types.ObjectId;
  let audience: Audience;
  if (user.role === Role.ADMIN) {
    if (!input.userId) throw AppError.badRequest('Choose who to message');
    const other = await User.findOne({
      _id: input.userId,
      role: { $in: [Role.PARTNER, Role.CLIENT] },
      status: { $ne: UserStatus.INACTIVE },
      deletedAt: null,
    }).lean();
    if (!other) throw AppError.badRequest('You can message active partners and client users');
    counterpartId = other._id;
    audience = other.role as Audience;
    if (input.projectId) {
      const allowed =
        audience === Role.PARTNER
          ? await Project.exists({ _id: input.projectId, partnerIds: other._id })
          : await Project.exists({ _id: input.projectId, clientId: other.clientId ?? null });
      if (!allowed) throw AppError.badRequest('That project is not linked to this person');
    }
  } else {
    counterpartId = user._id;
    audience = user.role as Audience;
    if (input.projectId) {
      const allowed =
        user.role === Role.PARTNER
          ? await Project.exists({ _id: input.projectId, partnerIds: user._id })
          : await Project.exists({ _id: input.projectId, clientId: user.clientId ?? null });
      if (!allowed) throw AppError.notFound('Project');
    }
  }
  const projectId = input.projectId ? new Types.ObjectId(input.projectId) : undefined;
  const existing = await Conversation.findOne({
    userId: counterpartId,
    projectId: projectId ?? null,
  });
  const conv =
    existing ??
    (await Conversation.create({
      type: projectId ? ConversationType.PROJECT : ConversationType.DIRECT,
      userId: counterpartId,
      participantIds: [counterpartId],
      projectId,
      audience,
      title: input.title,
      createdBy: user._id,
    }));
  await conv.populate([
    { path: 'userId', select: 'name email role' },
    { path: 'projectId', select: 'title projectCode' },
  ]);
  ok(res, conversationView(conv.toObject()), existing ? 200 : 201);
});

conversationsRouter.get(
  '/:id/messages',
  validate({ params: idParamSchema, query: listMessagesQuerySchema }),
  async (req, res) => {
    const user = currentUser(req);
    const conv = await load(user, valid<{ id: string }>(req, 'params').id);
    const q = valid<{ before?: Date; limit: number }>(req, 'query');
    const items = await Message.find({
      conversationId: conv._id,
      deletedAt: null,
      ...(q.before ? { createdAt: { $lt: q.before } } : {}),
    })
      .sort({ createdAt: -1 })
      .limit(q.limit)
      .populate('senderId', 'name role')
      .lean();
    ok(res, await Promise.all(items.reverse().map(messageView)));
  },
);

conversationsRouter.post(
  '/:id/messages',
  validate({ params: idParamSchema, body: sendMessageSchema }),
  async (req, res) => {
    const user = currentUser(req);
    const conv = await load(user, valid<{ id: string }>(req, 'params').id);
    const input = valid<SendMessageInput>(req, 'body');
    await assertOwnAttachments(user, input.attachmentIds, FileScope.CONVERSATION, conv._id);
    const message = await Message.create({
      conversationId: conv._id,
      senderId: user._id,
      body: input.body,
      attachmentIds: input.attachmentIds,
      readBy: [{ userId: user._id, at: new Date() }],
    });
    conv.lastMessageAt = message.createdAt;
    conv.lastMessagePreview = (
      input.body || `📎 ${input.attachmentIds.length} attachment(s)`
    ).slice(0, 140);
    if (!conv.participantIds.some((p) => p.equals(user._id))) conv.participantIds.push(user._id);
    await conv.save();
    await message.populate('senderId', 'name role');
    const view = await messageView(message.toObject());

    emitToUsers([conv.userId.toString()], 'message:new', view);
    emitToRole(Role.ADMIN, 'message:new', view);

    const preview = conv.lastMessagePreview;
    if (user.role === Role.ADMIN) {
      const role = conv.audience === Role.PARTNER ? 'partner' : 'client';
      await notify({
        recipients: [conv.userId],
        type: NotificationType.NEW_MESSAGE,
        title: `New message from ${user.name}`,
        body: preview,
        link: `/${role}/messages?c=${conv._id.toString()}`,
        exclude: user._id,
      });
    } else {
      await notifyAdmins({
        type: NotificationType.NEW_MESSAGE,
        title: `New message from ${user.name}`,
        body: preview,
        link: `/admin/messages?c=${conv._id.toString()}`,
      });
    }
    ok(res, view, 201);
  },
);

conversationsRouter.post('/:id/read', validate({ params: idParamSchema }), async (req, res) => {
  const user = currentUser(req);
  const conv = await load(user, valid<{ id: string }>(req, 'params').id);
  const now = new Date();
  const result = await Message.updateMany(
    { conversationId: conv._id, 'readBy.userId': { $ne: user._id } },
    { $push: { readBy: { userId: user._id, at: now } } },
  );
  if (result.modifiedCount) {
    const payload = { conversationId: conv._id.toString(), userId: user.id, at: now };
    emitToUsers([conv.userId.toString()], 'message:read', payload);
    emitToRole(Role.ADMIN, 'message:read', payload);
  }
  ok(res, { updated: result.modifiedCount });
});
