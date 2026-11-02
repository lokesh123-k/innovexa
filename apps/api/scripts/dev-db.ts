/**
 * Local development MongoDB (no install or Atlas account needed).
 * Data is persisted in ./.dev-db so it survives restarts. Development only.
 *
 *   npm run dev:db
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { MongoMemoryServer } from 'mongodb-memory-server';

const port = Number(process.env.DEV_DB_PORT ?? 27017);
const dbPath = resolve(import.meta.dirname, '../../../.dev-db');
mkdirSync(dbPath, { recursive: true });

const server = await MongoMemoryServer.create({
  instance: { port, dbPath, storageEngine: 'wiredTiger' },
});

console.log(`Development MongoDB running at ${server.getUri()}  (data: ${dbPath})`);
console.log('Keep this terminal open. Press Ctrl+C to stop.');

const stop = async () => {
  await server.stop({ doCleanup: false });
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
