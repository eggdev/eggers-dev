// `bun cloud/keeper.ts`: the main process of the studio's container (under tini, which forwards signals). It is the
// only thing that starts the app's server and worker. In order (cloud/lib/keeper.ts):
//   1. Restore the newest good backup from the private bucket into the data folder, or refuse to start the app.
//   2. Self-test the programs the app runs (Codex, Chromium, git, gh, pandoc) and Codex's sign-in and sandbox.
//   3. Run `bun server.ts` and `bun worker.ts`, and start either again if it exits.
//   4. Back up when the data changed and then was quiet for a while.
//   5. On SIGTERM or SIGINT: stop both, back up anything unsaved, exit 0.
//      A Codex sign-in that waits is stopped first, and no new one starts from then on.
// A control endpoint on KEEPER_PORT (8788) answers the Durable Object that owns the container (lib/control.ts,
// which the tests call without a server):
//   GET  /status         the keeper's state as JSON: no data and no secrets. While a Codex sign-in waits, its
//                        `codexLogin` holds the address and the one-time code the owner types there.
//   POST /backup         back up now and wait for it
//   POST /codex/login    start a Codex sign-in in the container (lib/codexlogin.ts); the answer has the address and
//                        the code. A second call while one waits answers with the same two.
//   POST /codex/cancel   stop a sign-in that waits
// All need the start's token (header x-egg-token). Nothing else is served.
//
// Environment (the image sets the fixed ones; the Durable Object passes the rest when it starts the container):
//   DB                 the database file; its folder is the data folder (image: /data/egg.db)
//   CODEX_HOME         the Codex sign-in folder (image: /data/codex), backed up with the data
//   KEEPER_WORK        the keeper's folder for copies and downloads (image: /var/lib/keeper)
//   EGG_BACKUP_URL     the backup gateway (http://backup.internal), reached through the Worker's outbound intercept
//   EGG_BACKUP_TOKEN   this start's token for the gateway and the control endpoint. Never passed to the app.
//   EGG_ALLOW_EMPTY=1  start with an empty data folder when the store holds no backup yet
//   EGG_ALLOW_SHRINK=1 allow a backup much smaller than the last one to become the one to restore
//   EGG_QUIET_MS, EGG_MAX_WAIT_MS   the backup's quiet period and longest wait (defaults 45 s and 5 minutes)
import { dirname, join, resolve } from 'node:path';
import { spawnChild } from './lib/children.ts';
import { spawnLogin } from './lib/codexlogin.ts';
import { Control } from './lib/control.ts';
import { Keeper } from './lib/keeper.ts';
import { codexSignIn, selfTest } from './lib/selftest.ts';
import { HttpStore } from './lib/store.ts';

const env = process.env;
const APP = resolve(import.meta.dir, '..');
const DB = resolve(env.DB ?? '/data/egg.db');
const CODEX_HOME = env.CODEX_HOME ? resolve(env.CODEX_HOME) : join(dirname(DB), 'codex');
const WORK = resolve(env.KEEPER_WORK ?? '/var/lib/keeper');
const PORT = Number(env.KEEPER_PORT ?? 8788);
const APP_PORT = Number(env.PORT ?? 8787);
const TOKEN = env.EGG_BACKUP_TOKEN ?? '';
const BACKUP_URL = (env.EGG_BACKUP_URL ?? 'http://backup.internal').replace(/\/+$/, '');
const log = (line: string) => console.log(`keeper | ${line}`);

if (TOKEN.length < 32) {
  log('EGG_BACKUP_TOKEN is missing or short. The Durable Object passes it when it starts the container. Not starting.');
  process.exit(1);
}

// The app's environment: everything the container has, except what belongs to the keeper alone.
const KEEPER_ONLY = ['EGG_BACKUP_TOKEN', 'EGG_BACKUP_URL', 'EGG_ALLOW_EMPTY', 'EGG_ALLOW_SHRINK', 'KEEPER_PORT', 'KEEPER_WORK'];
const appEnv: Record<string, string> = {};
for (const [k, v] of Object.entries(env)) if (v !== undefined && !KEEPER_ONLY.includes(k)) appEnv[k] = v;
Object.assign(appEnv, { DB, CODEX_HOME, HOST: '0.0.0.0', PORT: String(APP_PORT) });

// Cloudflare gives every process in a container root's capabilities, whatever its user. The app does not need
// them, and bubblewrap, which Codex's sandbox is built on, refuses to run with them ("Unexpected capabilities but
// not setuid"). So the server, the worker and everything they start run with every capability dropped.
const DROP = ['setpriv', '--ambient-caps=-all', '--inh-caps=-all', '--bounding-set=-all', '--'];
const plain = Bun.which('setpriv') && Bun.spawnSync([...DROP, 'true'], { stdout: 'ignore', stderr: 'ignore' }).exitCode === 0 ? DROP : [];
log(plain.length ? 'the app runs with no capabilities' : 'setpriv could not drop capabilities; the app keeps the ones the container gives it');

const keeper = new Keeper({
  store: new HttpStore(BACKUP_URL, TOKEN),
  layout: { db: DB, codexHome: CODEX_HOME },
  work: WORK,
  allowEmpty: env.EGG_ALLOW_EMPTY === '1',
  allowShrink: env.EGG_ALLOW_SHRINK === '1',
  children: [
    { name: 'server', cmd: [...plain, 'bun', 'server.ts'], cwd: APP, env: appEnv },
    { name: 'worker', cmd: [...plain, 'bun', 'worker.ts'], cwd: APP, env: appEnv },
  ],
  spawn: spawnChild,
  selfTest: () => selfTest({ CHROME: env.CHROME, CODEX_BIN: env.CODEX_BIN, codexEnv: appEnv, prefix: plain }),
  log,
  quietMs: env.EGG_QUIET_MS ? Number(env.EGG_QUIET_MS) : undefined,
  maxWaitMs: env.EGG_MAX_WAIT_MS ? Number(env.EGG_MAX_WAIT_MS) : undefined,
});

// The app's own readiness view, from lib/llm.ts when that file has it: the same checks the app makes. It runs
// after the restore, when the Codex sign-in is in place.
let llm: { ok: boolean; detail: string } | null = null;
async function checkLlm() {
  try {
    const mod = (await import(join(APP, 'lib', 'llm.ts'))) as { llmReady?: () => Promise<{ ok: boolean; detail: string }> };
    if (!mod.llmReady) return;
    // llmReady reads the backend and the Codex home from the environment: set the app's for the call.
    for (const k of ['CODEX_HOME', 'EGG_LLM', 'CODEX_BIN']) if (appEnv[k] !== undefined) process.env[k] = appEnv[k];
    llm = await mod.llmReady();
  } catch (error) {
    llm = { ok: false, detail: `lib/llm.ts could not be checked (${(error as Error).message})` };
  }
}

/** Whether the app's server answers its health check. */
async function serverHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${APP_PORT}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

// The control endpoint, with the Codex sign-in made here in the container. The sign-in's command runs as the app's
// own Codex runs: the app's environment (CODEX_HOME in it, the backup token not) and no capabilities. After a
// sign-in: the check again, the readiness view again, and a backup at once (lib/control.ts joins it to the keeper).
const control = new Control({
  token: TOKEN,
  keeper,
  login: {
    spec: { cmd: [...plain, env.CODEX_BIN || 'codex', 'login', '--device-auth'], cwd: APP, env: appEnv },
    spawn: spawnLogin,
    check: () => codexSignIn({ CODEX_BIN: env.CODEX_BIN, codexEnv: appEnv, prefix: plain }),
    refresh: checkLlm,
    log,
  },
  serverHealthy,
  llm: () => llm,
});

Bun.serve({ hostname: '0.0.0.0', port: PORT, fetch: (request) => control.fetch(request) });
log(`control endpoint on port ${PORT}; data folder ${dirname(DB)}`);

const onSignal = (signal: string) => void control.shutdown(signal).then((code) => process.exit(code));
process.on('SIGTERM', () => onSignal('SIGTERM'));
process.on('SIGINT', () => onSignal('SIGINT'));

await keeper.start();
if (keeper.status().phase === 'running') void checkLlm();
