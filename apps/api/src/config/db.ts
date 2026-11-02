import mongoose from 'mongoose';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';

// Unknown filter keys are dropped rather than matched. Operator injection is prevented upstream:
// every request value is Zod-parsed into scalars before it reaches a query.
mongoose.set('strictQuery', true);

/**
 * Serverless-safe connection: one Mongoose connection per warm function
 * instance, shared by every request it serves. Concurrent cold-start requests
 * await the same in-flight promise instead of opening extra connections.
 */
let pending: Promise<typeof mongoose> | undefined;

export function ensureDatabase(uri: string): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) return Promise.resolve(mongoose);
  // autoIndex stays on so a fresh production database gets its unique indexes (idempotent).
  pending ??= connectDatabase(uri, 2, { maxPoolSize: 5 }).catch((err: unknown) => {
    pending = undefined; // let the next request retry
    // The driver's message names the cause (auth, DNS, IP allowlist) but never the password.
    logger.error({ err }, 'MongoDB unavailable: check MONGODB_URI and Atlas Network Access');
    throw new AppError(
      503,
      'DATABASE_UNAVAILABLE',
      'The database is unavailable. Please try again.',
    );
  });
  return pending;
}

/**
 * Connects with retries so a brief network drop (or an Atlas IP allowlist
 * change taking effect) doesn't leave the API dead until a manual restart.
 */
export async function connectDatabase(
  uri: string,
  attempts = 6,
  options: { maxPoolSize?: number; autoIndex?: boolean } = {},
): Promise<typeof mongoose> {
  for (let attempt = 1; ; attempt++) {
    try {
      const conn = await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 10000,
        autoIndex: options.autoIndex ?? true,
        ...(options.maxPoolSize && { maxPoolSize: options.maxPoolSize }),
      });
      logger.info({ db: conn.connection.name }, 'MongoDB connected');
      return conn;
    } catch (err) {
      if (attempt >= attempts) throw err;
      const delayMs = Math.min(30_000, 2_000 * 2 ** (attempt - 1));
      logger.warn(
        { attempt, retryInSeconds: delayMs / 1000 },
        uri.startsWith('mongodb+srv://')
          ? 'MongoDB connection failed. If you use Atlas, check Network Access allows your current IP. Retrying…'
          : 'MongoDB connection failed. Is the database running? Retrying…',
      );
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}
