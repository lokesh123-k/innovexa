import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { Role, UserStatus } from '@innovexa/shared';
import { AuditLog } from '../src/models';
import {
  API,
  PASSWORD,
  app,
  cookieValue,
  createClientRecord,
  createUser,
  loginAs,
} from './helpers';

describe('RBAC on admin endpoints', () => {
  it.each([Role.PARTNER, Role.CLIENT])('%s cannot list, invite or modify users', async (role) => {
    const { agent } = await loginAs(role);
    const other = await createUser(Role.PARTNER);
    expect((await agent.get(`${API}/users`)).status).toBe(403);
    expect((await agent.get(`${API}/users/${other.id}`)).status).toBe(403);
    expect(
      (
        await agent
          .post(`${API}/users/invite`)
          .send({ email: 'z@example.test', name: 'Zed Zed', role: 'ADMIN' })
      ).status,
    ).toBe(403);
    expect(
      (await agent.patch(`${API}/users/${other.id}/status`).send({ status: 'INACTIVE' })).status,
    ).toBe(403);
    expect((await agent.get(`${API}/audit-logs`)).status).toBe(403);
  });

  it('unauthenticated requests are rejected', async () => {
    expect((await request(app).get(`${API}/users`)).status).toBe(401);
  });
});

describe('admin user management', () => {
  it('lists with filters and pagination, exposing partner rates to admins only', async () => {
    const { agent } = await loginAs(Role.ADMIN);
    await createUser(Role.PARTNER, { name: 'Priya Designer' });
    await createUser(Role.PARTNER);
    await createUser(Role.CLIENT);

    const res = await agent.get(`${API}/users`).query({ role: 'PARTNER', limit: 1 });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta).toMatchObject({ total: 2, page: 1, limit: 1, totalPages: 2 });
    expect(res.body.data[0].partnerProfile.hourlyRateMinor).toBe(150000);

    const search = await agent.get(`${API}/users`).query({ q: 'priya' });
    expect(search.body.data.map((u: { name: string }) => u.name)).toEqual(['Priya Designer']);

    // Regex metacharacters are treated literally.
    expect((await agent.get(`${API}/users`).query({ q: '.*' })).body.data).toHaveLength(0);
  });

  it('invites a client user linked to a client record', async () => {
    const { agent } = await loginAs(Role.ADMIN);
    const client = await createClientRecord('Globex');
    const res = await agent.post(`${API}/users/invite`).send({
      email: 'owner@globex.test',
      name: 'Globex Owner',
      role: 'CLIENT',
      clientId: client.id,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.clientId).toBe(client.id);
  });

  it('updates partner profile fields', async () => {
    const { agent } = await loginAs(Role.ADMIN);
    const partner = await createUser(Role.PARTNER);
    const res = await agent.patch(`${API}/users/${partner.id}`).send({
      name: 'Renamed Partner',
      partnerProfile: { designation: 'Senior Dev', hourlyRateMinor: 200000 },
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      name: 'Renamed Partner',
      partnerProfile: {
        partnerType: 'FREELANCER',
        designation: 'Senior Dev',
        hourlyRateMinor: 200000,
      },
    });
  });

  it('deactivation takes effect immediately and is audited', async () => {
    const { agent } = await loginAs(Role.ADMIN);
    const partner = await createUser(Role.PARTNER);
    const login = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: partner.email, password: PASSWORD });
    const at = cookieValue(login.headers['set-cookie'], 'ix_at')!;
    const rt = cookieValue(login.headers['set-cookie'], 'ix_rt')!;
    await request(app).get(`${API}/auth/me`).set('Cookie', `ix_at=${at}`).expect(200);

    const res = await agent.patch(`${API}/users/${partner.id}/status`).send({ status: 'INACTIVE' });
    expect(res.body.data.status).toBe(UserStatus.INACTIVE);

    expect((await request(app).get(`${API}/auth/me`).set('Cookie', `ix_at=${at}`)).status).toBe(
      401,
    );
    expect(
      (await request(app).post(`${API}/auth/refresh`).set('Cookie', `ix_rt=${rt}`)).status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .post(`${API}/auth/login`)
          .send({ email: partner.email, password: PASSWORD })
      ).status,
    ).toBe(403);

    const log = await AuditLog.findOne({
      action: 'user.deactivated',
      entityId: partner._id,
    }).lean();
    expect(log).toBeTruthy();

    await agent.patch(`${API}/users/${partner.id}/status`).send({ status: 'ACTIVE' }).expect(200);
    expect(
      (
        await request(app)
          .post(`${API}/auth/login`)
          .send({ email: partner.email, password: PASSWORD })
      ).status,
    ).toBe(200);
  });

  it('admin cannot deactivate themselves', async () => {
    const { agent, user } = await loginAs(Role.ADMIN);
    expect(
      (await agent.patch(`${API}/users/${user.id}/status`).send({ status: 'INACTIVE' })).status,
    ).toBe(400);
  });

  it('returns 400 for malformed ids and 404 for unknown ones', async () => {
    const { agent } = await loginAs(Role.ADMIN);
    expect((await agent.get(`${API}/users/not-an-id`)).status).toBe(400);
    expect((await agent.get(`${API}/users/0123456789abcdef01234567`)).status).toBe(404);
  });

  it('audit log never stores password hashes', async () => {
    const { agent } = await loginAs(Role.ADMIN);
    await agent
      .post(`${API}/users/invite`)
      .send({ email: 'a2@example.test', name: 'Admin Two', role: 'ADMIN' })
      .expect(201);
    const res = await agent.get(`${API}/audit-logs`).query({ action: 'user.invited' });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(JSON.stringify(await AuditLog.find().lean())).not.toMatch(/passwordHash|\$2[aby]\$/);
  });
});

describe('self-service profile', () => {
  it('any role can update their own name but not their role', async () => {
    const { agent } = await loginAs(Role.CLIENT);
    const res = await agent.patch(`${API}/users/me`).send({ name: 'Updated Name', role: 'ADMIN' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: 'Updated Name', role: 'CLIENT' });
  });
});
