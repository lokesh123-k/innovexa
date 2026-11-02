import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, inject } from 'vitest';

Object.assign(process.env, {
  NODE_ENV: 'test',
  JWT_ACCESS_SECRET: 'test-only-access-secret-that-is-long-enough-123456',
  EMAIL_TRANSPORT: 'memory',
  RATE_LIMIT_ENABLED: 'false',
  BCRYPT_ROUNDS: '4',
  APP_URL: 'http://localhost:5173',
  CORS_ORIGINS: 'http://localhost:5173',
  MONGODB_URI: inject('mongoUri'),
  JOBS_ENABLED: 'false',
  UPLOAD_DIR: join(tmpdir(), 'innovexa-test-uploads'),
  RAZORPAY_KEY_ID: 'rzp_test_key',
  RAZORPAY_KEY_SECRET: 'rzp_test_secret',
  RAZORPAY_WEBHOOK_SECRET: 'rzp_test_webhook_secret',
});

beforeAll(async () => {
  const uri = inject('mongoUri');
  // One database per test file keeps files isolated.
  await mongoose.connect(uri, { dbName: `test_${randomUUID().slice(0, 8)}` });
  await import('../src/models');
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
});

beforeEach(async () => {
  const { sentMail } = await import('../src/utils/mailer');
  sentMail.length = 0;
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
