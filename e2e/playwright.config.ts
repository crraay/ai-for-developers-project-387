import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  globalSetup: require.resolve('./global-setup.mjs'),
  globalTeardown: require.resolve('./global-teardown.mjs'),
  use: {
    baseURL: 'http://localhost:5173',
    // The verify-head job sets PLAYWRIGHT_TRACE=on so a successful run also
    // leaves a trace; the ordinary CI run keeps traces for failures only.
    trace: process.env.PLAYWRIGHT_TRACE === 'on' ? 'on' : 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
