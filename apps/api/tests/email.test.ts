/**
 * Real SMTP round-trips against an in-process SMTP server that requires AUTH,
 * exercising the same Nodemailer configuration used with Gmail on port 587.
 */
import type { AddressInfo } from 'node:net';
import { simpleParser } from 'mailparser';
import { SMTPServer } from 'smtp-server';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Role } from '@innovexa/shared';
import { createApp, redactUrl } from '../src/app';
import { env, resetEnvCache } from '../src/config/env';
import { AuditLog, AuthToken, User } from '../src/models';
import { logger } from '../src/utils/logger';
import { fromAddress, resetMailer, verifyMailer } from '../src/utils/mailer';
import { API, PASSWORD, createClientRecord, loginAs } from './helpers';

const SENDER = 'innovexa.sender@example.test';
const SECRET = 'abcd efgh ijkl mnop';
const inbox: { from: string; to: string; subject: string; text: string; html: string }[] = [];
let server: SMTPServer;
let port = 0;
const savedEnv = { ...process.env };

function useSmtp(password: string) {
  Object.assign(process.env, {
    EMAIL_TRANSPORT: 'smtp',
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: String(port),
    SMTP_SECURE: 'false',
    SENDER_EMAIL: SENDER,
    SENDER_PASSWORD: password,
    EMAIL_FROM: 'Innovexa Digital <no-reply@innovexadigital.com>',
  });
  resetEnvCache();
  resetMailer();
}

beforeAll(async () => {
  server = new SMTPServer({
    authOptional: false,
    disabledCommands: ['STARTTLS'],
    onAuth(auth, _session, cb) {
      // Spaces in an App Password must be stripped only for Gmail hosts; here the exact value is required.
      if (auth.username === SENDER && auth.password === SECRET) cb(null, { user: SENDER });
      else cb(Object.assign(new Error('Invalid login'), { responseCode: 535 }));
    },
    onData(stream, _session, cb) {
      simpleParser(stream)
        .then((m) => {
          inbox.push({
            from: m.from?.text ?? '',
            to: Array.isArray(m.to) ? m.to.map((t) => t.text).join(',') : (m.to?.text ?? ''),
            subject: m.subject ?? '',
            text: m.text ?? '',
            html: typeof m.html === 'string' ? m.html : '',
          });
          cb();
        })
        .catch(cb);
    },
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.server.address() as AddressInfo).port;
});

afterEach(() => {
  inbox.length = 0;
  vi.restoreAllMocks();
});

afterAll(async () => {
  process.env = savedEnv;
  resetEnvCache();
  resetMailer();
  await new Promise<void>((r) => server.close(() => r()));
});

const tokenFrom = (text: string) =>
  decodeURIComponent(/accept-invitation\?token=([^\s&]+)/.exec(text)![1]!);

describe('SMTP delivery', () => {
  it('verifies the connection and sign-in without exposing the password', async () => {
    useSmtp(SECRET);
    const ok = await verifyMailer();
    expect(ok).toMatchObject({ ok: true, transport: 'smtp', host: '127.0.0.1' });
    expect(JSON.stringify(ok)).not.toContain(SECRET);
    useSmtp('wrong-password');
    const bad = await verifyMailer();
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/sign-in failed/i);
    expect(JSON.stringify(bad)).not.toContain('wrong-password');
  });

  it('keeps the EMAIL_FROM display name', () => {
    useSmtp(SECRET);
    expect(fromAddress()).toBe('Innovexa Digital <no-reply@innovexadigital.com>');
  });

  it('sends a real partner invitation with a working password-setup link', async () => {
    useSmtp(SECRET);
    const app = createApp();
    const { agent } = await loginAs(Role.ADMIN);
    const res = await agent
      .post(`${API}/users/invite`)
      .send({
        email: 'new.partner@example.test',
        name: 'New Partner',
        role: 'PARTNER',
        partnerProfile: { partnerType: 'FREELANCER' },
      })
      .expect(201);
    expect(res.body.data.invitationEmail.status).toBe('SENT');

    expect(inbox).toHaveLength(1);
    const mail = inbox[0]!;
    expect(mail.to).toBe('new.partner@example.test');
    expect(mail.from).toContain('Innovexa Digital');
    expect(mail.subject).toBe("You're invited to the Innovexa Partner Portal");
    expect(mail.text).toContain('http://localhost:5173/accept-invitation?token=');
    expect(mail.html).toContain('Set your password');

    // The emailed link opens the password-setup flow and activates the account.
    const token = tokenFrom(mail.text);
    await request(app)
      .get(`${API}/auth/invitations/${encodeURIComponent(token)}`)
      .expect(200);
    const accepted = await request(app)
      .post(`${API}/auth/accept-invitation`)
      .send({ token, password: PASSWORD })
      .expect(200);
    expect(accepted.body.data.user).toMatchObject({ role: 'PARTNER', status: 'ACTIVE' });
  });

  it('sends a real client invitation from the Clients page flow', async () => {
    useSmtp(SECRET);
    const { agent } = await loginAs(Role.ADMIN);
    const client = await createClientRecord('Orbit Foods');
    const res = await agent
      .post(`${API}/clients/${client.id}/logins`)
      .send({ name: 'Orbit Owner', email: 'owner@orbit.test' })
      .expect(201);
    expect(res.body.data.invitationEmail.status).toBe('SENT');
    expect(inbox).toHaveLength(1);
    expect(inbox[0]!.subject).toBe("You're invited to the Innovexa Client Portal");
    expect(inbox[0]!.text).toContain('/accept-invitation?token=');
  });

  it('never reports an invitation as sent when SMTP fails, and shows why', async () => {
    useSmtp('wrong-password');
    const { agent } = await loginAs(Role.ADMIN);
    const res = await agent
      .post(`${API}/users/invite`)
      .send({
        email: 'unlucky@example.test',
        name: 'Unlucky Partner',
        role: 'PARTNER',
        partnerProfile: { partnerType: 'CONTRACTOR' },
      })
      .expect(201);
    expect(res.body.data.status).toBe('INVITED');
    expect(res.body.data.invitationEmail).toMatchObject({ status: 'FAILED' });
    expect(res.body.data.invitationEmail.error).toMatch(/sign-in failed/i);
    expect(inbox).toHaveLength(0);
    expect(JSON.stringify(res.body)).not.toContain('wrong-password');

    // Resend still fails loudly (502) and the stored status stays FAILED.
    const resend = await agent.post(`${API}/users/${res.body.data.id}/resend-invite`).expect(502);
    expect(resend.body.error.code).toBe('EMAIL_DELIVERY_FAILED');
    expect((await User.findById(res.body.data.id).lean())!.invitationEmail!.status).toBe('FAILED');
    expect(await AuditLog.countDocuments({ action: 'user.invite_email_failed' })).toBe(2);

    // After fixing SMTP, resend succeeds and the status flips to SENT.
    useSmtp(SECRET);
    await agent.post(`${API}/users/${res.body.data.id}/resend-invite`).expect(200);
    expect((await User.findById(res.body.data.id).lean())!.invitationEmail!.status).toBe('SENT');
    expect(inbox).toHaveLength(1);
  });

  it('forgot-password responds the same even when delivery fails', async () => {
    useSmtp('wrong-password');
    const { user } = await loginAs(Role.CLIENT);
    await request(createApp())
      .post(`${API}/auth/forgot-password`)
      .send({ email: user.email })
      .expect(200);
  });

  it('admin can send a test email to themselves', async () => {
    useSmtp(SECRET);
    const { agent, user } = await loginAs(Role.ADMIN);
    const res = await agent.post(`${API}/dashboard/email-test`).expect(200);
    expect(res.body.data).toMatchObject({ sent: true, to: user.email });
    expect(inbox[0]!.subject).toBe('Innovexa test email');
    useSmtp('wrong-password');
    expect(
      (await agent.post(`${API}/dashboard/email-test`).expect(502)).body.error.message,
    ).toMatch(/sign-in failed/i);
  });
});

describe('configuration and invitation lifecycle', () => {
  it('rejects smtp transport with missing settings, naming each missing variable', () => {
    useSmtp(SECRET);
    for (const k of ['SMTP_HOST', 'SENDER_EMAIL', 'SENDER_PASSWORD', 'SMTP_USER', 'SMTP_PASS'])
      delete process.env[k];
    resetEnvCache();
    expect(() => env()).toThrow(
      /SMTP_HOST is required[\s\S]*SENDER_EMAIL is required[\s\S]*SENDER_PASSWORD is required/,
    );
    useSmtp(SECRET); // restore
    expect(() => env()).not.toThrow();
  });

  it('reports an unreachable SMTP server clearly and does not mark the invite sent', async () => {
    useSmtp(SECRET);
    process.env.SMTP_PORT = '1'; // nothing listens here
    resetEnvCache();
    resetMailer();
    const check = await verifyMailer();
    expect(check.ok).toBe(false);
    expect(check.error).toMatch(/Could not connect to the SMTP server/);
    const { agent } = await loginAs(Role.ADMIN);
    const res = await agent
      .post(`${API}/users/invite`)
      .send({
        email: 'offline@example.test',
        name: 'Offline Partner',
        role: 'PARTNER',
        partnerProfile: { partnerType: 'FREELANCER' },
      })
      .expect(201);
    expect(res.body.data.invitationEmail).toMatchObject({ status: 'FAILED' });
    expect(res.body.data.invitationEmail.error).toMatch(/Could not connect/);
  });

  it('keeps the 72-hour single-use invitation; an expired link fails and Resend issues a fresh one', async () => {
    useSmtp(SECRET);
    const app = createApp();
    const { agent } = await loginAs(Role.ADMIN);
    const invited = (
      await agent
        .post(`${API}/users/invite`)
        .send({
          email: 'late@example.test',
          name: 'Late Partner',
          role: 'PARTNER',
          partnerProfile: { partnerType: 'FREELANCER' },
        })
        .expect(201)
    ).body.data;
    const first = tokenFrom(inbox[0]!.text);
    // Stored hashed (never the raw token) with a 72-hour expiry.
    const row = await AuthToken.findOne({
      userId: invited.id,
      purpose: 'INVITE',
      usedAt: null,
    }).lean();
    expect(row!.tokenHash).not.toBe(first);
    const hours = (row!.expiresAt.getTime() - row!.createdAt.getTime()) / 3_600_000;
    expect(Math.round(hours)).toBe(72);

    // Expire it: the link no longer works.
    await AuthToken.updateOne(
      { _id: row!._id },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    await request(app)
      .get(`${API}/auth/invitations/${encodeURIComponent(first)}`)
      .expect(400);
    await request(app)
      .post(`${API}/auth/accept-invitation`)
      .send({ token: first, password: PASSWORD })
      .expect(400);

    // Resend emails a new link; the old one stays dead and the new one activates the account.
    inbox.length = 0;
    await agent.post(`${API}/users/${invited.id}/resend-invite`).expect(200);
    const second = tokenFrom(inbox[0]!.text);
    expect(second).not.toBe(first);
    await request(app)
      .post(`${API}/auth/accept-invitation`)
      .send({ token: first, password: PASSWORD })
      .expect(400);
    await request(app)
      .post(`${API}/auth/accept-invitation`)
      .send({ token: second, password: PASSWORD })
      .expect(200);
    // Single use.
    await request(app)
      .post(`${API}/auth/accept-invitation`)
      .send({ token: second, password: PASSWORD })
      .expect(400);
    // Accepted users can no longer be re-invited.
    await agent.post(`${API}/users/${invited.id}/resend-invite`).expect(409);
  });

  it('partners cannot resend invitations or trigger test emails', async () => {
    useSmtp(SECRET);
    const { agent: partner } = await loginAs(Role.PARTNER);
    const { user: other } = await loginAs(Role.PARTNER);
    await partner.post(`${API}/users/${other.id}/resend-invite`).expect(403);
    await partner.post(`${API}/dashboard/email-test`).expect(403);
    await partner.get(`${API}/dashboard/settings-status`).expect(403);
  });
});

describe('secrets stay out of logs', () => {
  it('redacts invitation tokens from emails written to the log transport', async () => {
    Object.assign(process.env, { EMAIL_TRANSPORT: 'log' });
    resetEnvCache();
    resetMailer();
    const spy = vi.spyOn(logger, 'info');
    const { agent } = await loginAs(Role.ADMIN);
    const res = await agent
      .post(`${API}/users/invite`)
      .send({
        email: 'logged@example.test',
        name: 'Logged Partner',
        role: 'PARTNER',
        partnerProfile: { partnerType: 'FREELANCER' },
      })
      .expect(201);
    expect(res.body.data.invitationEmail.status).toBe('NOT_SENT');
    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).toContain('accept-invitation?token=[redacted]');
    expect(logged).not.toMatch(/token=(?!\[redacted\])[A-Za-z0-9_-]{20,}/);
  });

  it('redacts tokens from request-log URLs', () => {
    expect(redactUrl('/api/v1/auth/invitations/abcDEF123_-xyz')).toBe(
      '/api/v1/auth/invitations/[redacted]',
    );
    expect(redactUrl('/reset-password?token=secretvalue&x=1')).toBe(
      '/reset-password?token=[redacted]&x=1',
    );
  });
});

describe('email branding', () => {
  it('shows the official logo from a public URL in invitation emails', async () => {
    useSmtp(SECRET);
    const { agent } = await loginAs(Role.ADMIN);
    await agent
      .post(`${API}/users/invite`)
      .send({
        email: 'brand@example.test',
        name: 'Brand Partner',
        role: 'PARTNER',
        partnerProfile: { partnerType: 'FREELANCER' },
      })
      .expect(201);
    expect(inbox[0]!.html).toContain(
      '<img src="http://localhost:5173/innovex.logo.jpeg" alt="Innovexa Digital Logo"',
    );
    process.env.EMAIL_LOGO_URL = 'https://cdn.innovexadigital.com/innovex.logo.jpeg';
    resetEnvCache();
    inbox.length = 0;
    await agent
      .post(
        `${API}/users/${(await User.findOne({ email: 'brand@example.test' }))!.id}/resend-invite`,
      )
      .expect(200);
    expect(inbox[0]!.html).toContain('src="https://cdn.innovexadigital.com/innovex.logo.jpeg"');
    delete process.env.EMAIL_LOGO_URL;
    resetEnvCache();
  });

  it('refuses a localhost logo URL in production', () => {
    const saved = { ...process.env };
    Object.assign(process.env, { NODE_ENV: 'production', APP_URL: 'http://localhost:5173' });
    resetEnvCache();
    expect(() => env()).toThrow(/public https logo URL/);
    process.env = saved;
    resetEnvCache();
  });
});
