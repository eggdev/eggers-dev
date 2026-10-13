import { withEve } from 'eve/next';
import type { NextConfig } from 'next';

const config: NextConfig = {
  outputFileTracingExcludes: {
    '/*': ['**/.data/**/*', '**/.eve/**/*', '**/tests/**/*', '**/_source/**/*', '**/content/**/*'],
  },
  transpilePackages: ['@repo/ui', '@repo/domain', '@repo/database'],
  serverExternalPackages: ['@electric-sql/pglite', 'postgres'],
};
export default withEve(
  config,
  !process.env.VERCEL && process.env.EVE_TEST_FIXTURE === '1'
    ? { eveRoot: '../../tests/fixtures/eve' }
    : {},
);
