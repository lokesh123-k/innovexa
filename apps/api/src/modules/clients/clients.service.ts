import type { Request } from 'express';
import {
  ClientStatus,
  Role,
  UserStatus,
  type CreateClientInput,
  type InviteClientUserInput,
  type ListClientsQuery,
  type UpdateClientInput,
} from '@innovexa/shared';
import type { AuthUser } from '../../types/express';
import { AppError } from '../../utils/AppError';
import { escapeRegex, pageMeta } from '../../utils/http';
import { formatCode, nextSequence } from '../../utils/sequence';
import { recordAudit } from '../audit-logs/auditLog.service';
import { revokeAllSessions } from '../auth/auth.service';
import { billingTotals, listInvoices, upcomingInstallments } from '../invoices/billing.service';
import { Invoice } from '../invoices/invoice.model';
import { Project } from '../projects/project.model';
import { listProjects } from '../projects/projects.service';
import { User } from '../users/user.model';
import { toUserDTO } from '../users/user.serializer';
import { inviteUser } from '../users/users.service';
import { Client } from './client.model';

async function loadClient(id: string) {
  const client = await Client.findOne({ _id: id, archivedAt: null });
  if (!client) throw AppError.notFound('Client');
  return client;
}

export async function listClients(q: ListClientsQuery) {
  const filter: Record<string, unknown> = { archivedAt: null };
  if (q.status) filter.status = q.status;
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    filter.$or = [{ companyName: rx }, { contactName: rx }, { email: rx }, { clientCode: rx }];
  }
  const [items, total] = await Promise.all([
    Client.find(filter)
      .sort({ createdAt: -1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .lean(),
    Client.countDocuments(filter),
  ]);
  const ids = items.map((c) => c._id);
  const [projects, balances, logins] = await Promise.all([
    Project.aggregate<{ _id: unknown; total: number; active: number }>([
      { $match: { clientId: { $in: ids }, archivedAt: null } },
      {
        $group: {
          _id: '$clientId',
          total: { $sum: 1 },
          active: { $sum: { $cond: [{ $eq: ['$status', 'ACTIVE'] }, 1, 0] } },
        },
      },
    ]),
    Invoice.aggregate<{ _id: unknown; balance: number; invoiced: number }>([
      { $match: { clientId: { $in: ids }, status: { $nin: ['DRAFT', 'CANCELLED'] } } },
      {
        $group: {
          _id: '$clientId',
          balance: { $sum: '$balanceMinor' },
          invoiced: { $sum: '$totalMinor' },
        },
      },
    ]),
    User.aggregate<{ _id: unknown; count: number }>([
      { $match: { clientId: { $in: ids }, role: Role.CLIENT, deletedAt: null } },
      { $group: { _id: '$clientId', count: { $sum: 1 } } },
    ]),
  ]);
  const key = (v: unknown) => String(v);
  const pMap = new Map(projects.map((p) => [key(p._id), p]));
  const bMap = new Map(balances.map((b) => [key(b._id), b]));
  const lMap = new Map(logins.map((l) => [key(l._id), l.count]));
  return {
    items: items.map((c) => ({
      ...clientView(c),
      projectCount: pMap.get(key(c._id))?.total ?? 0,
      activeProjects: pMap.get(key(c._id))?.active ?? 0,
      invoicedMinor: bMap.get(key(c._id))?.invoiced ?? 0,
      outstandingMinor: bMap.get(key(c._id))?.balance ?? 0,
      loginCount: lMap.get(key(c._id)) ?? 0,
    })),
    meta: pageMeta(q.page, q.limit, total),
  };
}

export function clientView(c: Record<string, unknown> & { _id: unknown }, includeNotes = true) {
  return {
    id: String(c._id),
    clientCode: c.clientCode,
    companyName: c.companyName,
    contactName: c.contactName,
    email: c.email,
    phone: c.phone,
    address: c.address,
    gstin: c.gstin,
    status: c.status,
    ...(includeNotes ? { notes: c.notes } : {}),
    createdAt: c.createdAt,
  };
}

export async function createClient(req: Request, input: CreateClientInput) {
  const client = await Client.create({
    ...input,
    clientCode: formatCode('CLI', await nextSequence('client')),
    createdBy: req.user!._id,
  });
  await recordAudit({
    req,
    action: 'client.created',
    entity: 'Client',
    entityId: client._id,
    after: client,
  });
  return client;
}

export async function updateClient(req: Request, id: string, input: UpdateClientInput) {
  const client = await loadClient(id);
  const before = client.toObject();
  client.set(input);
  await client.save();
  await recordAudit({
    req,
    action: 'client.updated',
    entity: 'Client',
    entityId: client._id,
    before,
    after: client,
  });
  return client;
}

/** Deactivating a client also deactivates and signs out its portal logins. */
export async function setClientStatus(req: Request, id: string, status: ClientStatus) {
  const client = await loadClient(id);
  if (client.status === status) return client;
  const before = client.status;
  client.status = status;
  await client.save();
  if (status === ClientStatus.INACTIVE) {
    const users = await User.find({
      clientId: client._id,
      role: Role.CLIENT,
      status: UserStatus.ACTIVE,
    });
    for (const u of users) {
      u.status = UserStatus.INACTIVE;
      u.tokenVersion += 1;
      await u.save();
      await revokeAllSessions(u._id);
    }
  } else {
    await User.updateMany(
      { clientId: client._id, role: Role.CLIENT, status: UserStatus.INACTIVE },
      { $set: { status: UserStatus.ACTIVE } },
    );
  }
  await recordAudit({
    req,
    action: `client.${status === ClientStatus.ACTIVE ? 'activated' : 'deactivated'}`,
    entity: 'Client',
    entityId: client._id,
    before: { status: before },
    after: { status },
  });
  return client;
}

export async function inviteClientLogin(req: Request, id: string, input: InviteClientUserInput) {
  const client = await loadClient(id);
  if (client.status !== ClientStatus.ACTIVE)
    throw AppError.badRequest('Activate the client before creating logins');
  return inviteUser(req, { ...input, role: Role.CLIENT, clientId: client._id.toString() });
}

/** Admin 360° view: contact details, logins, projects, invoices and balances. */
export async function getClientDetail(admin: AuthUser, id: string) {
  const client = await loadClient(id);
  const [users, projects, invoices, totals, upcoming] = await Promise.all([
    User.find({ clientId: client._id, role: Role.CLIENT, deletedAt: null }).lean(),
    listProjects(admin, { page: 1, limit: 100, clientId: id }),
    listInvoices(admin, { page: 1, limit: 100, clientId: id }),
    billingTotals({ clientId: client._id }),
    upcomingInstallments({ clientId: client._id }, 90, 20),
  ]);
  return {
    ...clientView(client.toObject()),
    logins: users.map((u) => toUserDTO(u, Role.ADMIN)),
    projects: projects.items,
    invoices: invoices.items,
    totals,
    upcomingInstallments: upcoming,
  };
}

/** The signed-in client's own company profile (no internal notes). */
export async function getOwnClient(user: AuthUser) {
  if (!user.clientId) throw AppError.notFound('Client');
  const client = await Client.findById(user.clientId).lean();
  if (!client) throw AppError.notFound('Client');
  return clientView(client, false);
}
