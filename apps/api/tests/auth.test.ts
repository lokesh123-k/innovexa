import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { Role, UserStatus } from '@innovexa/shared';
import { RefreshSession, User } from '../src/models';
import { sentMail } from '../src/utils/mailer';
import { API, PASSWORD, app, cookieValue, createUser, loginAs, tokenFromMail } from './helpers';

describe('login', () => {
  it('sets httpOnly cookies and returns a safe user DTO', async () => {
    const user = await createUser(Role.ADMIN);
    const res = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: user.email.toUpperCase(), password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({ email: user.email, role: 'ADMIN' });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|tokenVersion/);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    expect(cookies.find((c) => c.startsWith('ix_at='))).toMatch(/HttpOnly/);
    expect(cookies.find((c) => c.startsWith('ix_rt='))).toMatch(/Path=\/api\/v1\/auth/);
  });

  it('returns the same error for unknown email and wrong password', async () => {
    const user = await createUser(Role.PARTNER);
    const a = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: 'nobody@example.test', password: PASSWORD });
    const b = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: user.email, password: 'Wrong-pass-1' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error).toEqual(b.body.error);
  });

  it('locks the account after repeated failures', async () => {
    const user = await createUser(Role.CLIENT);
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post(`${API}/auth/login`)
        .send({ email: user.email, password: 'Wrong-pass-1' });
    }
    const res = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: user.email, password: PASSWORD });
    expect(res.status).toBe(423);
    expect(res.body.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('rejects inactive and not-yet-activated accounts only after a correct password', async () => {
    const inactive = await createUser(Role.PARTNER, { status: UserStatus.INACTIVE });
    const res = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: inactive.email, password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_DISABLED');

    const wrong = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: inactive.email, password: 'Wrong-pass-1' });
    expect(wrong.status).toBe(401);
  });

  it('validates input', async () => {
    const res = await request(app).post(`${API}/auth/login`).send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('session lifecycle', () => {
  it('/me requires authentication', async () => {
    const res = await request(app).get(`${API}/auth/me`);
    expect(res.status).toBe(401);
  });

  it('/me returns the caller', async () => {
    const { user, agent } = await loginAs(Role.PARTNER);
    const res = await agent.get(`${API}/auth/me`);
    expect(res.status).toBe(200);
    expect(res.body.data.user.id).toBe(user.id);
    // Partners never see their own admin-only rate.
    expect(res.body.data.user.partnerProfile.hourlyRateMinor).toBeUndefined();
  });

  it('rotates refresh tokens and detects reuse', async () => {
    const user = await createUser(Role.ADMIN);
    const login = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: user.email, password: PASSWORD });
    const rt1 = cookieValue(login.headers['set-cookie'], 'ix_rt')!;

    const r1 = await request(app).post(`${API}/auth/refresh`).set('Cookie', `ix_rt=${rt1}`);
    expect(r1.status).toBe(200);
    const rt2 = cookieValue(r1.headers['set-cookie'], 'ix_rt')!;
    expect(rt2).toBeTruthy();
    expect(rt2).not.toBe(rt1);

    // Replaying the consumed token after the multi-tab grace window revokes the family…
    await RefreshSession.updateOne(
      { userId: user._id, usedAt: { $ne: null } },
      { $set: { usedAt: new Date(Date.now() - 60_000) } },
    );
    const replay = await request(app).post(`${API}/auth/refresh`).set('Cookie', `ix_rt=${rt1}`);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('REFRESH_REUSED');

    // …so the legitimately rotated token is dead too.
    const after = await request(app).post(`${API}/auth/refresh`).set('Cookie', `ix_rt=${rt2}`);
    expect(after.status).toBe(401);
    expect(await RefreshSession.countDocuments({ userId: user._id, revokedAt: null })).toBe(0);
  });

  it('two tabs refreshing with the same token at once both stay signed in', async () => {
    const user = await createUser(Role.CLIENT);
    const login = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: user.email, password: PASSWORD });
    const rt = cookieValue(login.headers['set-cookie'], 'ix_rt')!;
    const [a, b] = await Promise.all([
      request(app).post(`${API}/auth/refresh`).set('Cookie', `ix_rt=${rt}`),
      request(app).post(`${API}/auth/refresh`).set('Cookie', `ix_rt=${rt}`),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    // Each tab can keep rotating its own new token.
    for (const res of [a, b]) {
      const next = cookieValue(res.headers['set-cookie'], 'ix_rt')!;
      await request(app).post(`${API}/auth/refresh`).set('Cookie', `ix_rt=${next}`).expect(200);
    }
    // Logout ends every tab: revoked tokens never get the grace window.
    await request(app).post(`${API}/auth/logout`).set('Cookie', `ix_rt=${rt}`).expect(200);
    expect(await RefreshSession.countDocuments({ userId: user._id, revokedAt: null })).toBe(0);
    await request(app).post(`${API}/auth/refresh`).set('Cookie', `ix_rt=${rt}`).expect(401);
  });

  it('logout revokes the refresh session', async () => {
    const user = await createUser(Role.CLIENT);
    const login = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: user.email, password: PASSWORD });
    const rt = cookieValue(login.headers['set-cookie'], 'ix_rt')!;
    await request(app).post(`${API}/auth/logout`).set('Cookie', `ix_rt=${rt}`).expect(200);
    const res = await request(app).post(`${API}/auth/refresh`).set('Cookie', `ix_rt=${rt}`);
    expect(res.status).toBe(401);
  });

  it('logout-all invalidates outstanding access tokens', async () => {
    const user = await createUser(Role.PARTNER);
    const login = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: user.email, password: PASSWORD });
    const at = cookieValue(login.headers['set-cookie'], 'ix_at')!;
    await request(app).post(`${API}/auth/logout-all`).set('Cookie', `ix_at=${at}`).expect(200);
    const res = await request(app).get(`${API}/auth/me`).set('Cookie', `ix_at=${at}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SESSION_INVALID');
  });

  it('rejects forged and tampered tokens', async () => {
    const res = await request(app).get(`${API}/auth/me`).set('Authorization', 'Bearer abc.def.ghi');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });
});

describe('invitation flow', () => {
  it('admin invites a partner who accepts and is logged in', async () => {
    const { agent } = await loginAs(Role.ADMIN);
    const invite = await agent.post(`${API}/users/invite`).send({
      email: 'New.Partner@Example.test',
      name: 'New Partner',
      role: 'PARTNER',
      partnerProfile: { partnerType: 'CONTRACTOR', hourlyRateMinor: 80000 },
    });
    expect(invite.status).toBe(201);
    expect(invite.body.data).toMatchObject({
      email: 'new.partner@example.test',
      status: 'INVITED',
    });

    // Invited users cannot log in yet (no password).
    const early = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: 'new.partner@example.test', password: PASSWORD });
    expect(early.status).toBe(401);

    const token = tokenFromMail('/accept-invitation');
    const info = await request(app).get(`${API}/auth/invitations/${encodeURIComponent(token)}`);
    expect(info.body.data).toEqual({
      email: 'new.partner@example.test',
      name: 'New Partner',
      role: 'PARTNER',
    });

    const weak = await request(app)
      .post(`${API}/auth/accept-invitation`)
      .send({ token, password: 'short' });
    expect(weak.status).toBe(400);

    const accepted = request.agent(app);
    const res = await accepted
      .post(`${API}/auth/accept-invitation`)
      .send({ token, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({ status: 'ACTIVE', emailVerified: true });
    await accepted.get(`${API}/auth/me`).expect(200);

    // Tokens are single use.
    const again = await request(app)
      .post(`${API}/auth/accept-invitation`)
      .send({ token, password: PASSWORD });
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('INVALID_TOKEN');
  });

  it('resending an invitation invalidates the previous link', async () => {
    const { agent } = await loginAs(Role.ADMIN);
    const invite = await agent
      .post(`${API}/users/invite`)
      .send({ email: 'x@example.test', name: 'Admin Two', role: 'ADMIN' })
      .expect(201);
    const first = tokenFromMail('/accept-invitation');
    await agent.post(`${API}/users/${invite.body.data.id}/resend-invite`).expect(200);
    const second = tokenFromMail('/accept-invitation');
    expect(second).not.toBe(first);
    await request(app)
      .post(`${API}/auth/accept-invitation`)
      .send({ token: first, password: PASSWORD })
      .expect(400);
    await request(app)
      .post(`${API}/auth/accept-invitation`)
      .send({ token: second, password: PASSWORD })
      .expect(200);
  });

  it('rejects duplicate emails and client users without a client', async () => {
    const { agent, user } = await loginAs(Role.ADMIN);
    const dup = await agent
      .post(`${API}/users/invite`)
      .send({ email: user.email, name: 'Dup User', role: 'ADMIN' });
    expect(dup.status).toBe(409);
    const noClient = await agent
      .post(`${API}/users/invite`)
      .send({ email: 'c@example.test', name: 'Client User', role: 'CLIENT' });
    expect(noClient.status).toBe(400);
  });
});

describe('password reset', () => {
  it('does not reveal whether an account exists', async () => {
    const res = await request(app)
      .post(`${API}/auth/forgot-password`)
      .send({ email: 'ghost@example.test' });
    expect(res.status).toBe(200);
    expect(sentMail).toHaveLength(0);
  });

  it('resets the password and revokes all existing sessions', async () => {
    const user = await createUser(Role.CLIENT);
    const login = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: user.email, password: PASSWORD });
    const at = cookieValue(login.headers['set-cookie'], 'ix_at')!;
    const rt = cookieValue(login.headers['set-cookie'], 'ix_rt')!;

    await request(app).post(`${API}/auth/forgot-password`).send({ email: user.email }).expect(200);
    const token = tokenFromMail('/reset-password', user.email);
    const newPassword = 'Brand-New-Pass-7';
    await request(app)
      .post(`${API}/auth/reset-password`)
      .send({ token, password: newPassword })
      .expect(200);

    expect((await request(app).get(`${API}/auth/me`).set('Cookie', `ix_at=${at}`)).status).toBe(
      401,
    );
    expect(
      (await request(app).post(`${API}/auth/refresh`).set('Cookie', `ix_rt=${rt}`)).status,
    ).toBe(401);
    expect(
      (await request(app).post(`${API}/auth/login`).send({ email: user.email, password: PASSWORD }))
        .status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .post(`${API}/auth/login`)
          .send({ email: user.email, password: newPassword })
      ).status,
    ).toBe(200);
    // Single use.
    await request(app)
      .post(`${API}/auth/reset-password`)
      .send({ token, password: 'Another-Pass-8' })
      .expect(400);
  });
});

describe('email verification and password change', () => {
  it('verifies email with an emailed token', async () => {
    const { agent, user } = await loginAs(Role.PARTNER, { emailVerifiedAt: null });
    await agent.post(`${API}/auth/resend-verification`).expect(200);
    const token = tokenFromMail('/verify-email', user.email);
    const res = await request(app).post(`${API}/auth/verify-email`).send({ token });
    expect(res.body.data.emailVerified).toBe(true);
    expect((await User.findById(user._id))!.emailVerifiedAt).toBeInstanceOf(Date);
    await agent.post(`${API}/auth/resend-verification`).expect(409);
  });

  it('changes the password and keeps the current device signed in', async () => {
    const { agent, user } = await loginAs(Role.ADMIN);
    const bad = await agent
      .post(`${API}/auth/change-password`)
      .send({ currentPassword: 'Nope-12345A', newPassword: 'Changed-Pass-1' });
    expect(bad.status).toBe(400);
    await agent
      .post(`${API}/auth/change-password`)
      .send({ currentPassword: PASSWORD, newPassword: 'Changed-Pass-1' })
      .expect(200);
    await agent.get(`${API}/auth/me`).expect(200);
    const res = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: user.email, password: 'Changed-Pass-1' });
    expect(res.status).toBe(200);
  });
});

describe('lockout recovery and whitespace handling', () => {
  it('returns 423 with the expiry on the attempt that triggers the lock', async () => {
    const user = await createUser(Role.ADMIN);
    const statuses: number[] = [];
    let last: request.Response | undefined;
    for (let i = 0; i < 5; i++) {
      last = await request(app)
        .post(`${API}/auth/login`)
        .send({ email: user.email, password: 'Wrong-pass-1' });
      statuses.push(last.status);
    }
    expect(statuses).toEqual([401, 401, 401, 401, 423]);
    expect(last!.body.error.code).toBe('ACCOUNT_LOCKED');
    expect(new Date(last!.body.error.details.lockedUntil).getTime()).toBeGreaterThan(Date.now());
    // Even the correct password is refused while locked.
    const locked = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: user.email, password: PASSWORD });
    expect(locked.status).toBe(423);
  });

  it('a password reset unlocks the account', async () => {
    const user = await createUser(Role.ADMIN);
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post(`${API}/auth/login`)
        .send({ email: user.email, password: 'Wrong-pass-1' });
    }
    await request(app).post(`${API}/auth/forgot-password`).send({ email: user.email }).expect(200);
    const token = tokenFromMail('/reset-password', user.email);
    await request(app)
      .post(`${API}/auth/reset-password`)
      .send({ token, password: 'Recovered-Pass-1' })
      .expect(200);
    const res = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: user.email, password: 'Recovered-Pass-1' });
    expect(res.status).toBe(200);
    const fresh = await User.findById(user._id).select('+failedLoginAttempts +lockUntil').lean();
    expect(fresh).toMatchObject({ failedLoginAttempts: 0, lockUntil: null });
  });

  it('never trims the submitted password', async () => {
    const user = await createUser(Role.PARTNER);
    const res = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: user.email, password: `${PASSWORD} ` });
    expect(res.status).toBe(401);
  });

  it('rejects new passwords with leading or trailing whitespace', async () => {
    const user = await createUser(Role.CLIENT);
    await request(app).post(`${API}/auth/forgot-password`).send({ email: user.email }).expect(200);
    const token = tokenFromMail('/reset-password', user.email);
    const res = await request(app)
      .post(`${API}/auth/reset-password`)
      .send({ token, password: 'Spaced-Pass-1 ' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.error.details)).toMatch(/start or end with a space/);
    // Inner spaces remain allowed.
    await request(app)
      .post(`${API}/auth/reset-password`)
      .send({ token, password: 'Inner Space Pass 1' })
      .expect(200);
  });
});
