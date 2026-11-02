import type { Types } from 'mongoose';
import type { AuthTokenPurpose } from '@innovexa/shared';
import { generateToken, sha256 } from '../../utils/crypto';
import { AppError } from '../../utils/AppError';
import { AuthToken } from './authToken.model';

/** Issues a new single-use token, invalidating any outstanding token for the same purpose. */
export async function issueAuthToken(
  userId: Types.ObjectId,
  purpose: AuthTokenPurpose,
  ttlMs: number,
): Promise<string> {
  const now = new Date();
  await AuthToken.updateMany({ userId, purpose, usedAt: null }, { $set: { usedAt: now } });
  const raw = generateToken(32);
  await AuthToken.create({
    userId,
    purpose,
    tokenHash: sha256(raw),
    expiresAt: new Date(now.getTime() + ttlMs),
  });
  return raw;
}

/** Returns the token row if it is valid, without consuming it. */
export async function peekAuthToken(raw: string, purpose: AuthTokenPurpose) {
  const token = await AuthToken.findOne({
    tokenHash: sha256(raw),
    purpose,
    usedAt: null,
    expiresAt: { $gt: new Date() },
  }).lean();
  if (!token) throw new AppError(400, 'INVALID_TOKEN', 'This link is invalid or has expired');
  return token;
}

/** Atomically marks the token used; concurrent consumers cannot both succeed. */
export async function consumeAuthToken(raw: string, purpose: AuthTokenPurpose) {
  const token = await AuthToken.findOneAndUpdate(
    { tokenHash: sha256(raw), purpose, usedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { usedAt: new Date() } },
    { new: true },
  ).lean();
  if (!token) throw new AppError(400, 'INVALID_TOKEN', 'This link is invalid or has expired');
  return token;
}
