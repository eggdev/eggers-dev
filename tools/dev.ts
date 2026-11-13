// `bun exact.mjs dev`: the API server, the ingestion worker and the web dev loop together.
// With mprocs installed and a terminal attached, each runs in its own tab (mprocs.yaml).
// Otherwise their output is interleaved here, each line prefixed with its name.
// Ctrl-C stops all three; if one exits on its own, the others are stopped too.
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
// The server restarts on save. The worker does not: a restart would abandon a long reading.
// EGG_REMOTE makes it reachable from another device on the tailnet. Given this machine's Tailscale
// name (….ts.net), everything listens on this machine only and Tailscale Serve carries it over HTTPS:
//   tailscale serve --bg --https=443 8765 ; tailscale serve --bg --https=8443 8787
// HTTPS matters: over plain http a browser holds a downloaded PDF back as insecure and refuses the
// clipboard. Given a Tailscale address instead, it is served over plain http on that address (the old way).
const remote = process.env.EGG_REMOTE ?? '';
const secure = remote.endsWith('.ts.net');
const env = !remote ? {} : secure ? { HOST: '127.0.0.1', API_BASE_URL: `https://${remote}:8443` } : { HOST: remote, API_BASE_URL: `http://${remote}:8787` };
export const PROCS = [
  { name: 'server', cmd: ['bun', '--watch', 'server.ts'], color: 36 },
  { name: 'worker', cmd: ['bun', 'worker.ts'], color: 35 },
  { name: 'web', cmd: ['bun', 'exact.mjs', 'web', ...(!remote ? [] : secure ? ['--allow-host', remote] : ['--lan', '--allow-host', remote])], color: 32 },
];
if (remote) console.log(secure ? `dev: reachable on the tailnet at https://${remote} (API https://${remote}:8443)` : `dev: reachable on the tailnet at http://${remote}:8765 (API http://${remote}:8787)`);

if (process.stdout.isTTY && Bun.which('mprocs') && !process.argv.includes('--plain')) {
  const tabs = Bun.spawn(['mprocs', '--config', join(root, 'mprocs.yaml')], { cwd: root, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' });
  process.exit(await tabs.exited);
}

const paint = process.stdout.isTTY && !process.env.NO_COLOR;
const width = Math.max(...PROCS.map((p) => p.name.length));
async function pipe(stream: ReadableStream<Uint8Array>, name: string, color: number) {
  const tag = paint ? `\x1b[${color}m${name.padEnd(width)}\x1b[0m │ ` : `${name.padEnd(width)} | `;
  const decoder = new TextDecoder();
  let rest = '';
  for await (const chunk of stream) {
    const lines = (rest + decoder.decode(chunk, { stream: true })).split('\n');
    rest = lines.pop()!;
    for (const line of lines) console.log(tag + line);
  }
  if (rest) console.log(tag + rest);
}

const running = PROCS.map((p) => {
  const child = Bun.spawn(p.cmd, { cwd: root, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', env: { ...process.env, ...env, FORCE_COLOR: paint ? '1' : '0' } });
  pipe(child.stdout, p.name, p.color);
  pipe(child.stderr, p.name, p.color);
  return { ...p, child };
});

let stopping = false;
const stop = (why: string) => {
  if (stopping) return;
  stopping = true;
  console.log(why);
  for (const r of running) r.child.kill();
};
process.on('SIGINT', () => stop('\ndev: stopping'));
process.on('SIGTERM', () => stop('dev: stopping'));

const first = await Promise.race(running.map((r) => r.child.exited.then((code) => ({ name: r.name, code }))));
stop(`dev: ${first.name} exited (code ${first.code}), so the others are stopped too`);
await Promise.all(running.map((r) => r.child.exited));
process.exit(stopping && first.code === 0 ? 0 : first.code ?? 1);
