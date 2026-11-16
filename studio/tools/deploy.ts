// Deploys the private studio as one Cloudflare Worker (studio/wrangler.jsonc) at https://studio.eggers.dev.
//
//   bun studio/tools/deploy.ts [--dry-run]
//
// In order, stopping at the first failure:
//   1. Refuse while a dev session runs (tools/dev.ts or `bun exact.mjs web`). The build shares target/ with the dev
//      loop, and a build for another API address breaks the running session.
//   2. Build the screens from the repository root for the studio's API:
//      API_BASE_URL=https://studio.eggers.dev/api bun exact.mjs web-build --out target/studio-dist
//      Exact builds only into dist/ or target/ inside the app, so the build goes to target/ first.
//   3. Copy the build into studio/dist, leaving out its dot files (.exact-build.json, .exact/), and check that no
//      private data came with it: no database, nothing from .data/ or resume/.
//   4. wrangler deploy (with --dry-run: build the Worker bundle, upload nothing, sign-in not needed).
//
// A real deploy needs CLOUDFLARE_ACCOUNT_ID in the environment and wrangler's sign-in. The Worker's two secrets,
// ACCESS_TEAM_DOMAIN and ACCESS_AUD, are set once with `wrangler secret put` (see wrangler.jsonc).
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const STUDIO = resolve(import.meta.dir, '..');
const REPO = resolve(STUDIO, '..');
const ORIGIN = 'https://studio.eggers.dev';
const API = `${ORIGIN}/api`;
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
  run('wrangler deploy --dry-run (nothing is uploaded)', [WRANGLER, 'deploy', '--dry-run', '--outdir', DRY_RUN_OUT], STUDIO, env);
  console.log(`deploy: dry run done. The Worker bundle is in ${relative(REPO, DRY_RUN_OUT)}/.`);
} else {
  run('wrangler deploy', [WRANGLER, 'deploy'], STUDIO, env);
  console.log(`deploy: done. The studio is at ${ORIGIN}`);
}
