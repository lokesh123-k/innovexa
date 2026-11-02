import type { CookieOptions, Response } from 'express';
import { env } from '../../config/env.js';

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

export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, { ...base(), path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...base(), path: REFRESH_COOKIE_PATH });
}
