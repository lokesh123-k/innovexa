import type { CookieOptions, Request, Response } from 'express';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

export const ACCESS_COOKIE = 'ix_at';
export const REFRESH_COOKIE = 'ix_rt';
/** The refresh cookie is only ever sent to the auth endpoints. */
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

function base(): CookieOptions {
  const cfg = env();
  return {
    httpOnly: true,
    secure: cfg.COOKIE_SECURE,
    sameSite: cfg.COOKIE_SAMESITE,
    domain: cfg.COOKIE_DOMAIN || undefined,
  };
}

export function setAuthCookies(
  res: Response,
  tokens: { accessToken: string; refreshToken: string },
): void {
  const cfg = env();
  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...base(),
    path: '/',
    maxAge: cfg.ACCESS_TOKEN_TTL_MINUTES * 60_000,
  });
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...base(),
    path: REFRESH_COOKIE_PATH,
    maxAge: cfg.REFRESH_TOKEN_TTL_DAYS * 86_400_000,
  });
}

/**
 * Diagnostic for a request that should carry a session but does not: logs only cookie
 * *names*, the Origin and the cookie mode (never tokens or cookie values). The usual
 * production cause is a web app on another site with SameSite=lax cookies, which
 * browsers store at login but never send on cross-site requests.
 */
export function logAuthFailure(req: Request, reason: string): void {
  const cfg = env();
  const origin = req.get('origin');
  let originHost: string | undefined;
  try {
    originHost = origin ? new URL(origin).host : undefined;
  } catch {
    originHost = undefined; // e.g. "Origin: null" from sandboxed pages
  }
  const crossOrigin = !!originHost && originHost !== req.get('host');
  const laxCrossSite = crossOrigin && cfg.COOKIE_SAMESITE !== 'none';
  const details = {
    reason,
    method: req.method,
    path: req.path,
    origin,
    cookieNames: Object.keys((req.cookies ?? {}) as Record<string, unknown>),
    cookieSameSite: cfg.COOKIE_SAMESITE,
    crossOrigin,
  };
  if (laxCrossSite && reason.startsWith('NO_')) {
    logger.warn(
      details,
      `Auth failed (${reason}): request is cross-origin but cookies are SameSite=${cfg.COOKIE_SAMESITE}, ` +
        'so the browser does not send them. Set COOKIE_SAMESITE=none (with COOKIE_SECURE=true) or serve the API from the web app origin.',
    );
  } else {
    logger.info(details, `Auth failed (${reason})`);
  }
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, { ...base(), path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...base(), path: REFRESH_COOKIE_PATH });
}
