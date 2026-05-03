import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:4321',
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: 'pnpm dev',
      url: 'http://localhost:4321',
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      // Wrangler local dev — KV is persisted to .wrangler/state-test so the
      // fixture can pre-seed secrets via `wrangler kv key put --local`.
      command:
        'pnpm --filter @gno/worker exec wrangler dev --port 8787 --persist-to .wrangler/state-test',
      url: 'http://localhost:8787',
      reuseExistingServer: true,
      timeout: 60_000,
      cwd: '../..',
    },
  ],
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
