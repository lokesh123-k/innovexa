import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import mongoose from 'mongoose';
import pino from 'pino';
import { pinoHttp } from 'pino-http';
import { env } from './config/env';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { buildRateLimiters, originGuard } from './middleware/security';
import { auditLogRouter } from './modules/audit-logs/auditLog.routes';
import { changeRequestsRouter } from './modules/change-requests/changeRequests.routes';
import { clientsRouter } from './modules/clients/clients.routes';
import { conversationsRouter } from './modules/conversations/conversations.routes';
import { buildFilesRouter } from './modules/files/files.routes';
import {
  invoicesRouter,
  paymentWebhookRouter,
  paymentsRouter,
} from './modules/invoices/billing.routes';
import { notificationsRouter } from './modules/notifications/notification.routes';
import { milestonesRouter, projectsRouter } from './modules/projects/projects.routes';
import { dashboardRouter } from './modules/reports/dashboards.routes';
import { reportsRouter } from './modules/reports/reports.routes';
import { workReportsRouter } from './modules/reports/workReports.routes';
import { serviceCategoriesRouter } from './modules/service-categories/serviceCategories.routes';
import { tasksRouter } from './modules/tasks/tasks.routes';
import { buildAuthRouter } from './modules/auth/auth.routes';
import { usersRouter } from './modules/users/users.routes';
import { logger } from './utils/logger';
import { redactTokens } from './utils/mailer';

/** Request-log URL with one-time tokens removed (query `token=` and `/invitations/:token`). */
export const redactUrl = (url: string) =>
  redactTokens(url).replace(/(\/invitations\/)[^/?#]+/, '$1[redacted]');

export interface AppOptions {
  rateLimitEnabled?: boolean;
}

export function createApp(options: AppOptions = {}): Express {
  const cfg = env();
  const app = express();
  const limiters = buildRateLimiters(
    options.rateLimitEnabled ?? cfg.RATE_LIMIT_ENABLED,
    cfg.RATE_LIMIT_PER_15_MIN,
  );

  app.disable('x-powered-by');
  app.set('trust proxy', cfg.TRUST_PROXY);

  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || cfg.CORS_ORIGINS.includes(origin)),
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      maxAge: 600,
    }),
  );
  app.use(originGuard(cfg.CORS_ORIGINS));
  // Payment webhooks need the raw body for signature checks, so they precede the JSON parser.
  app.use('/api/v1/payments/webhooks', paymentWebhookRouter);
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use((req, _res, next) => {
    req.valid = {};
    next();
  });
  if (cfg.NODE_ENV !== 'test')
    app.use(
      pinoHttp({
        logger,
        autoLogging: { ignore: (req) => req.url === '/api/v1/health' },
        // One-time tokens must never reach the logs (e.g. GET /auth/invitations/:token).
        serializers: {
          req: pino.stdSerializers.wrapRequestSerializer((r) => {
            r.url = redactUrl(r.url);
            return r;
          }),
        },
      }),
    );
  app.use('/api', limiters.global);

  app.get('/api/v1/health', (_req, res) => {
    const dbUp = mongoose.connection.readyState === 1;
    res
      .status(dbUp ? 200 : 503)
      .json({ success: dbUp, data: { status: dbUp ? 'ok' : 'degraded', db: dbUp } });
  });

  app.use('/api/v1/auth', buildAuthRouter(limiters.auth, limiters.login));
  app.use('/api/v1/users', usersRouter);
  app.use('/api/v1/audit-logs', auditLogRouter);
  app.use('/api/v1/service-categories', serviceCategoriesRouter);
  app.use('/api/v1/clients', clientsRouter);
  app.use('/api/v1/projects', projectsRouter);
  app.use('/api/v1/milestones', milestonesRouter);
  app.use('/api/v1/tasks', tasksRouter);
  app.use('/api/v1/work-reports', workReportsRouter);
  app.use('/api/v1/files', buildFilesRouter());
  app.use('/api/v1/conversations', conversationsRouter);
  app.use('/api/v1/notifications', notificationsRouter);
  app.use('/api/v1/change-requests', changeRequestsRouter);
  app.use('/api/v1/invoices', invoicesRouter);
  app.use('/api/v1/payments', paymentsRouter);
  app.use('/api/v1/dashboard', dashboardRouter);
  app.use('/api/v1/reports', reportsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
