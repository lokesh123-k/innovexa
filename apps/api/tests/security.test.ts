import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Role } from '@innovexa/shared';
import { API, PASSWORD, createUser, loginAs } from './helpers';

describe('HTTP hardening', () => {
  const app = createApp();

  it('sets security headers and hides the framework', async () => {
    const res = await request(app).get(`${API}/health`);
    expect(res.status).toBe(200);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeDefined();
  });

  it('allows CORS only for allowlisted origins', async () => {
    const good = await request(app)
      .options(`${API}/auth/login`)
      .set('Origin', 'http://localhost:5173');
    expect(good.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(good.headers['access-control-allow-credentials']).toBe('true');
    const bad = await request(app)
      .options(`${API}/auth/login`)
      .set('Origin', 'https://evil.example');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects unsafe requests from foreign origins (CSRF guard)', async () => {
    const res = await request(app)
      .post(`${API}/auth/logout`)
      .set('Origin', 'https://evil.example')
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
  });

  it('returns JSON errors for malformed bodies and unknown routes', async () => {
    const bad = await request(app)
      .post(`${API}/auth/login`)
      .set('Content-Type', 'application/json')
      .send('{"email":');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_JSON');
    const missing = await request(app).get(`${API}/nope`);
    expect(missing.status).toBe(404);
    expect(missing.body.success).toBe(false);
  });

  it('rejects NoSQL operator injection in credentials', async () => {
    const res = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: { $ne: null }, password: { $ne: null } });
    expect(res.status).toBe(400);
  });

  it('rate-limits auth endpoints when enabled', async () => {
    const limited = createApp({ rateLimitEnabled: true });
    let last = 0;
    for (let i = 0; i < 21; i++) {
      last = (
        await request(limited).post(`${API}/auth/forgot-password`).send({ email: 'a@example.test' })
      ).status;
    }
    expect(last).toBe(429);
  });

  it('counts only failed sign-ins toward the login rate limit', async () => {
    const limited = createApp({ rateLimitEnabled: true });
    const user = await createUser(Role.PARTNER);
    for (let i = 0; i < 25; i++) {
      await request(limited)
        .post(`${API}/auth/login`)
        .send({ email: user.email, password: PASSWORD })
        .expect(200);
    }
    let last = 0;
    for (let i = 0; i < 21; i++) {
      last = (
        await request(limited)
          .post(`${API}/auth/login`)
          .send({ email: 'ghost@example.test', password: 'Wrong-pass-1' })
      ).status;
    }
    expect(last).toBe(429);
  });
});

describe('serverless (Vercel) behaviour', () => {
  it('refuses uploads with a clear 503 when no persistent storage exists', async () => {
    const { resetEnvCache } = await import('../src/config/env');
    process.env.VERCEL = '1';
    resetEnvCache();
    try {
      const { agent } = await loginAs(Role.ADMIN);
      const res = await agent
        .post(`${API}/files`)
        .field('kind', 'PROJECT')
        .field('refId', '0123456789abcdef01234567')
        .attach('file', Buffer.from('x'), { filename: 'a.txt', contentType: 'text/plain' });
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('STORAGE_NOT_CONFIGURED');
    } finally {
      delete process.env.VERCEL;
      resetEnvCache();
    }
  });

  it('issues SameSite=None; Secure cookies when the web app is on another site', async () => {
    const { resetEnvCache } = await import('../src/config/env');
    process.env.COOKIE_SAMESITE = 'none';
    process.env.COOKIE_SECURE = 'true';
    resetEnvCache();
    try {
      const user = await createUser(Role.PARTNER);
      const res = await request(createApp())
        .post(`${API}/auth/login`)
        .send({ email: user.email, password: PASSWORD });
      expect(res.status).toBe(200);
      const cookies = [res.headers['set-cookie'] ?? []].flat();
      expect(cookies).toHaveLength(2);
      for (const c of cookies) {
        expect(c).toMatch(/SameSite=None/i);
        expect(c).toMatch(/; Secure/i);
        expect(c).toMatch(/HttpOnly/i);
      }
    } finally {
      delete process.env.COOKIE_SAMESITE;
      delete process.env.COOKIE_SECURE;
      resetEnvCache();
    }
  });

  it('rejects SameSite=None without Secure', async () => {
    const { env, resetEnvCache } = await import('../src/config/env');
    process.env.COOKIE_SAMESITE = 'none';
    resetEnvCache();
    try {
      expect(() => env()).toThrow(/COOKIE_SAMESITE/);
    } finally {
      delete process.env.COOKIE_SAMESITE;
      resetEnvCache();
    }
  });

  it('answers health even when per-request preparation fails', async () => {
    const app = createApp({ prepare: () => Promise.reject(new Error('db down')) });
    const health = await request(app).get(`${API}/health`);
    expect(health.headers['content-type']).toMatch(/json/);
    expect(health.body.data.status).toBeDefined();
    const other = await request(app).get(`${API}/service-categories`);
    expect(other.status).toBe(500);
    expect(other.body.success).toBe(false);
    const root = await request(app).get('/');
    expect(root.status).toBe(200);
    expect(root.body.data.health).toBe('/api/v1/health');
  });

  it('protects the cron route with CRON_SECRET', async () => {
    const { resetEnvCache } = await import('../src/config/env');
    const app = createApp();
    expect((await request(app).get(`${API}/internal/cron/reminders`)).status).toBe(404); // disabled when unset
    process.env.CRON_SECRET = 'test-cron-secret-0123456789';
    resetEnvCache();
    try {
      expect((await request(app).get(`${API}/internal/cron/reminders`)).status).toBe(401);
      expect(
        (
          await request(app)
            .get(`${API}/internal/cron/reminders`)
            .set('Authorization', 'Bearer wrong-secret-0123456789')
        ).status,
      ).toBe(401);
      const ok = await request(app)
        .get(`${API}/internal/cron/reminders`)
        .set('Authorization', 'Bearer test-cron-secret-0123456789');
      expect(ok.status).toBe(200);
      expect(ok.body.data).toEqual({ sent: 0 });
    } finally {
      delete process.env.CRON_SECRET;
      resetEnvCache();
    }
  });
});
