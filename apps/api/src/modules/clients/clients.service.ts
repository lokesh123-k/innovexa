import type { Request } from 'express';
import type { Types } from 'mongoose';
import {
  ClientAssignmentStatus,
  ClientStatus,
  Role,
  UserStatus,
  type CreateClientInput,
  type InviteClientUserInput,
  type ListClientsQuery,
  type UpdateClientInput,
} from '@innovexa/shared';
import type { AuthUser } from '../../types/express.js';
import { AppError } from '../../utils/AppError.js';
import { escapeRegex, pageMeta } from '../../utils/http.js';
import { formatCode, nextSequence } from '../../utils/sequence.js';
import { recordAudit } from '../audit-logs/auditLog.service.js';
import { revokeAllSessions } from '../auth/auth.service.js';
import { billingTotals, listInvoices, upcomingInstallments } from '../invoices/billing.service.js';
import { Invoice } from '../invoices/invoice.model.js';
import { Project } from '../projects/project.model.js';
import { listProjects } from '../projects/projects.service.js';
import { User } from '../users/user.model.js';
import { toUserDTO } from '../users/user.serializer.js';
import { inviteUser } from '../users/users.service.js';
import { Client } from './client.model.js';

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
  const [projects, balances, logins, people] = await Promise.all([
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
    peopleFor(items.map((c) => c.partnerAssignment as StoredAssignment)),
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
      assignment: assignmentView(c.partnerAssignment as StoredAssignment, people),
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
  const [users, projects, invoices, totals, upcoming, assignment] = await Promise.all([
    User.find({ clientId: client._id, role: Role.CLIENT, deletedAt: null }).lean(),
    listProjects(admin, { page: 1, limit: 100, clientId: id }),
    listInvoices(admin, { page: 1, limit: 100, clientId: id }),
    billingTotals({ clientId: client._id }),
    upcomingInstallments({ clientId: client._id }, 90, 20),
    getAssignment(id),
  ]);
  return {
    ...clientView(client.toObject()),
    assignment,
    logins: users.map((u) => toUserDTO(u, Role.ADMIN)),
    projects: projects.items,
    invoices: invoices.items,
    totals,
    upcomingInstallments: upcoming,
  };
}

// ---- Account partner assignment -------------------------------------------------------------

type StoredAssignment =
  | {
      partnerId: Types.ObjectId;
      status: string;
      assignedBy: Types.ObjectId;
      assignedAt: Date;
      updatedAt: Date;
    }
  | null
  | undefined;
type PartnerLite = { _id: unknown; name: string; email: string; status: string };

const PARTNER_FIELDS = 'name email status';

/** Loads the partners and assigning admins referenced by these assignments, in one query. */
async function peopleFor(assignments: StoredAssignment[]) {
  const ids = assignments.flatMap((a) => (a ? [a.partnerId, a.assignedBy] : []));
  const people = ids.length
    ? await User.find({ _id: { $in: ids } })
        .select(PARTNER_FIELDS)
        .lean<PartnerLite[]>()
    : [];
  return new Map(people.map((p) => [String(p._id), p]));
}

/** Public shape of an assignment. Partner details are limited to name, email and status. */
export function assignmentView(
  a: StoredAssignment,
  people: Map<string, PartnerLite>,
  { includeAdmin = true } = {},
) {
  if (!a?.partnerId) return { status: ClientAssignmentStatus.UNASSIGNED, partner: null };
  const p = people.get(String(a.partnerId));
  const by = people.get(String(a.assignedBy));
  return {
    status: a.status,
    partner: p ? { id: String(p._id), name: p.name, email: p.email, status: p.status } : null,
    assignedAt: a.assignedAt,
    updatedAt: a.updatedAt,
    ...(includeAdmin && by ? { assignedBy: { id: String(by._id), name: by.name } } : {}),
  };
}

/** Active partners an admin may assign (inactive, invited and deleted partners are excluded). */
export async function listAssignablePartners() {
  const partners = await User.find({
    role: Role.PARTNER,
    status: UserStatus.ACTIVE,
    deletedAt: null,
  })
    .select('name email status partnerProfile.partnerType partnerProfile.category')
    .sort({ name: 1 })
    .limit(500)
    .lean();
  return partners.map((p) => ({
    id: String(p._id),
    name: p.name,
    email: p.email,
    status: p.status,
    partnerType: p.partnerProfile?.partnerType,
    category: p.partnerProfile?.category,
  }));
}

export async function getAssignment(id: string) {
  const client = await loadClient(id);
  const a = client.partnerAssignment as StoredAssignment;
  return assignmentView(a, await peopleFor([a]));
}

/**
 * Assigns or changes the client's partner. Only an existing, active partner is accepted.
 * Projects and tasks are deliberately left untouched: their partners are managed per project.
 */
export async function assignPartner(req: Request, id: string, partnerId: string) {
  const client = await loadClient(id);
  const partner = await User.findOne({ _id: partnerId, role: Role.PARTNER, deletedAt: null })
    .select(PARTNER_FIELDS)
    .lean();
  if (!partner) throw AppError.notFound('Partner');
  if (partner.status !== UserStatus.ACTIVE) {
    throw new AppError(400, 'PARTNER_INACTIVE', 'Only active partners can be assigned to a client');
  }
  const before = client.partnerAssignment as StoredAssignment;
  if (before && String(before.partnerId) === partnerId) return getAssignment(id); // no change
  const now = new Date();
  client.set('partnerAssignment', {
    partnerId: partner._id,
    status: ClientAssignmentStatus.ASSIGNED,
    assignedBy: req.user!._id,
    assignedAt: now,
    updatedAt: now,
  });
  await client.save();
  await recordAudit({
    req,
    action: before ? 'client.partner_changed' : 'client.partner_assigned',
    entity: 'Client',
    entityId: client._id,
    before: before ? { partnerId: before.partnerId } : null,
    after: { partnerId: partner._id },
  });
  return getAssignment(id);
}

export async function removeAssignment(req: Request, id: string) {
  const client = await loadClient(id);
  const before = client.partnerAssignment as StoredAssignment;
  if (!before) return assignmentView(null, new Map());
  client.set('partnerAssignment', undefined);
  await client.save();
  await recordAudit({
    req,
    action: 'client.partner_unassigned',
    entity: 'Client',
    entityId: client._id,
    before: { partnerId: before.partnerId },
    after: null,
  });
  return assignmentView(null, new Map());
}

/** Client portal: the signed-in client's partner, read-only (no admin details). */
export async function getOwnAssignment(user: AuthUser) {
  if (!user.clientId) throw AppError.notFound('Client');
  const client = await Client.findById(user.clientId).select('partnerAssignment').lean();
  if (!client) throw AppError.notFound('Client');
  const a = client.partnerAssignment as StoredAssignment;
  return assignmentView(a, await peopleFor([a]), { includeAdmin: false });
}

/**
 * Partner portal: only the clients assigned to this partner, and of their projects only the
 * ones this partner is actually on (project access is unchanged by the client assignment).
 */
export async function listAssignedClients(user: AuthUser) {
  const clients = await Client.find({ 'partnerAssignment.partnerId': user._id, archivedAt: null })
    .sort({ companyName: 1 })
    .lean();
  const projects = clients.length
    ? await Project.find({
        clientId: { $in: clients.map((c) => c._id) },
        partnerIds: user._id,
        archivedAt: null,
      })
        .select('title projectCode status clientId')
        .sort({ createdAt: -1 })
        .lean()
    : [];
  return clients.map((c) => ({
    id: String(c._id),
    clientCode: c.clientCode,
    companyName: c.companyName,
    contactName: c.contactName,
    email: c.email,
    phone: c.phone,
    status: c.status,
    assignedAt: c.partnerAssignment?.assignedAt,
    projects: projects
      .filter((p) => String(p.clientId) === String(c._id))
      .map((p) => ({
        id: String(p._id),
        title: p.title,
        projectCode: p.projectCode,
        status: p.status,
      })),
  }));
}

/** The signed-in client's own company profile (no internal notes). */
export async function getOwnClient(user: AuthUser) {
  if (!user.clientId) throw AppError.notFound('Client');
  const client = await Client.findById(user.clientId).lean();
  if (!client) throw AppError.notFound('Client');
  return clientView(client, false);
}
