import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

const app = process.argv[2];
if (!['studio', 'web'].includes(app)) throw new Error('Choose studio or web');
const env = {
  ...process.env,
  // An explicit disposable store must win over app-local Neon environment files.
  ...(process.env.LOCAL_DATA_DIR ? { DATABASE_URL: '' } : {}),
  STUDIO_INTERNAL_TOKEN: process.env.STUDIO_INTERNAL_TOKEN ?? randomBytes(32).toString('hex'),
  STUDIO_INTERNAL_URL: process.env.STUDIO_INTERNAL_URL ?? 'http://127.0.0.1:3001',
  EVE_TELEMETRY_DISABLED: '1',
  EVE_TRACES: 'off',
};
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 500).unref();
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop());
function start(command, args, cwd) {
  const child = spawn(command, args, { cwd, env, stdio: 'inherit' });
  children.push(child);
  child.on('error', (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on('exit', (code) => {
    if (!stopping) stop(code || 1);
  });
  return child;
}
if (app === 'studio') {
  const port = process.env.EVE_PORT ?? '4317';
  env.EVE_BASE_URL = `http://127.0.0.1:${port}`;
  const root = process.env.EVE_TEST_FIXTURE === '1' ? 'tests/fixtures/eve' : 'apps/studio';
  start(
    process.execPath,
    [
      resolve('node_modules/eve/bin/eve.js'),
      'dev',
      '--resume',
      '--no-ui',
      '--no-default-extensions',
      '--host',
      '127.0.0.1',
      '--port',
      port,
    ],
    resolve(root),
  );
  let ready = false;
  for (let i = 0; i < 120 && !stopping; i++) {
    try {
      const response = await fetch(`${env.EVE_BASE_URL}/eve/v1/health`);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) {
    console.error('Eve did not become ready.');
    stop(1);
  }
}
if (!stopping) start('bun', ['run', '--cwd', `apps/${app}`, 'dev']);
