import type { Types } from 'mongoose';
import { Role } from '@innovexa/shared';
import type { AuthUser } from '../types/express';
import { Project } from '../modules/projects/project.model';
import { Task } from '../modules/tasks/task.model';
import { AppError } from './AppError';

/**
 * Single source of truth for "which records may this user see".
 *
 * - ADMIN: everything.
 * - PARTNER: projects they are allocated to; tasks assigned to them.
 * - CLIENT: their own client's projects (never tasks' internals or other clients).
 *
 * Every filter is derived from the authenticated user, never from request input.
 */
export function projectScope(user: AuthUser): Record<string, unknown> {
  switch (user.role) {
    case Role.ADMIN:
      return { archivedAt: null };
    case Role.PARTNER:
      return { archivedAt: null, partnerIds: user._id };
    case Role.CLIENT:
      // A client user without a linked client must match nothing.
      return { archivedAt: null, clientId: user.clientId ?? null, status: { $ne: 'CANCELLED' } };
  }
}

export function taskScope(user: AuthUser): Record<string, unknown> {
  if (user.role === Role.ADMIN) return {};
  if (user.role === Role.PARTNER) return { assigneeIds: user._id };
  throw AppError.forbidden();
}

/** Loads a project the user may access, or throws 404 (no existence leak). */
export async function loadProjectFor(user: AuthUser, projectId: string | Types.ObjectId) {
  const project = await Project.findOne({ _id: projectId, ...projectScope(user) });
  if (!project) throw AppError.notFound('Project');
  return project;
}

export async function loadTaskFor(user: AuthUser, taskId: string | Types.ObjectId) {
  const task = await Task.findOne({ _id: taskId, ...taskScope(user) });
  if (!task) throw AppError.notFound('Task');
  return task;
}

export function requireRole(user: AuthUser, ...roles: Role[]) {
  if (!roles.includes(user.role)) throw AppError.forbidden();
}
