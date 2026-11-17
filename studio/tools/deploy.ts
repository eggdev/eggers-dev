// Deploys the private studio as one Cloudflare Worker (studio/wrangler.jsonc) at https://studio.eggers.dev, with
// the container image its Durable Object runs (cloud/Dockerfile).
//
//   bun studio/tools/deploy.ts [--dry-run]
//
// In order, stopping at the first failure:
//   0. Check that Docker runs. Wrangler builds the container image with it, for every deploy and also for a dry run.
//      A real deploy without Docker stops here. A dry run without Docker goes on with --containers-rollout=none:
//      wrangler then checks and bundles the Worker but builds no image, and says so.
//   1. Refuse while a dev session runs (tools/dev.ts or `bun exact.mjs web`). The build shares target/ with the dev
//      loop, and a build for another API address breaks the running session.
//   2. Build the screens from the repository root for the studio's API:
//      API_BASE_URL=https://studio.eggers.dev/api bun exact.mjs web-build --out target/studio-dist
//      Exact builds only into dist/ or target/ inside the app, so the build goes to target/ first. Stop when the
//      built app.js is over 8,000,000 bytes.
//   3. Copy the build into studio/dist, leaving out its dot files (.exact-build.json, .exact/), and check that no
//      private data came with it: no database, nothing from .data/ or resume/.
//   4. wrangler deploy (with --dry-run: build the Worker bundle and the image, upload nothing, sign-in not needed).
//      Wrangler builds the image for linux/amd64 with the repository root as its context; the root .dockerignore
//      lets in only the app's code.
//
// A real deploy needs CLOUDFLARE_ACCOUNT_ID in the environment and wrangler's sign-in. The Worker's secrets
// (ACCESS_TEAM_DOMAIN, ACCESS_AUD and the optional GH_TOKEN) are set once with `wrangler secret put` (see
// wrangler.jsonc). The R2 bucket eggers-studio-data is created once with `wrangler r2 bucket create`.
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const STUDIO = resolve(import.meta.dir, '..');
const REPO = resolve(STUDIO, '..');
const ORIGIN = 'https://studio.eggers.dev';
const API = `${ORIGIN}/api`;
// The largest built app.js this tool deploys (step 2).
const MAX_APP_BYTES = 8_000_000;
const BUILD = join(REPO, 'target', 'studio-dist');
const DIST = join(STUDIO, 'dist');
const DRY_RUN_OUT = join(STUDIO, '.wrangler', 'dry-run');
const WRANGLER = join(STUDIO, 'node_modules', '.bin', 'wrangler');
// Wrangler reports usage to Cloudflare unless told not to.
const QUIET = { WRANGLER_SEND_METRICS: 'false' };

function stop(message: string): never {
  console.error(`deploy: ${message}`);
  process.exit(1);
}

function run(label: string, cmd: string[], cwd: string, env: Record<string, string> = {}) {
  console.log(`deploy: ${label}`);
  const result = Bun.spawnSync(cmd, { cwd, env: { ...process.env, ...env }, stdio: ['inherit', 'inherit', 'inherit'] });
  if (result.exitCode !== 0) stop(`${label} failed (exit ${result.exitCode}). Nothing more was done.`);
}

/** This process and every process above it (the shells that started it, whose command lines may name the text). */
function ancestors(): Set<number> {
  const seen = new Set<number>([process.pid]);
  let pid = process.ppid;
  while (pid > 1 && !seen.has(pid) && seen.size < 64) {
    seen.add(pid);
    pid = Number(Bun.spawnSync(['ps', '-o', 'ppid=', '-p', String(pid)], { stdout: 'pipe', stderr: 'ignore' }).stdout.toString().trim()) || 0;
  }
  return seen;
}

/** Whether a process whose command line contains the text is running, other than this one and its ancestors. */
function running(text: string): boolean {
  const out = Bun.spawnSync(['pgrep', '-f', text], { stdout: 'pipe', stderr: 'ignore' }).stdout.toString();
  const self = ancestors();
  return out.split('\n').some((line) => line.trim() !== '' && !self.has(Number(line.trim())));
}

/** Every file under a directory, as paths relative to it. */
function files(dir: string, base = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path, base) : [relative(base, path)];
  });
}

let dryRun = false;
for (const arg of process.argv.slice(2)) {
  if (arg === '--dry-run') dryRun = true;
  else stop(`unknown argument "${arg}". Usage: bun studio/tools/deploy.ts [--dry-run]`);
}
const account = process.env.CLOUDFLARE_ACCOUNT_ID ?? '';
if (!dryRun && !account) stop('set CLOUDFLARE_ACCOUNT_ID to the Cloudflare account that holds the studio. Nothing was built or deployed.');
if (!existsSync(WRANGLER)) stop('wrangler is not installed. Run `bun install` in studio/ first.');

// 0. Docker, for the container image.
const docker = Bun.which('docker') ? Bun.spawnSync(['docker', 'info'], { stdout: 'ignore', stderr: 'ignore' }).exitCode === 0 : false;
if (!docker && !dryRun) {
  stop('Docker is not running. Wrangler builds the container image (cloud/Dockerfile) with it on every deploy. '
    + 'Start Docker (or Colima) and run this again. Nothing was built or deployed.');
}
// The image's build context is the repository root, which holds .data/. The root .dockerignore must leave
// everything out first and let only the app's code back in.
const ignore = existsSync(join(REPO, '.dockerignore')) ? readFileSync(join(REPO, '.dockerignore'), 'utf8') : '';
const rules = ignore.split('\n').map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#'));
if (rules[0] !== '*' || !rules.includes('.data')) {
  stop('the root .dockerignore must start with "*" (leave everything out) and name .data. Without it the container '
    + 'image could hold private data. Nothing was built or deployed.');
}
if (!docker) console.log('deploy: Docker is not running, so this dry run builds no container image (--containers-rollout=none).');

// 1. No dev session.
if (running('tools/dev.ts') || running('exact.mjs web')) {
  stop('a dev session is running (tools/dev.ts or `bun exact.mjs web`). The build shares target/ with it, and a build for '
    + `${API} would break it. Stop the dev session, or deploy from a copy of the repository. Nothing was built or deployed.`);
}

// 2. The screens, built for the studio's API.
run(`building the screens for ${API}`, ['bun', 'exact.mjs', 'web-build', '--out', relative(REPO, BUILD)], REPO, { API_BASE_URL: API });
const build = JSON.parse(readFileSync(join(BUILD, '.exact-build.json'), 'utf8')) as { env?: Record<string, { value?: string }> };
if (build.env?.API_BASE_URL?.value !== API) stop(`the build did not take API_BASE_URL=${API}. Nothing was deployed.`);
for (const page of ['index.html', 'shell.html', 'routes.json']) {
  if (!existsSync(join(BUILD, page))) stop(`the build has no ${page}. Nothing was deployed.`);
}
// The screens' code is one file that every visit downloads and parses. The host refuses a file over 25 MiB, and it
// stood at 4.6 MB when this check was added (it had grown to 27.7 MB when a component was drawn at too many places).
if (!existsSync(join(BUILD, 'app.js'))) stop('the build has no app.js. Nothing was deployed.');
const appBytes = statSync(join(BUILD, 'app.js')).size;
if (appBytes > MAX_APP_BYTES) {
  stop(`the built app.js is ${appBytes.toLocaleString('en-US')} bytes, more than the ${MAX_APP_BYTES.toLocaleString('en-US')} allowed. `
    + 'Something in the screens is drawn at many more places than it needs (a component used in each branch of an if, or under each level of a list). Nothing was deployed.');
}

// 3. The build, without its dot files, into studio/dist (git ignores it).
rmSync(DIST, { recursive: true, force: true });
cpSync(BUILD, DIST, { recursive: true, filter: (src) => src === BUILD || !relative(BUILD, src).split(/[\\/]/).some((part) => part.startsWith('.')) });
const shipped = files(DIST).sort();
// The screens are code only. A database, a resume or anything from .data/ means something went wrong.
const PRIVATE = /(^|\/)(\.data|data|resume|_source|content)(\/|$)|\.(db|sqlite|sqlite3|db-wal|db-shm|pdf|docx|env)$|(^|\/)\./i;
const leaked = shipped.filter((file) => PRIVATE.test(file));
if (leaked.length) stop(`the build holds files that may be private: ${leaked.join(', ')}. Nothing was deployed.`);
const bytes = shipped.reduce((n, file) => n + statSync(join(DIST, file)).size, 0);
console.log(`deploy: ${shipped.length} files (${(bytes / 1024 / 1024).toFixed(1)} MB) in ${relative(REPO, DIST)}/:`);
for (const file of shipped) console.log(`  ${file}`);

// 4. The Worker and the screens.
const env = { ...QUIET, ...(account ? { CLOUDFLARE_ACCOUNT_ID: account } : {}) };
if (dryRun) {
  const noImage = docker ? [] : ['--containers-rollout=none'];
  run('wrangler deploy --dry-run (nothing is uploaded)', [WRANGLER, 'deploy', '--dry-run', '--outdir', DRY_RUN_OUT, ...noImage], STUDIO, env);
  console.log(`deploy: dry run done. The Worker bundle is in ${relative(REPO, DRY_RUN_OUT)}/.`);
} else {
  run('wrangler deploy', [WRANGLER, 'deploy'], STUDIO, env);
  console.log(`deploy: done. The studio is at ${ORIGIN}`);
}
