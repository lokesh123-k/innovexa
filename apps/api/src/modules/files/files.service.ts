import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import type { Types } from 'mongoose';
import { FileScope, FileVisibility, Role } from '@innovexa/shared';
import type { AuthUser } from '../../types/express';
import { loadProjectFor } from '../../utils/access';
import { AppError } from '../../utils/AppError';
import { ChangeRequest } from '../change-requests/changeRequest.model';
import { Conversation } from '../conversations/conversation.model';
import { Project } from '../projects/project.model';
import { WorkReport } from '../reports/workReport.model';
import { Task } from '../tasks/task.model';
import { FileModel } from './file.model';
import { storage } from './storage';

/** Allowed upload types. SVG/HTML are excluded because they can carry scripts. */
const ALLOWED: Record<string, string[]> = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/gif': ['.gif'],
  'image/webp': ['.webp'],
  'application/pdf': ['.pdf'],
  'text/plain': ['.txt'],
  'text/csv': ['.csv'],
  'application/zip': ['.zip'],
  'application/x-zip-compressed': ['.zip'],
  'application/msword': ['.doc'],
  'application/vnd.ms-excel': ['.xls'],
  'application/vnd.ms-powerpoint': ['.ppt'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
};

export const UPLOADABLE_SCOPES = [
  FileScope.PROJECT,
  FileScope.TASK,
  FileScope.CHANGE_REQUEST,
  FileScope.CONVERSATION,
  FileScope.WORK_REPORT,
] as const;
type UploadScope = (typeof UPLOADABLE_SCOPES)[number];

interface UploadInput {
  kind: UploadScope;
  refId: string;
  visibility?: FileVisibility;
  file: { originalname: string; mimetype: string; size: number; buffer: Buffer };
}

/** Throws unless `user` may attach files to the given parent record. Returns a linker, if any. */
async function authorizeParent(user: AuthUser, kind: UploadScope, refId: string) {
  switch (kind) {
    case FileScope.PROJECT: {
      if (user.role !== Role.ADMIN) throw AppError.forbidden('Only admins can add project files');
      await loadProjectFor(user, refId);
      return (fileId: Types.ObjectId) =>
        Project.updateOne({ _id: refId }, { $push: { attachmentIds: fileId } });
    }
    case FileScope.TASK: {
      if (user.role === Role.CLIENT) throw AppError.forbidden();
      const task = await Task.findOne({
        _id: refId,
        ...(user.role === Role.PARTNER ? { assigneeIds: user._id } : {}),
      });
      if (!task) throw AppError.notFound('Task');
      // Admin uploads become task reference material; partner uploads are linked by their update/submission.
      return user.role === Role.ADMIN
        ? (fileId: Types.ObjectId) =>
            Task.updateOne({ _id: refId }, { $push: { attachmentIds: fileId } })
        : undefined;
    }
    case FileScope.CHANGE_REQUEST: {
      const cr = await ChangeRequest.findById(refId);
      if (!cr) throw AppError.notFound('Change request');
      if (user.role === Role.PARTNER) throw AppError.forbidden();
      if (user.role === Role.CLIENT && !cr.clientId.equals(user.clientId ?? undefined))
        throw AppError.notFound('Change request');
      return (fileId: Types.ObjectId) =>
        ChangeRequest.updateOne({ _id: refId }, { $push: { attachmentIds: fileId } });
    }
    case FileScope.CONVERSATION: {
      const conv = await Conversation.findById(refId);
      if (!conv || (user.role !== Role.ADMIN && !conv.userId.equals(user._id)))
        throw AppError.notFound('Conversation');
      return undefined; // linked when the message is sent
    }
    case FileScope.WORK_REPORT: {
      const report = await WorkReport.findOne({ _id: refId, partnerId: user._id });
      if (!report) throw AppError.notFound('Work report');
      return (fileId: Types.ObjectId) =>
        WorkReport.updateOne({ _id: refId }, { $push: { attachmentIds: fileId } });
    }
  }
}

export async function uploadFile(user: AuthUser, input: UploadInput) {
  const ext = extname(input.file.originalname).toLowerCase();
  const allowedExts = ALLOWED[input.file.mimetype];
  if (!allowedExts || !allowedExts.includes(ext)) {
    throw AppError.badRequest(
      'This file type is not allowed. Use images, PDF, Office documents, text, CSV or ZIP.',
    );
  }
  const link = await authorizeParent(user, input.kind, input.refId);
  const visibility =
    user.role === Role.ADMIN && input.kind === FileScope.PROJECT && input.visibility
      ? input.visibility
      : // Client-originated files are visible to that client; everything else starts internal.
        user.role === Role.CLIENT
        ? FileVisibility.CLIENT
        : FileVisibility.INTERNAL;

  const key = `${input.kind.toLowerCase()}/${new Date().getUTCFullYear()}/${randomUUID()}${ext}`;
  const store = storage();
  await store.put(key, input.file.buffer);
  const doc = await FileModel.create({
    ownerId: user._id,
    storage: store.name,
    key,
    originalName: input.file.originalname.slice(0, 200),
    mimeType: input.file.mimetype,
    size: input.file.size,
    scope: { kind: input.kind, refId: input.refId },
    visibility,
  });
  await link?.(doc._id);
  return doc;
}

/** Whether `user` may download `file`, decided by the record it belongs to. */
export async function canAccessFile(
  user: AuthUser,
  file: {
    ownerId: Types.ObjectId;
    visibility: string;
    scope: { kind: string; refId: Types.ObjectId };
  },
): Promise<boolean> {
  if (user.role === Role.ADMIN || file.ownerId.equals(user._id)) return true;
  const { kind, refId } = file.scope;
  switch (kind) {
    case FileScope.PROJECT: {
      const p = await Project.findById(refId).select('clientId partnerIds').lean();
      if (!p) return false;
      if (user.role === Role.PARTNER) return p.partnerIds.some((id) => id.equals(user._id));
      return (
        file.visibility === FileVisibility.CLIENT &&
        !!user.clientId &&
        p.clientId.equals(user.clientId)
      );
    }
    case FileScope.TASK:
      return (
        user.role === Role.PARTNER && !!(await Task.exists({ _id: refId, assigneeIds: user._id }))
      );
    case FileScope.CHANGE_REQUEST:
      return (
        user.role === Role.CLIENT &&
        !!user.clientId &&
        !!(await ChangeRequest.exists({ _id: refId, clientId: user.clientId }))
      );
    case FileScope.CONVERSATION:
      return !!(await Conversation.exists({ _id: refId, userId: user._id }));
    default:
      return false;
  }
}

export async function getFileForDownload(user: AuthUser, id: string) {
  const file = await FileModel.findOne({ _id: id, deletedAt: null }).lean();
  if (!file || !(await canAccessFile(user, file))) throw AppError.notFound('File');
  return { file, stream: storage().read(file.key) };
}

/** Verifies attachment ids belong to the caller and to the given parent, before linking them. */
export async function assertOwnAttachments(
  user: AuthUser,
  ids: readonly string[],
  kind: UploadScope,
  refId: Types.ObjectId | string,
) {
  if (ids.length === 0) return [];
  const count = await FileModel.countDocuments({
    _id: { $in: ids },
    ownerId: user._id,
    'scope.kind': kind,
    'scope.refId': refId,
    deletedAt: null,
  });
  if (count !== new Set(ids).size) throw AppError.badRequest('One or more attachments are invalid');
  return ids;
}

/** Admin: share a project or task file with the client as a deliverable. */
export async function publishToClient(user: AuthUser, id: string, published: boolean) {
  const file = await FileModel.findOne({ _id: id, deletedAt: null });
  if (!file) throw AppError.notFound('File');
  if (file.scope.kind === FileScope.TASK && published) {
    const task = await Task.findById(file.scope.refId).select('projectId').lean();
    if (!task) throw AppError.notFound('Task');
    file.scope = { kind: FileScope.PROJECT, refId: task.projectId };
    await Project.updateOne({ _id: task.projectId }, { $addToSet: { attachmentIds: file._id } });
  } else if (file.scope.kind !== FileScope.PROJECT) {
    throw AppError.badRequest('Only project and task files can be shared with clients');
  }
  file.visibility = published ? FileVisibility.CLIENT : FileVisibility.INTERNAL;
  await file.save();
  return file;
}

export async function listFiles(user: AuthUser, kind: UploadScope, refId: string) {
  // Re-use parent authorisation for listing.
  await authorizeParentForRead(user, kind, refId);
  const filter: Record<string, unknown> = {
    'scope.kind': kind,
    'scope.refId': refId,
    deletedAt: null,
  };
  if (user.role === Role.CLIENT && kind === FileScope.PROJECT)
    filter.visibility = FileVisibility.CLIENT;
  return FileModel.find(filter).sort({ createdAt: -1 }).populate('ownerId', 'name role').lean();
}

async function authorizeParentForRead(user: AuthUser, kind: UploadScope, refId: string) {
  if (user.role === Role.ADMIN) return;
  switch (kind) {
    case FileScope.PROJECT:
      await loadProjectFor(user, refId);
      return;
    case FileScope.TASK:
      if (user.role !== Role.PARTNER || !(await Task.exists({ _id: refId, assigneeIds: user._id })))
        throw AppError.notFound('Task');
      return;
    default:
      throw AppError.forbidden();
  }
}

export const toFileDTO = (f: {
  _id: Types.ObjectId;
  originalName: string;
  mimeType: string;
  size: number;
  visibility: string;
  createdAt?: Date;
  scope: { kind: string; refId: Types.ObjectId };
  ownerId?: unknown;
}) => ({
  id: f._id.toString(),
  name: f.originalName,
  mimeType: f.mimeType,
  size: f.size,
  visibility: f.visibility,
  scope: { kind: f.scope.kind, refId: f.scope.refId.toString() },
  owner: f.ownerId,
  createdAt: f.createdAt,
  url: `/api/v1/files/${f._id.toString()}/download`,
});
