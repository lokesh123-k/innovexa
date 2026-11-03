import type { CookieOptions, Request, Response } from 'express';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

export const ACCESS_COOKIE = 'ix_at';
export const REFRESH_COOKIE = 'ix_rt';
/** The refresh cookie is only ever sent to the auth endpoints. */
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

/** True when the browser page that sent this request is on another host than the API. */
function isCrossOrigin(req: Request): boolean {
  const origin = req.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).host !== req.get('host');
  } catch {
    return false; // e.g. "Origin: null" from sandboxed pages
  }
}

/**
 * SameSite mode for this request's cookies. With `auto`, a web app on another
 * host gets SameSite=None (browsers never send Lax cookies on its cross-site API
 * calls, so every request after sign-in would be 401). Only allowed origins get
 * here: CORS and the origin guard reject unsafe requests from any other origin.
 */
function sameSiteFor(req: Request): 'lax' | 'strict' | 'none' {
  const cfg = env();
  if (cfg.COOKIE_SAMESITE !== 'auto') return cfg.COOKIE_SAMESITE;
  return cfg.COOKIE_SECURE && isCrossOrigin(req) ? 'none' : 'lax';
}

function base(req: Request): CookieOptions {
  const cfg = env();
  return {
    httpOnly: true,
    secure: cfg.COOKIE_SECURE,
    sameSite: sameSiteFor(req),
    domain: cfg.COOKIE_DOMAIN || undefined,
  };
}

export function setAuthCookies(
  res: Response,
  tokens: { accessToken: string; refreshToken: string },
): void {
  const cfg = env();
  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...base(res.req),
    path: '/',
    maxAge: cfg.ACCESS_TOKEN_TTL_MINUTES * 60_000,
  });
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...base(res.req),
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
  const crossOrigin = isCrossOrigin(req);
  const sameSite = sameSiteFor(req);
  const details = {
    reason,
    method: req.method,
    path: req.path,
    origin: req.get('origin'),
    cookieNames: Object.keys((req.cookies ?? {}) as Record<string, unknown>),
    cookieSameSite: sameSite,
    crossOrigin,
  };
  if (crossOrigin && sameSite !== 'none' && reason.startsWith('NO_')) {
    logger.warn(
      details,
      `Auth failed (${reason}): request is cross-origin but cookies are SameSite=${sameSite}, ` +
        'so the browser does not send them. Use COOKIE_SAMESITE=auto or none (with COOKIE_SECURE=true) or serve the API from the web app origin.',
    );
  } else if (crossOrigin && reason.startsWith('NO_')) {
    logger.warn(
      details,
      `Auth failed (${reason}): no session cookie arrived although cookies are SameSite=None. ` +
        'The browser is likely blocking third-party cookies (Safari, private windows, Brave); serve the API from the web app origin to avoid this.',
    );
  } else {
    logger.info(details, `Auth failed (${reason})`);
  }
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, { ...base(res.req), path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...base(res.req), path: REFRESH_COOKIE_PATH });
}
