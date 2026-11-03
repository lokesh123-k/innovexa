import { defineConfig, devices } from '@playwright/test';
import { assertLocalDatabase } from './apps/api/scripts/localDbGuard';

/**
 * End-to-end tests against a running stack (`npm run dev`).
 * Credentials come from .env (DEV_ADMIN_EMAIL / DEV_ADMIN_PASSWORD).
 */
process.loadEnvFile?.('.env');
// The specs create projects, invoices and payments through the running API, which uses this same
// MONGODB_URI: refuse unless it is a local database (or ALLOW_REMOTE_DB_WRITES=1).
assertLocalDatabase('the e2e tests');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
