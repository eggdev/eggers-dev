import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    ...devices['Desktop Chrome'],
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: 'ASTRO_DEV_BACKGROUND=0 bun run --cwd apps/web dev -- --host 127.0.0.1 --port 4321',
      url: 'http://127.0.0.1:4321',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command:
        'bun run --cwd apps/studio db:migrate:local && bun run --cwd apps/studio dev -- --host 127.0.0.1 --port 5173',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command:
        'bun run --cwd apps/home db:migrate:local && bun run --cwd apps/home dev -- --host 127.0.0.1 --port 5174',
      url: 'http://127.0.0.1:5174',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
})
