import type { Request } from 'express';
import type { Types } from 'mongoose';
import type { ListAuditLogsQuery } from '@innovexa/shared';
import { logger } from '../../utils/logger';
import { pageMeta } from '../../utils/http';
import { AuditLog } from './auditLog.model';

const SENSITIVE_KEYS = new Set([
  'passwordHash',
  'password',
  'tokenHash',
  'failedLoginAttempts',
  'lockUntil',
  '__v',
]);

/** Deep-copies a value for storage, dropping secrets. */
function scrub(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'object' && 'toObject' in value && typeof value.toObject === 'function') {
    return scrub(value.toObject());
  }
  if (Array.isArray(value)) return value.map(scrub);
  if (
    value instanceof Date ||
    (typeof value === 'object' && value.constructor?.name === 'ObjectId')
  )
    return value;
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([k]) => !SENSITIVE_KEYS.has(k))
        .map(([k, v]) => [k, scrub(v)]),
    );
  }
  return value;
}

export interface AuditEntry {
  req?: Request;
  actor?: { _id: Types.ObjectId; role: string } | null;
  action: string;
  entity: string;
  entityId?: Types.ObjectId | null;
  before?: unknown;
  after?: unknown;
}

/**
 * Records an audit entry. Failures are logged but never break the business
 * operation that has already been committed.
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  const actor = entry.actor ?? entry.req?.user ?? null;
  try {
    await AuditLog.create({
      actorId: actor?._id ?? null,
      actorRole: actor?.role ?? 'SYSTEM',
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      before: scrub(entry.before),
      after: scrub(entry.after),
      ip: entry.req?.ip,
      userAgent: entry.req?.get('user-agent')?.slice(0, 300),
    });
  } catch (err) {
    logger.error({ err, action: entry.action }, 'Failed to write audit log');
  }
}

export async function listAuditLogs(q: ListAuditLogsQuery) {
  const filter: Record<string, unknown> = {};
  if (q.actorId) filter.actorId = q.actorId;
  if (q.entity) filter.entity = q.entity;
  if (q.entityId) filter.entityId = q.entityId;
  if (q.action) filter.action = q.action;
  if (q.from || q.to) {
    filter.createdAt = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
  }
  const [items, total] = await Promise.all([
    AuditLog.find(filter)
      .sort({ createdAt: -1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .populate('actorId', 'name email role')
      .lean(),
    AuditLog.countDocuments(filter),
  ]);
  return { items, meta: pageMeta(q.page, q.limit, total) };
}
