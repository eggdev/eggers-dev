// For the route tests only (`bun test lib`): starts server.ts on a scratch database and a port the system chooses (PORT=0),
// and reads the address back from the server's first line. Two test runs at once never meet on one port: a port picked
// by the test and freed for the server could be taken by the other run in between.
import { resolve } from 'node:path';

export async function startServer(env: Record<string, string>): Promise<{ base: string; server: ReturnType<typeof Bun.spawn> }> {
  const server = Bun.spawn(['bun', 'server.ts', '--stub-github'], { cwd: resolve(import.meta.dir, '..'), stdout: 'pipe', stderr: 'ignore',
    env: { ...process.env, ...env, HOST: '127.0.0.1', PORT: '0', NODE_ENV: 'test' } });
  const reader = (server.stdout as ReadableStream<Uint8Array>).getReader(), text = new TextDecoder();
  let seen = '', base = '';
  const until = Date.now() + 60_000;
  while (base === '' && Date.now() < until) {
    const { value, done } = await reader.read();
    if (done) break;
    seen += text.decode(value);
    base = /server\.ts: (http:\/\/127\.0\.0\.1:\d+)/.exec(seen)?.[1] ?? '';
  }
  // The rest of what the server prints is read and dropped, so its pipe never fills.
  void (async () => { try { for (;;) { if ((await reader.read()).done) return; } } catch { /* the server stopped */ } })();
  if (base === '') { server.kill(); throw new Error('The test server did not say where it listens.'); }
  for (let i = 0; i < 300; i++) { try { if ((await fetch(`${base}/health`)).ok) return { base, server }; } catch { /* not up yet */ } await Bun.sleep(100); }
  server.kill();
  throw new Error('The test server did not start.');
}
