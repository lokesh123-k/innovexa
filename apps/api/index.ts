/**
 * Vercel entrypoint (zero-config Express): exports the same app that
 * `src/server.ts` serves locally — every /api/v1 route, middleware and error
 * handler is shared; nothing is duplicated.
 *
 * Differences from the long-running server (src/server.ts, used for local dev
 * and container/VM hosting):
 * - no app.listen(): Vercel invokes the exported app per request;
 * - the MongoDB connection is opened lazily and reused by the warm instance;
 * - Socket.IO and the in-process reminder timer are not started (serverless
 *   functions cannot hold WebSockets or run timers between requests). Reminders
 *   run through the cron route instead; see README "Deploying the API to Vercel".
 */
import cors from 'cors';
import express, { type Express } from 'express';
import { createApp } from './src/app.js';
import { ConfigError, env } from './src/config/env.js';
import { ensureDatabase } from './src/config/db.js';
import './src/models.js';
import { ensureDefaultCategories } from './src/modules/service-categories/serviceCategories.routes.js';
import { logger } from './src/utils/logger.js';

let seeded: Promise<void> | undefined;

async function ready(): Promise<void> {
  await ensureDatabase(env().MONGODB_URI);
  // Idempotent upsert of default categories, once per warm instance.
  seeded ??= ensureDefaultCategories().catch((err: unknown) => {
    seeded = undefined;
    throw err;
  });
  await seeded;
}

/**
 * An invalid configuration must not crash the module: Vercel would answer every
 * request with a bare FUNCTION_INVOCATION_FAILED. Instead, log which variables are
 * wrong (names and rules only, never values) and answer requests with a JSON 503.
 * Environment changes on Vercel need a redeploy, so evaluating once per instance is enough.
 */
function build(): Express {
  try {
    return createApp({ prepare: ready });
  } catch (err) {
    // Variable names and rules are already public in the source code; values never appear.
    // They are shown only while the API is unusable, so the deployment can be fixed without log access.
    const issues = err instanceof ConfigError ? err.issues : undefined;
    if (issues) {
      logger.fatal(
        { invalidVariables: issues.map((i) => i.variable) },
        `API not started. Invalid environment variables: ${issues
          .map((i) => `${i.variable} (${i.problem})`)
          .join('; ')}. Fix them in the Vercel project settings and redeploy.`,
      );
    } else {
      logger.fatal({ err }, 'API not started: unexpected startup error');
    }
    const fallback = express();
    fallback.disable('x-powered-by');
    // Let the web app read this error instead of reporting a CORS failure. The configuration is
    // invalid, so trust only exact CORS_ORIGINS entries read directly (no preview rule).
    const origins = (process.env.CORS_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim().replace(/\/+$/, ''))
      .filter((o) => o.startsWith('https://') || o.startsWith('http://localhost'));
    fallback.use(
      cors({
        origin: (origin, cb) => cb(null, !!origin && origins.includes(origin)),
        credentials: true,
      }),
    );
    fallback.use((_req, res) => {
      res.status(503).json({
        success: false,
        error: {
          code: 'SERVICE_MISCONFIGURED',
          message: issues
            ? 'The API is not configured correctly: fix the listed environment variables and redeploy.'
            : 'The API failed to start. See the server logs.',
          ...(issues && { details: issues }),
        },
      });
    });
    return fallback;
  }
}

const app: Express = build();

export default app;
