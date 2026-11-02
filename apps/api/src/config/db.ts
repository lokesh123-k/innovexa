import mongoose from 'mongoose';
import { logger } from '../utils/logger';

// Unknown filter keys are dropped rather than matched. Operator injection is prevented upstream:
// every request value is Zod-parsed into scalars before it reaches a query.
mongoose.set('strictQuery', true);

/**
 * Connects with retries so a brief network drop (or an Atlas IP allowlist
 * change taking effect) doesn't leave the API dead until a manual restart.
 */
export async function connectDatabase(uri: string, attempts = 6): Promise<typeof mongoose> {
  for (let attempt = 1; ; attempt++) {
    try {
      const conn = await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 10000,
        autoIndex: true,
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
