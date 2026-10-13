import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: {
    alias: {
      '@repo/database': resolve('packages/database/src'),
      '@repo/domain': resolve('packages/domain/src'),
    },
  },
  test: {
    include: ['packages/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    maxWorkers: 1,
  },
});
