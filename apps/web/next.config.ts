import type { NextConfig } from 'next';

const config: NextConfig = {
  outputFileTracingExcludes: {
    '/*': ['**/.data/**/*', '**/.eve/**/*', '**/tests/**/*', '**/_source/**/*', '**/content/**/*'],
  },
  transpilePackages: ['@repo/ui', '@repo/domain', '@repo/database'],
  serverExternalPackages: ['@electric-sql/pglite', 'postgres'],
};
export default config;
