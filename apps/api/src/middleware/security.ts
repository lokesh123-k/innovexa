import type { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { AppError } from '../utils/AppError';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence in depth: browsers always send `Origin` on cross-origin unsafe
 * requests, so reject any that do not come from an allowlisted origin.
 * Requests without `Origin` (server-to-server, payment webhooks) pass through.
 */
export const originGuard =
  (allowed: readonly string[]) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;
    if (!SAFE_METHODS.has(req.method) && origin && !allowed.includes(origin)) {
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
