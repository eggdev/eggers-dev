// `bun tools/live.ts`: what runs on this machine for the studio at https://studio.eggers.dev.
// It starts three processes and keeps them running until Ctrl-C (SIGINT) or SIGTERM, which stops all three:
//   server  the API (server.ts) on 127.0.0.1:8787, without --watch
//   worker  the ingestion worker (worker.ts)
//   tunnel  the private Cloudflare Tunnel that carries the studio Worker's /api calls to the server
//           (`wrangler tunnel run`). It needs CLOUDFLARE_ACCOUNT_ID and wrangler's sign-in.
// A process that exits is started again after a short wait, which grows while it keeps failing. Output lines are
// prefixed with each process's name, as in tools/dev.ts.
//
//   bun tools/live.ts [--no-tunnel]
//
// --no-tunnel runs only the server and the worker. Do not run this beside `bun exact.mjs dev`: both use port 8787 and
// the same database.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const TUNNEL_ID = '0e7d85c7-d394-496c-ba49-bf9d0d39c86b';
const WRANGLER = join(root, 'studio', 'node_modules', '.bin', 'wrangler');
// The wait before a restart: 1 s, doubled after each quick failure, at most 30 s. A process that ran a minute or
// more starts again after 1 s.
const FIRST_WAIT_MS = 1_000;
const MAX_WAIT_MS = 30_000;
const STEADY_MS = 60_000;
// How long a process has to stop after SIGTERM before it is killed.
const STOP_GRACE_MS = 10_000;

function fail(message: string): never {
  console.error(`live: ${message}`);
  process.exit(1);
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

/** Whether something accepts connections on this machine's port. */
async function listening(port: number): Promise<boolean> {
  try {
    const socket = await Bun.connect({ hostname: '127.0.0.1', port, socket: { data() {} } });
    socket.end();
    return true;
  } catch {
    return false;
  }
}

const args = process.argv.slice(2);
for (const arg of args) if (arg !== '--no-tunnel') fail(`unknown argument "${arg}". Usage: bun tools/live.ts [--no-tunnel]`);
const tunnel = !args.includes('--no-tunnel');
if (running('tools/dev.ts')) fail('a dev session (tools/dev.ts) is running. It uses the same port and database. Stop it first.');
if (running('tools/live.ts')) fail('tools/live.ts is already running.');
// Two workers on one database would take the same queue; a second server could not open the port.
if (running('bun worker.ts')) fail('a worker (bun worker.ts) is already running. Stop it first.');
if (await listening(8787)) fail('something already listens on 127.0.0.1:8787 (a dev session or a server started by hand). Stop it first.');
if (tunnel && !process.env.CLOUDFLARE_ACCOUNT_ID) {
  fail('set CLOUDFLARE_ACCOUNT_ID to the Cloudflare account that holds the tunnel, or run with --no-tunnel.');
}
if (tunnel && !existsSync(WRANGLER)) fail('wrangler is not installed. Run `bun install` in studio/ first, or run with --no-tunnel.');

type Proc = { name: string; cmd: string[]; cwd: string; env: Record<string, string>; color: number };
const PROCS: Proc[] = [
  { name: 'server', cmd: ['bun', 'server.ts'], cwd: root, env: { HOST: '127.0.0.1', PORT: '8787' }, color: 36 },
  { name: 'worker', cmd: ['bun', 'worker.ts'], cwd: root, env: {}, color: 35 },
  ...(tunnel ? [{ name: 'tunnel', cmd: [WRANGLER, 'tunnel', 'run', TUNNEL_ID], cwd: join(root, 'studio'), env: { WRANGLER_SEND_METRICS: 'false' }, color: 33 }] : []),
];

const paint = process.stdout.isTTY && !process.env.NO_COLOR;
const width = Math.max(...PROCS.map((p) => p.name.length), 'live'.length);
const tagOf = (name: string, color: number) => (paint ? `\x1b[${color}m${name.padEnd(width)}\x1b[0m │ ` : `${name.padEnd(width)} | `);
const say = (line: string) => console.log(tagOf('live', 37) + line);

async function pipe(stream: ReadableStream<Uint8Array>, tag: string) {
  const decoder = new TextDecoder();
  let rest = '';
  for await (const chunk of stream) {
    const lines = (rest + decoder.decode(chunk, { stream: true })).split('\n');
    rest = lines.pop()!;
    for (const line of lines) console.log(tag + line);
  }
  if (rest) console.log(tag + rest);
}

let stopping = false;
const children = new Map<string, ReturnType<typeof Bun.spawn>>();
// Wakes every restart wait at once when the stop begins.
let wake: () => void = () => {};
const stopped = new Promise<void>((resolve) => { wake = resolve; });
const pause = (ms: number) => Promise.race([Bun.sleep(ms), stopped]);

/** Runs one process, and starts it again whenever it exits, until the stop. */
async function supervise(p: Proc) {
  const tag = tagOf(p.name, p.color);
  let wait = FIRST_WAIT_MS;
  while (!stopping) {
    const started = Date.now();
    const child = Bun.spawn(p.cmd, { cwd: p.cwd, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', env: { ...process.env, ...p.env, FORCE_COLOR: paint ? '1' : '0' } });
    children.set(p.name, child);
    const output = Promise.all([pipe(child.stdout, tag), pipe(child.stderr, tag)]);
    const code = await child.exited;
    await output.catch(() => {});
    children.delete(p.name);
    if (stopping) break;
    if (Date.now() - started >= STEADY_MS) wait = FIRST_WAIT_MS;
    say(`${p.name} exited (code ${code ?? child.signalCode}); starting it again in ${wait / 1000} s`);
    await pause(wait);
    wait = Math.min(wait * 2, MAX_WAIT_MS);
  }
}

function stop(signal: string) {
  if (stopping) return;
  stopping = true;
  say(`${signal}: stopping ${PROCS.map((p) => p.name).join(', ')}`);
  wake();
  for (const child of children.values()) child.kill('SIGTERM');
  setTimeout(() => {
    for (const [name, child] of children) {
      say(`${name} did not stop in ${STOP_GRACE_MS / 1000} s; killing it`);
      child.kill('SIGKILL');
    }
  }, STOP_GRACE_MS).unref();
}
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));

say(`running ${PROCS.map((p) => p.name).join(', ')}${tunnel ? '' : ' (no tunnel)'}. Ctrl-C stops them all.`);
await Promise.all(PROCS.map(supervise));
say('stopped');
process.exit(0);
