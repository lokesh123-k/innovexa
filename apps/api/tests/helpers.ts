import request from 'supertest';
import { PartnerType, Role, UserStatus } from '@innovexa/shared';
import { createApp } from '../src/app';
import { Client, User } from '../src/models';
import { hashPassword } from '../src/modules/auth/auth.service';
import { sentMail } from '../src/utils/mailer';

export const PASSWORD = 'Correct-Horse-9';
export const API = '/api/v1';

export const app = createApp();

let seq = 0;

export async function createClientRecord(name = 'Acme Corp') {
  seq += 1;
  return Client.create({
    clientCode: `CLI-T${seq}`,
    companyName: name,
    contactName: `${name} Contact`,
    email: `contact${seq}@${name.toLowerCase().replace(/\W/g, '')}.test`,
  });
}

export async function createUser(role: Role, overrides: Record<string, unknown> = {}) {
  seq += 1;
  const base: Record<string, unknown> = {
    email: `${role.toLowerCase()}${seq}@example.test`,
    name: `${role} ${seq}`,
    role,
    status: UserStatus.ACTIVE,
    emailVerifiedAt: new Date(),
    passwordHash: await hashPassword(PASSWORD),
  };
  if (role === Role.PARTNER)
    base.partnerProfile = { partnerType: PartnerType.FREELANCER, hourlyRateMinor: 150000 };
  if (role === Role.CLIENT && !overrides.clientId) base.clientId = (await createClientRecord())._id;
  return User.create({ ...base, ...overrides });
}

/** Logs in and returns a cookie-carrying agent. */
export async function loginAs(role: Role, overrides: Record<string, unknown> = {}) {
  const user = await createUser(role, overrides);
  const agent = request.agent(app);
  const res = await agent.post(`${API}/auth/login`).send({ email: user.email, password: PASSWORD });
  if (res.status !== 200)
    throw new Error(`Login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { user, agent };
}

/** Extracts the token from the most recent email whose text contains `path`. */
export function tokenFromMail(path: string, to?: string): string {
  const mail = [...sentMail].reverse().find((m) => m.text.includes(path) && (!to || m.to === to));
  if (!mail) throw new Error(`No email containing ${path}`);
  const match = new RegExp(`${path}\\?token=([^\\s&]+)`).exec(mail.text);
  return decodeURIComponent(match![1]!);
}

/** Pulls a named cookie value out of a Set-Cookie header list. */
export function cookieValue(
  setCookie: string[] | string | undefined,
  name: string,
): string | undefined {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const hit = list.find((c) => c.startsWith(`${name}=`));
  return hit?.split(';')[0]?.slice(name.length + 1) || undefined;
}
