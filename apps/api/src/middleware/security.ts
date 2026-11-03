import type { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { AppError } from '../utils/AppError.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export type OriginCheck = (origin: string) => boolean;

/**
 * The single trusted-origin rule shared by CORS, the CSRF guard and Socket.IO:
 * an exact CORS_ORIGINS entry, or (only when CORS_VERCEL_PREVIEWS is set) a
 * preview deployment of that one Vercel project under that one team scope.
 */
export function buildOriginCheck(origins: readonly string[], vercelPreviews?: string): OriginCheck {
  const exact = new Set(origins);
  let preview: RegExp | undefined;
  if (vercelPreviews) {
    // Both parts are validated as [a-z0-9-] in env.ts, so they are safe inside a RegExp.
    const [project, team] = vercelPreviews.split(':');
    preview = new RegExp(
      `^https://${project}-(?:[a-z0-9]{9}|git-[a-z0-9]+(?:-[a-z0-9]+)*)-${team}\\.vercel\\.app$`,
    );
  }
  return (origin) => exact.has(origin) || (preview?.test(origin) ?? false);
}

/**
 * CSRF defence in depth: browsers always send `Origin` on cross-origin unsafe
 * requests, so reject any that do not come from an allowlisted origin.
 * Requests without `Origin` (server-to-server, payment webhooks) pass through.
 */
export const originGuard =
  (isAllowed: OriginCheck) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;
    if (!SAFE_METHODS.has(req.method) && origin && !isAllowed(origin)) {
      throw AppError.forbidden('Origin not allowed', 'ORIGIN_NOT_ALLOWED');
    }
    next();
  };

const limitHandler = (_req: Request, _res: Response, next: NextFunction) =>
  next(new AppError(429, 'RATE_LIMITED', 'Too many requests. Please try again later.'));

/** `globalLimit`: requests per IP per 15 min across the API (offices share one IP). */
export function buildRateLimiters(enabled: boolean, globalLimit = 3000) {
  const skip = () => !enabled;
  return {
    global: rateLimit({
      windowMs: 15 * 60_000,
      limit: globalLimit,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      skip,
      handler: limitHandler,
    }),
    auth: rateLimit({
      windowMs: 15 * 60_000,
      limit: 20,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      skip,
      handler: limitHandler,
    }),
    /**
     * Sign-in: only failed attempts count, so many people behind one office IP
     * can sign in normally while password guessing is still capped (per-account
     * lockout applies on top of this).
     */
    login: rateLimit({
      windowMs: 15 * 60_000,
      limit: 20,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      skipSuccessfulRequests: true,
      skip,
      handler: limitHandler,
    }),
  };
}
