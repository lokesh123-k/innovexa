import { createServer } from 'node:http';
import { createApp } from './app';
import { env } from './config/env';
import { connectDatabase, disconnectDatabase } from './config/db';
import { startReminderJob } from './jobs/reminders';
import './models';
import { ensureDefaultCategories } from './modules/service-categories/serviceCategories.routes';
import { initSockets } from './sockets/io';
import { logger } from './utils/logger';
import { verifyMailer } from './utils/mailer';

async function main() {
  const cfg = env();
  await connectDatabase(cfg.MONGODB_URI);
  await ensureDefaultCategories();
  if (cfg.EMAIL_TRANSPORT === 'smtp') {
    const smtp = await verifyMailer();
    if (smtp.ok) logger.info({ host: smtp.host, user: smtp.user }, 'SMTP connection verified');
    else
      logger.warn(
        { host: smtp.host },
        `SMTP check failed: ${smtp.error} Invitations will be marked as not sent.`,
      );
  } else {
    logger.warn(`EMAIL_TRANSPORT=${cfg.EMAIL_TRANSPORT}: emails are not delivered.`);
  }

  const server = createServer(createApp());
  initSockets(server);
  if (cfg.JOBS_ENABLED) startReminderJob();
  server.listen(cfg.PORT, () =>
    logger.info(`Innovexa API listening on :${cfg.PORT} (${cfg.NODE_ENV})`),
  );

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    server.close(async () => {
      await disconnectDatabase();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'Failed to start API');
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
