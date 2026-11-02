import { Router } from 'express';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { safeEqual } from '../utils/crypto.js';
import { ok } from '../utils/http.js';
import { runReminders } from './reminders.js';

/**
 * Scheduled jobs for serverless hosting (Vercel Cron calls these with
 * `Authorization: Bearer <CRON_SECRET>`). On a long-running server the same
 * job runs in-process via startReminderJob(). Disabled when CRON_SECRET is unset.
 */
export const cronRouter = Router();

cronRouter.use((req, _res, next) => {
  const secret = env().CRON_SECRET;
  if (!secret) throw AppError.notFound('Route');
  const header = req.get('authorization') ?? '';
  if (!safeEqual(header, `Bearer ${secret}`))
    throw AppError.unauthorized('Invalid cron credentials', 'CRON_UNAUTHORIZED');
  next();
});

cronRouter.get('/reminders', async (_req, res) => {
  ok(res, { sent: await runReminders() });
});
