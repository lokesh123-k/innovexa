import { describe, expect, it } from 'vitest';
import { Role } from '@innovexa/shared';
import { API, loginAs } from './helpers';

/** A clean database must produce honest zeros and empty lists, never invented figures. */
describe('dashboards on a database with no business records', () => {
  it('admin: zero counts, ₹0 billing, no instalments, no chart data', async () => {
    const { agent } = await loginAs(Role.ADMIN);
    const res = await agent.get(`${API}/dashboard/admin`);
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.clients).toBe(0);
    expect(d.activePartners).toBe(0);
    expect(d.projects).toMatchObject({ total: 0, active: 0, completed: 0, pending: 0, overdue: 0 });
    expect(d.tasks).toMatchObject({ total: 0, done: 0, awaitingReview: 0, completionPercent: 0 });
    expect(d.billing.receivedMinor).toBe(0);
    expect(d.billing.outstandingMinor).toBe(0);
    expect(d.upcomingInstallments).toEqual([]);
    expect(d.revenueByMonth).toEqual([]);
    expect(d.recentMessages).toEqual([]);
    expect(d.activeProjects).toEqual([]);
    for (const p of [
      '/clients',
      '/projects',
      '/tasks',
      '/invoices',
      '/payments',
      '/conversations',
    ]) {
      const list = await agent.get(`${API}${p}`);
      expect(list.status).toBe(200);
      expect(list.body.data).toEqual([]);
    }
  });

  it('partner: no assignments, no progress, no deadlines', async () => {
    const { agent } = await loginAs(Role.PARTNER);
    const d = (await agent.get(`${API}/dashboard/partner`)).body.data;
    expect(d.activeProjects).toBe(0);
    expect(d.tasks).toMatchObject({ total: 0, done: 0, completionPercent: 0 });
    expect(d.upcomingDeadlines).toEqual([]);
    expect((await agent.get(`${API}/tasks`)).body.data).toEqual([]);
  });

  it('client: no projects, invoices or payments', async () => {
    const { agent } = await loginAs(Role.CLIENT);
    const res = await agent.get(`${API}/dashboard/client`);
    expect(res.status).toBe(200);
    for (const p of ['/projects', '/invoices', '/payments']) {
      expect((await agent.get(`${API}${p}`)).body.data).toEqual([]);
    }
  });
});
