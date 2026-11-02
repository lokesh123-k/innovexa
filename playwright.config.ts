import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against a running stack (`npm run dev`).
 * Credentials come from .env (DEV_ADMIN_EMAIL / DEV_ADMIN_PASSWORD).
 */
process.loadEnvFile?.('.env');

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
