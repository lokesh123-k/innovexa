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
import type { Express } from 'express';
import { createApp } from './src/app.js';
import { env } from './src/config/env.js';
import { ensureDatabase } from './src/config/db.js';
import './src/models.js';
import { ensureDefaultCategories } from './src/modules/service-categories/serviceCategories.routes.js';

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

const app: Express = createApp({ prepare: ready });

export default app;
