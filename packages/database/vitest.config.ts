import path from 'node:path'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'))

  return {
    plugins: [
      cloudflareTest({
        wrangler: {
          configPath: path.join(import.meta.dirname, 'wrangler.test.jsonc'),
        },
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations },
        },
      }),
    ],
    resolve: { tsconfigPaths: true },
    test: {
      setupFiles: [path.join(import.meta.dirname, 'tests/apply-migrations.ts')],
    },
  }
})
