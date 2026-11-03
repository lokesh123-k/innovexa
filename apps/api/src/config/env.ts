import { z } from 'zod';

/** Accepts true/false/1/0 in any case, ignoring surrounding whitespace (hosting dashboards vary). */
const bool = (fallback: boolean) =>
  z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
    z
      .enum(['true', 'false', '1', '0'])
      .optional()
      .transform((v) => (v === undefined ? fallback : v === 'true' || v === '1')),
  );

/** Browsers send Origin without a trailing slash, so `https://app.example/` must match too. */
const stripSlash = (s: string) => s.replace(/\/+$/, '');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),

    MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_ISSUER: z.string().default('innovexa-api'),
    JWT_AUDIENCE: z.string().default('innovexa-web'),
    ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().min(1).max(60).default(15),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
    // A rotated refresh token re-presented within this window (multi-tab race) is not treated as theft.
    REFRESH_REUSE_GRACE_SECONDS: z.coerce.number().int().min(0).max(120).default(30),
    INVITE_TOKEN_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(72),
    RESET_TOKEN_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(60),
    VERIFY_TOKEN_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(48),
    BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
    MAX_FAILED_LOGINS: z.coerce.number().int().min(1).default(5),
    LOCKOUT_MINUTES: z.coerce.number().int().min(1).default(15),

    COOKIE_DOMAIN: z.string().optional(),
    COOKIE_SECURE: bool(false),
    /** `none` when the web app and API are on different sites (e.g. two *.vercel.app domains). */
    /**
     * `auto` (default): SameSite=None for sign-ins from an allowed origin on another host
     * (needs COOKIE_SECURE=true), otherwise Lax. `lax`/`strict`/`none` force one mode.
     */
    COOKIE_SAMESITE: z.preprocess(
      (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
      z.enum(['auto', 'lax', 'strict', 'none']).default('auto'),
    ),

    APP_URL: z.url().default('http://localhost:5173').transform(stripSlash),
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:5173')
      .transform((s) =>
        s
          .split(',')
          .map((o) => stripSlash(o.trim()))
          .filter(Boolean),
      ),
    /**
     * Opt-in: also allow this Vercel project's preview deployments, given as
     * `<project-name>:<team-slug>` (e.g. `innovexa-web:acme-projects-1a2b3c4d`). Only URLs
     * `https://<project>-<hash>-<team>.vercel.app` and `https://<project>-git-<branch>-<team>.vercel.app`
     * match; other *.vercel.app sites never do.
     */
    CORS_VERCEL_PREVIEWS: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:-[a-z0-9]+)*$/, {
        message: 'Use <project-name>:<team-slug>, lowercase letters, digits and hyphens only',
      })
      .optional(),
    RATE_LIMIT_ENABLED: bool(true),
    // General API budget per IP per 15 minutes; sign-in and token endpoints have stricter limits.
    RATE_LIMIT_PER_15_MIN: z.coerce.number().int().min(100).default(3000),
    JOBS_ENABLED: bool(true),
    /** Bearer secret Vercel Cron sends to /api/v1/internal/cron/*. Cron routes are disabled when unset. */
    CRON_SECRET: z.string().min(16).optional(),
    /** Set automatically by Vercel ("1"). */
    VERCEL: z.string().optional(),

    UPLOAD_DIR: z.string().default('uploads'),
    MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(50).default(10),

    // Online payments are disabled unless all Razorpay keys are present.
    RAZORPAY_KEY_ID: z.string().optional(),
    RAZORPAY_KEY_SECRET: z.string().optional(),
    RAZORPAY_WEBHOOK_SECRET: z.string().optional(),

    EMAIL_TRANSPORT: z.enum(['smtp', 'log', 'memory']).default('log'),
    EMAIL_FROM: z.string().default('Innovexa Digital <no-reply@innovexadigital.com>'),
    /** Public URL of the logo for emails. Defaults to APP_URL + /innovex.logo.jpeg. */
    EMAIL_LOGO_URL: z.url().optional(),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    SMTP_SECURE: bool(false),
    /** SMTP login. SENDER_EMAIL / SENDER_PASSWORD take precedence over SMTP_USER / SMTP_PASS. */
    SENDER_EMAIL: z.string().trim().optional(),
    SENDER_PASSWORD: z.string().optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.EMAIL_TRANSPORT === 'smtp') {
      if (!env.SMTP_HOST) {
        ctx.addIssue({
          code: 'custom',
          path: ['SMTP_HOST'],
          message: 'SMTP_HOST is required for smtp transport',
        });
      }
      if (!(env.SENDER_EMAIL || env.SMTP_USER)) {
        ctx.addIssue({
          code: 'custom',
          path: ['SENDER_EMAIL'],
          message: 'SENDER_EMAIL is required for smtp transport',
        });
      }
      if (!(env.SENDER_PASSWORD || env.SMTP_PASS)) {
        ctx.addIssue({
          code: 'custom',
          path: ['SENDER_PASSWORD'],
          message: 'SENDER_PASSWORD is required for smtp transport',
        });
      }
    }
    if (env.COOKIE_SAMESITE === 'none' && !env.COOKIE_SECURE) {
      ctx.addIssue({
        code: 'custom',
        path: ['COOKIE_SAMESITE'],
        message: 'COOKIE_SAMESITE=none requires COOKIE_SECURE=true (browsers reject it otherwise)',
      });
    }
    if (env.NODE_ENV === 'production') {
      if (!env.COOKIE_SECURE) {
        ctx.addIssue({
          code: 'custom',
          path: ['COOKIE_SECURE'],
          message: 'COOKIE_SECURE must be true in production',
        });
      }
      if (
        /change[-_]?me|secret|example/i.test(env.JWT_ACCESS_SECRET) ||
        env.JWT_ACCESS_SECRET.length < 48
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['JWT_ACCESS_SECRET'],
          message: 'Use a random secret of at least 48 characters in production',
        });
      }
      if (env.EMAIL_TRANSPORT !== 'smtp') {
        ctx.addIssue({
          code: 'custom',
          path: ['EMAIL_TRANSPORT'],
          message: 'Production requires smtp email transport',
        });
      }
      const logo = env.EMAIL_LOGO_URL ?? `${env.APP_URL}/innovex.logo.jpeg`;
      if (!logo.startsWith('https://') || /localhost|127\.0\.0\.1/.test(logo)) {
        ctx.addIssue({
          code: 'custom',
          path: ['EMAIL_LOGO_URL'],
          message:
            'Emails need a public https logo URL in production (set EMAIL_LOGO_URL or an https APP_URL)',
        });
      }
      if (env.CORS_ORIGINS.some((o) => o.startsWith('http://'))) {
        ctx.addIssue({
          code: 'custom',
          path: ['CORS_ORIGINS'],
          message: 'Production origins must use https',
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

/** One rejected variable: its name and the rule it broke. Never contains the value. */
export interface ConfigIssue {
  variable: string;
  problem: string;
}

/** Thrown by env() when the environment is invalid; `issues` is safe to log. */
export class ConfigError extends Error {
  constructor(readonly issues: ConfigIssue[]) {
    super(
      `Invalid environment configuration:\n${issues.map((i) => `  - ${i.variable}: ${i.problem}`).join('\n')}`,
    );
    this.name = 'ConfigError';
  }
}

let cached: Env | undefined;

/** Parsed, validated configuration. Throws a ConfigError listing every invalid variable. */
export function env(): Env {
  if (!cached) {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      throw new ConfigError(
        parsed.error.issues.map((i) => ({
          variable: i.path.join('.') || '(environment)',
          // Zod messages describe the rule (e.g. "expected string, received undefined"), not the input.
          problem: i.message,
        })),
      );
    }
    cached = parsed.data;
  }
  return cached;
}

/** Test hook: re-read process.env on next access. */
export function resetEnvCache(): void {
  cached = undefined;
}
