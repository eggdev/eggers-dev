// Deploys the public site and its chat endpoint as one Cloudflare Worker (wrangler.jsonc).
//
//   bun tools/deploy.ts --origin https://eggers.dev [--dry-run]
//
// In order, stopping at the first failure:
//   1. Build the site for the origin: API_BASE_URL=<origin> bun exact.mjs web-build --out dist.
//   2. wrangler deploy (with --dry-run: build the Worker bundle, upload nothing, sign-in not needed).
//
// The collection is not part of a deploy. The owner publishes it from the studio to the R2 bucket CONTENT, and the
// Worker reads it at request time (worker/collection.ts), so a content change needs no deploy.
// The origin is where the site is served: https://eggers.dev, the Worker's custom domain (wrangler.jsonc "routes";
// its workers.dev address is off). The page sends its questions to <origin>/ask.
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SITE = resolve(import.meta.dir, '..');
// Git ignores site/.wrangler/.
const DRY_RUN_OUT = join(SITE, '.wrangler', 'dry-run');
const WRANGLER = join(SITE, 'node_modules', '.bin', 'wrangler');
// Wrangler reports usage to Cloudflare unless told not to.
const QUIET = { WRANGLER_SEND_METRICS: 'false' };
const USAGE = 'bun tools/deploy.ts --origin https://<public origin> [--dry-run]';

function stop(message: string): never {
  console.error(`deploy: ${message}`);
  process.exit(1);
}

function parseArgs(argv: string[]) {
  let origin: string | undefined;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--origin') origin = argv[++i];
    else if (arg.startsWith('--origin=')) origin = arg.slice('--origin='.length);
    else stop(`unknown argument "${arg}". Usage: ${USAGE}`);
  }
  return { origin, dryRun };
}

function checkOrigin(value: string | undefined): string {
  if (!value) stop('give the public origin: --origin https://<host>. The page sends its questions to <origin>/ask.');
  let url: URL;
  try { url = new URL(value); } catch { stop(`"${value}" is not a URL. Give it as https://<host>.`); }
  if (url.protocol !== 'https:') stop(`the origin must start with https:// (got "${value}").`);
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    stop(`the origin is a scheme and host only, such as https://example.com (got "${value}").`);
  }
  return url.origin;
}

function run(label: string, cmd: string[], env: Record<string, string> = {}) {
  console.log(`deploy: ${label}`);
  const result = Bun.spawnSync(cmd, { cwd: SITE, env: { ...process.env, ...env }, stdio: ['inherit', 'inherit', 'inherit'] });
  if (result.exitCode !== 0) stop(`${label} failed (exit ${result.exitCode}). Nothing more was done.`);
}

const args = parseArgs(process.argv.slice(2));

// 1. The site, built for the origin.
const origin = checkOrigin(args.origin);
if (!existsSync(WRANGLER)) stop('wrangler is not installed. Run `bun install` in site/ first.');
run(`building the site for ${origin}`, ['bun', 'exact.mjs', 'web-build', '--out', 'dist'], { API_BASE_URL: origin });
const build = JSON.parse(readFileSync(join(SITE, 'dist', '.exact-build.json'), 'utf8')) as { env?: Record<string, { value?: string }> };
if (build.env?.API_BASE_URL?.value !== origin) stop(`the build did not take API_BASE_URL=${origin}. Nothing was deployed.`);
for (const page of ['index.html', '404.html']) {
  if (!existsSync(join(SITE, 'dist', page))) stop(`the build has no dist/${page}. Nothing was deployed.`);
}

// 2. The Worker and the site's files.
if (args.dryRun) {
  run('wrangler deploy --dry-run (nothing is uploaded)', [WRANGLER, 'deploy', '--dry-run', '--outdir', DRY_RUN_OUT], QUIET);
  console.log(`deploy: dry run done. The Worker bundle is in ${relative(SITE, DRY_RUN_OUT)}/.`);
} else {
  run('wrangler deploy', [WRANGLER, 'deploy'], QUIET);
  console.log(`deploy: done. The site is at ${origin}`);
}
