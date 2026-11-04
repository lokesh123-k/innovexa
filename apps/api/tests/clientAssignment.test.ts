import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { Role, UserStatus } from '@innovexa/shared';
import { AuditLog, Client, Project, Task } from '../src/models';
import { ensureDefaultCategories } from '../src/modules/service-categories/serviceCategories.routes';
import { API, PASSWORD, app, createClientRecord, createUser, loginAs } from './helpers';

const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

/** Signs in as an existing account and returns a cookie-carrying agent. */
async function signIn(email: string) {
  const agent = request.agent(app);
  await agent.post(`${API}/auth/login`).send({ email, password: PASSWORD }).expect(200);
  return agent;
}

async function setup() {
  const { agent: admin, user: adminUser } = await loginAs(Role.ADMIN);
  const client = await createClientRecord('Northwind Traders');
  const partnerA = await createUser(Role.PARTNER, { name: 'Asha Partner' });
  const partnerB = await createUser(Role.PARTNER, { name: 'Bala Partner' });
  return { admin, adminUser, client, partnerA, partnerB };
}

describe('client ↔ partner assignment', () => {
  it('1-5: unassigned → assign → shows in table → change → remove', async () => {
    const { admin, adminUser, client, partnerA, partnerB } = await setup();
    const row = async () =>
      (await admin.get(`${API}/clients`).expect(200)).body.data.find(
        (c: { id: string }) => c.id === String(client._id),
      );

    // 1. Not assigned
    expect((await row()).assignment).toEqual({ status: 'UNASSIGNED', partner: null });
    expect(
      (await admin.get(`${API}/clients/${client._id}/assignment`).expect(200)).body.data,
    ).toEqual({
      status: 'UNASSIGNED',
      partner: null,
    });

    // 2. Only active partners are offered
    await createUser(Role.PARTNER, { status: UserStatus.INACTIVE });
    await createUser(Role.PARTNER, { status: UserStatus.INVITED });
    const offered = (await admin.get(`${API}/clients/assignable-partners`).expect(200)).body.data;
    expect(offered.map((p: { id: string }) => p.id).sort()).toEqual(
      [String(partnerA._id), String(partnerB._id)].sort(),
    );
    const allowed = ['category', 'email', 'id', 'name', 'partnerType', 'status'];
    for (const p of offered) {
      expect(p).toMatchObject({
        name: expect.any(String),
        email: expect.any(String),
        status: 'ACTIVE',
      });
      expect(Object.keys(p).every((k) => allowed.includes(k))).toBe(true); // nothing sensitive leaks
    }

    const assigned = (
      await admin
        .put(`${API}/clients/${client._id}/assignment`)
        .send({ partnerId: String(partnerA._id) })
        .expect(200)
    ).body.data;
    expect(assigned).toMatchObject({
      status: 'ASSIGNED',
      partner: {
        id: String(partnerA._id),
        name: 'Asha Partner',
        email: partnerA.email,
        status: 'ACTIVE',
      },
      assignedBy: { id: String(adminUser._id) },
    });
    expect(assigned.assignedAt).toBeTruthy();

    // 3. Visible in the table row
    expect((await row()).assignment.partner.name).toBe('Asha Partner');

    // Re-assigning the same partner is a no-op (no extra audit entry)
    await admin
      .put(`${API}/clients/${client._id}/assignment`)
      .send({ partnerId: String(partnerA._id) })
      .expect(200);

    // 4. Change
    const changed = (
      await admin
        .put(`${API}/clients/${client._id}/assignment`)
        .send({ partnerId: String(partnerB._id) })
        .expect(200)
    ).body.data;
    expect(changed.partner.name).toBe('Bala Partner');
    expect((await row()).assignment.partner.id).toBe(String(partnerB._id));

    // 5. Remove
    const removed = (await admin.delete(`${API}/clients/${client._id}/assignment`).expect(200)).body
      .data;
    expect(removed).toEqual({ status: 'UNASSIGNED', partner: null });
    expect((await Client.findById(client._id).lean())!.partnerAssignment).toBeUndefined();

    const actions = (
      await AuditLog.find({ entityId: client._id }).sort({ createdAt: 1 }).lean()
    ).map((a) => a.action);
    expect(actions).toEqual([
      'client.partner_assigned',
      'client.partner_changed',
      'client.partner_unassigned',
    ]);
  });

  it('6: rejects inactive, invited, non-partner and nonexistent partners, and bad ids', async () => {
    const { admin, client } = await setup();
    const url = `${API}/clients/${client._id}/assignment`;
    const inactive = await createUser(Role.PARTNER, { status: UserStatus.INACTIVE });
    const invited = await createUser(Role.PARTNER, { status: UserStatus.INVITED });
    const anotherAdmin = await createUser(Role.ADMIN);

    for (const p of [inactive, invited]) {
      const res = await admin.put(url).send({ partnerId: String(p._id) });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PARTNER_INACTIVE');
    }
    expect((await admin.put(url).send({ partnerId: String(anotherAdmin._id) })).status).toBe(404);
    expect((await admin.put(url).send({ partnerId: '0123456789abcdef01234567' })).status).toBe(404);
    expect((await admin.put(url).send({ partnerId: 'not-an-id' })).status).toBe(400);
    expect((await admin.put(url).send({})).status).toBe(400);
    expect((await admin.put(`${API}/clients/not-an-id/assignment`).send({})).status).toBe(400);
    expect(
      (
        await admin
          .put(`${API}/clients/0123456789abcdef01234567/assignment`)
          .send({ partnerId: '0123456789abcdef01234567' })
      ).status,
    ).toBe(404);
    expect((await Client.findById(client._id).lean())!.partnerAssignment).toBeUndefined();
  });

  it('only admins can manage assignments', async () => {
    const { client, partnerA } = await setup();
    const { agent: partner } = await loginAs(Role.PARTNER);
    const { agent: clientUser } = await loginAs(Role.CLIENT, { clientId: client._id });
    for (const agent of [partner, clientUser]) {
      expect((await agent.get(`${API}/clients/assignable-partners`)).status).toBe(403);
      expect((await agent.get(`${API}/clients/${client._id}/assignment`)).status).toBe(403);
      expect(
        (
          await agent
            .put(`${API}/clients/${client._id}/assignment`)
            .send({ partnerId: String(partnerA._id) })
        ).status,
      ).toBe(403);
      expect((await agent.delete(`${API}/clients/${client._id}/assignment`)).status).toBe(403);
    }
  });

  it('7: the client sees its partner read-only, without admin details', async () => {
    const { admin, client, partnerA } = await setup();
    const { agent: clientUser } = await loginAs(Role.CLIENT, { clientId: client._id });
    expect((await clientUser.get(`${API}/clients/me/assignment`).expect(200)).body.data).toEqual({
      status: 'UNASSIGNED',
      partner: null,
    });
    await admin
      .put(`${API}/clients/${client._id}/assignment`)
      .send({ partnerId: String(partnerA._id) })
      .expect(200);
    const mine = (await clientUser.get(`${API}/clients/me/assignment`).expect(200)).body.data;
    expect(mine.partner).toEqual({
      id: String(partnerA._id),
      name: 'Asha Partner',
      email: partnerA.email,
      status: 'ACTIVE',
    });
    expect(mine.assignedBy).toBeUndefined();
  });

  it('8: a partner sees only its own clients, and only the projects it is on', async () => {
    const { admin, client, partnerA, partnerB } = await setup();
    const other = await createClientRecord('Other Co');
    await admin
      .put(`${API}/clients/${client._id}/assignment`)
      .send({ partnerId: String(partnerA._id) })
      .expect(200);
    await admin
      .put(`${API}/clients/${other._id}/assignment`)
      .send({ partnerId: String(partnerB._id) })
      .expect(200);

    await ensureDefaultCategories();
    const categories = (await admin.get(`${API}/service-categories`).expect(200)).body.data;
    const project = async (title: string, partnerIds: string[]) =>
      admin
        .post(`${API}/projects`)
        .send({
          title,
          clientId: String(client._id),
          serviceCategoryId: categories[0]._id,
          contractAmountMinor: 100000,
          startDate: day(0),
          expectedEndDate: day(30),
          partnerIds,
        })
        .expect(201);
    await project('Shared site', [String(partnerA._id)]);
    await project('Someone else only', [String(partnerB._id)]);

    const loginA = await signIn(partnerA.email);
    const { agent: asA } = await loginAs(Role.PARTNER); // a partner with no assigned clients

    const mine = (await loginA.get(`${API}/clients/assigned`).expect(200)).body.data;
    expect(mine.map((c: { companyName: string }) => c.companyName)).toEqual(['Northwind Traders']);
    expect(mine[0].projects.map((p: { title: string }) => p.title)).toEqual(['Shared site']);
    expect(mine[0].notes).toBeUndefined();

    // An unassigned partner sees nothing, and partners cannot use admin client routes.
    expect((await asA.get(`${API}/clients/assigned`).expect(200)).body.data).toEqual([]);
    expect((await loginA.get(`${API}/clients`)).status).toBe(403);
    expect((await loginA.get(`${API}/clients/${other._id}`)).status).toBe(403);
  });

  it('9: assigning or changing the client partner leaves project and task partners untouched', async () => {
    const { admin, client, partnerA, partnerB } = await setup();
    await ensureDefaultCategories();
    const categories = (await admin.get(`${API}/service-categories`).expect(200)).body.data;
    const created = (
      await admin
        .post(`${API}/projects`)
        .send({
          title: 'Brand refresh',
          clientId: String(client._id),
          serviceCategoryId: categories[0]._id,
          contractAmountMinor: 100000,
          startDate: day(0),
          expectedEndDate: day(30),
          partnerIds: [String(partnerA._id)],
        })
        .expect(201)
    ).body.data;
    const task = (
      await admin
        .post(`${API}/tasks`)
        .send({
          projectId: created.id,
          title: 'Logo concepts',
          assigneeIds: [String(partnerA._id)],
          dueDate: day(7),
        })
        .expect(201)
    ).body.data;

    await admin
      .put(`${API}/clients/${client._id}/assignment`)
      .send({ partnerId: String(partnerB._id) })
      .expect(200);
    await admin.delete(`${API}/clients/${client._id}/assignment`).expect(200);

    const p = await Project.findById(created.id).lean();
    expect(p!.partnerIds.map(String)).toEqual([String(partnerA._id)]);
    const t = await Task.findById(task.id ?? task._id).lean();
    expect(t!.assigneeIds.map(String)).toEqual([String(partnerA._id)]);
    // The project's own partner keeps access even though the client is no longer theirs.
    const asA = await signIn(partnerA.email);
    expect((await asA.get(`${API}/projects/${created.id}`)).status).toBe(200);
  });
});
