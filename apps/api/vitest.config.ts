import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./tests/global-setup.ts'],
    setupFiles: ['./tests/setup.ts'],
    // Each file gets its own database; files run serially to keep the in-memory server light.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 120000,
  },
});
