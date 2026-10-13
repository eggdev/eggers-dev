import { type ChildProcess, spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { Client } from 'eve/client';

test('Eve resumes a durable conversation after a process restart', async () => {
  await mkdir('.data', { recursive: true });
  const root = await mkdtemp(resolve('.data/restart-'));
  await mkdir(`${root}/agent/channels`, { recursive: true });
  await writeFile(
    `${root}/package.json`,
    JSON.stringify({ name: 'restart-fixture', type: 'module', dependencies: { eve: '0.78.0' } }),
  );
  await cp('tests/fixtures/eve/agent/agent.ts', `${root}/agent/agent.ts`);
  await cp('tests/fixtures/eve/agent/instructions.md', `${root}/agent/instructions.md`);
  await cp('tests/fixtures/eve/agent/instrumentation', `${root}/agent/instrumentation`, {
    recursive: true,
  });
  await writeFile(
    `${root}/agent/channels/eve.ts`,
    "import {eveChannel,defaultEveAuth} from 'eve/channels/eve'; import {localDev} from 'eve/channels/auth'; export default eveChannel({auth:[localDev()],onMessage:ctx=>({auth:defaultEveAuth(ctx),title:'Test conversation'})});",
  );
  const client = new Client({ host: 'http://127.0.0.1:4319' });
  let process: ChildProcess | undefined;
  let output = '';
  async function start() {
    process = spawn(
      'node',
      [
        resolve('node_modules/eve/bin/eve.js'),
        'dev',
        '--resume',
        '--no-ui',
        '--no-default-extensions',
        '--host',
        '127.0.0.1',
        '--port',
        '4319',
      ],
      {
        cwd: root,
        env: { ...globalThis.process.env, EVE_TELEMETRY_DISABLED: '1', EVE_TRACES: 'off' },
      },
    );
    process.stdout?.on('data', (data) => (output += data));
    process.stderr?.on('data', (data) => (output += data));
    await expect
      .poll(
        async () => {
          try {
            return (await client.health()).status;
          } catch {
            return output.includes('Discovery failed') ? output : 'starting';
          }
        },
        { timeout: 20000 },
      )
      .toBe('ready');
  }
  async function stop() {
    if (!process || process.exitCode !== null) return;
    const current = process;
    await new Promise<void>((done) => {
      current.once('exit', () => done());
      current.kill('SIGTERM');
    });
    process = undefined;
  }
  try {
    await start();
    const { session, response } = await client.sessions.create({
      message: 'First remembered event',
    });
    expect((await response.result()).message).toBe('Turn 1: First remembered event');
    const state = session.state;
    await stop();
    await start();
    const resumed = client.sessions.attach(state.sessionId, { streamIndex: state.streamIndex });
    expect((await (await resumed.send('A second memory')).result()).message).toBe(
      'Turn 2: A second memory',
    );
    await resumed.reset({ reason: 'Test complete' });
  } finally {
    await stop();
    await rm(root, { recursive: true, force: true });
  }
});
