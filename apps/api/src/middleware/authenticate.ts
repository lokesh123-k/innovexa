import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import { ROLES, UserStatus, type Role } from '@innovexa/shared';
import { env } from '../config/env';
import { User } from '../modules/users/user.model';
import { AppError } from '../utils/AppError';
import { ACCESS_COOKIE } from '../modules/auth/auth.cookies';

interface AccessClaims {
  sub: string;
  role: Role;
  tv: number;
}

export function signAccessToken(user: {
  _id: Types.ObjectId;
  role: Role;
  tokenVersion: number;
}): string {
  const cfg = env();
  return jwt.sign({ role: user.role, tv: user.tokenVersion }, cfg.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    subject: user._id.toString(),
    issuer: cfg.JWT_ISSUER,
    audience: cfg.JWT_AUDIENCE,
    expiresIn: cfg.ACCESS_TOKEN_TTL_MINUTES * 60,
  });
}

export function verifyAccessToken(token: string): AccessClaims {
  const cfg = env();
  try {
    const claims = jwt.verify(token, cfg.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
      issuer: cfg.JWT_ISSUER,
      audience: cfg.JWT_AUDIENCE,
    }) as jwt.JwtPayload;
    if (
      typeof claims.sub !== 'string' ||
      !Types.ObjectId.isValid(claims.sub) ||
      !ROLES.includes(claims.role) ||
      typeof claims.tv !== 'number'
    ) {
      throw AppError.unauthorized('Invalid access token', 'INVALID_TOKEN');
    }
    return { sub: claims.sub, role: claims.role, tv: claims.tv };
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw AppError.unauthorized('Access token expired', 'TOKEN_EXPIRED');
    }
    if (err instanceof AppError) throw err;
    throw AppError.unauthorized('Invalid access token', 'INVALID_TOKEN');
  }
}

export function extractAccessToken(req: Pick<Request, 'cookies' | 'headers'>): string | undefined {
  const cookie = req.cookies?.[ACCESS_COOKIE] as string | undefined;
  if (cookie) return cookie;
  const header = req.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7) : undefined;
}

/**
 * Resolves the caller from the access token and re-checks the account on every
 * request, so deactivation or a password reset takes effect immediately.
 */
export async function resolveUserFromToken(token: string) {
  const claims = verifyAccessToken(token);
  const user = await User.findOne({ _id: claims.sub, deletedAt: null })
    .select('role status tokenVersion email name clientId')
    .lean();
  if (
    !user ||
    user.status !== UserStatus.ACTIVE ||
    user.tokenVersion !== claims.tv ||
    user.role !== claims.role
  ) {
    throw AppError.unauthorized('Session is no longer valid', 'SESSION_INVALID');
  }
  return {
    id: user._id.toString(),
    _id: user._id,
    role: user.role,
    email: user.email,
    name: user.name,
    clientId: user.clientId ?? undefined,
  };
}

export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const token = extractAccessToken(req);
  if (!token) throw AppError.unauthorized();
  req.user = await resolveUserFromToken(token);
  next();
}

/** For handlers behind `authenticate`: returns the caller or fails loudly if wiring is wrong. */
export function currentUser(req: Request) {
  if (!req.user) throw AppError.unauthorized();
  return req.user;
}
