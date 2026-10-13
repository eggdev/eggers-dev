import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

const root = resolve('.data/e2e');
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 15000 },
  use: { headless: true, trace: 'retain-on-failure' },
  webServer: [
    {
      command: 'node tools/run-app.mjs studio',
      url: 'http://127.0.0.1:3001/api/health',
      reuseExistingServer: false,
      timeout: 120000,
      env: {
        LOCAL_DATA_DIR: `${root}/studio-${Date.now()}`,
        EVE_TEST_FIXTURE: '1',
        EVE_TELEMETRY_DISABLED: '1',
        EVE_TRACES: 'off',
      },
    },
    {
      command: 'node tools/run-app.mjs web',
      url: 'http://127.0.0.1:3000',
      reuseExistingServer: false,
      timeout: 120000,
      env: { LOCAL_DATA_DIR: `${root}/web-${Date.now()}` },
    },
  ],
});
