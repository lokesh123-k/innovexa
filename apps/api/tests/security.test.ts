import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Role } from '@innovexa/shared';
import { API, PASSWORD, createUser } from './helpers';

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
