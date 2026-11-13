// Deploys the public site and its chat endpoint as one Cloudflare Worker (wrangler.jsonc).
//
//   bun tools/deploy.ts --origin https://<public origin> [--dry-run] [--collection <path>]
//
// In order, stopping at the first failure:
//   1. Refuse unless the approved public collection exists (.data/public/collection.md at the repository root).
//      Its content is never printed.
//   2. Build the site for the origin: API_BASE_URL=<origin> bun exact.mjs web-build --out dist.
//   3. Copy the collection to worker/private/collection.md, which git ignores, for the Worker's bundle.
//   4. wrangler deploy (with --dry-run: build the Worker bundle, upload nothing, sign-in not needed).
//
// --collection <path> uses another collection file instead, for tests and local runs (worker/fixture/collection.md).
// The origin is where the site will be served, such as https://eggers-site.<account>.workers.dev: the page sends
// its questions to <origin>/ask.
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const SITE = resolve(import.meta.dir, '..');
const REPO = resolve(SITE, '..');
const APPROVED = join(REPO, '.data', 'public', 'collection.md');
const BUNDLED = join(SITE, 'worker', 'private', 'collection.md');
const DRY_RUN_OUT = join(SITE, 'worker', 'private', 'dry-run');
const WRANGLER = join(SITE, 'node_modules', '.bin', 'wrangler');
// Wrangler reports usage to Cloudflare unless told not to.
const QUIET = { WRANGLER_SEND_METRICS: 'false' };

function stop(message: string): never {
  console.error(`deploy: ${message}`);
  process.exit(1);
}

function parseArgs(argv: string[]) {
  let origin: string | undefined;
  let collection: string | undefined;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--origin') origin = argv[++i];
    else if (arg.startsWith('--origin=')) origin = arg.slice('--origin='.length);
    else if (arg === '--collection') collection = argv[++i];
    else if (arg.startsWith('--collection=')) collection = arg.slice('--collection='.length);
    else stop(`unknown argument "${arg}". Usage: bun tools/deploy.ts --origin https://<public origin> [--dry-run] [--collection <path>]`);
  }
  return { origin, collection, dryRun };
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

// 1. The collection.
const collection = args.collection ? resolve(process.cwd(), args.collection) : APPROVED;
const shown = relative(REPO, collection) || collection;
if (!existsSync(collection) || !statSync(collection).isFile()) {
  stop(args.collection
    ? `the collection file ${shown} does not exist.`
    : `the approved public collection is missing (${shown}). The assistant may answer only from it, so nothing was built or deployed. Approve and export the collection first.`);
}
if (statSync(collection).size === 0) stop(`the collection file ${shown} is empty. Nothing was built or deployed.`);

// 2. The site, built for the origin.
const origin = checkOrigin(args.origin);
if (!existsSync(WRANGLER)) stop('wrangler is not installed. Run `bun install` in site/ first.');
run(`building the site for ${origin}`, ['bun', 'exact.mjs', 'web-build', '--out', 'dist'], { API_BASE_URL: origin });
const build = JSON.parse(readFileSync(join(SITE, 'dist', '.exact-build.json'), 'utf8')) as { env?: Record<string, { value?: string }> };
if (build.env?.API_BASE_URL?.value !== origin) stop(`the build did not take API_BASE_URL=${origin}. Nothing was deployed.`);
for (const page of ['index.html', '404.html']) {
  if (!existsSync(join(SITE, 'dist', page))) stop(`the build has no dist/${page}. Nothing was deployed.`);
}

// 3. The collection, into the Worker's bundle input (git ignores worker/private/).
mkdirSync(dirname(BUNDLED), { recursive: true });
copyFileSync(collection, BUNDLED);
console.log(`deploy: copied ${shown} into the Worker bundle (${relative(SITE, BUNDLED)})`);

// 4. The Worker and the site's files.
if (args.dryRun) {
  run('wrangler deploy --dry-run (nothing is uploaded)', [WRANGLER, 'deploy', '--dry-run', '--outdir', DRY_RUN_OUT], QUIET);
  console.log(`deploy: dry run done. The Worker bundle is in ${relative(SITE, DRY_RUN_OUT)}/.`);
} else {
  run('wrangler deploy', [WRANGLER, 'deploy'], QUIET);
  console.log(`deploy: done. The site is at ${origin}`);
}
