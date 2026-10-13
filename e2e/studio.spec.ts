import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import { Client } from 'eve/client';

const base = 'http://127.0.0.1:3001';
test('owner can build and correct the bank; layout works on mobile', async ({ page }) => {
  await page.goto(base);
  await expect(page.getByRole('heading', { name: 'Start with what you remember.' })).toBeVisible();
  await page.getByRole('button', { name: 'Add a role', exact: true }).click();
  await page.getByLabel('Role title', { exact: true }).fill('Product Engineer');
  await page.getByLabel('Company', { exact: true }).fill('Test Company');
  await page.getByRole('button', { name: 'Add role', exact: true }).click();
  await page.getByRole('button', { name: 'Knowledge bank', exact: true }).click();
  await page.getByRole('button', { name: 'Add entry' }).click();
  await page.getByLabel('Title', { exact: true }).fill('A qualitative story');
  const editor = page.getByRole('textbox', {
    name: 'The story, your contribution, and what happened…',
  });
  await editor.focus();
  await editor.evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', '## Recall\n\n- A useful detail');
    element.dispatchEvent(
      new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }),
    );
  });
  await expect(editor.locator('h2')).toHaveText('Recall');
  await expect(editor.locator('li')).toContainText('A useful detail');

  await page
    .getByRole('textbox', { name: 'The story, your contribution, and what happened…' })
    .fill('I helped the team untangle a difficult launch.');
  await page.getByRole('button', { name: 'Save entry' }).click();
  await expect(page.getByRole('button', { name: /A qualitative story/ })).toBeVisible();
  await page.getByRole('button', { name: /A qualitative story/ }).click();
  await page
    .getByRole('textbox', { name: 'The story, your contribution, and what happened…' })
    .fill('I documented the tradeoffs and coordinated the launch.');
  await page.getByRole('button', { name: 'Save entry' }).click();
  await expect(
    page.getByText('I documented the tradeoffs and coordinated the launch.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('switch', { name: 'Review Eve’s edits' }).check();
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  await page.reload();
  await expect(page.getByText('Review changes', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Interview map', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Follow the threads.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
test('real Eve transport persists turns, resumes streams and purges deleted source content', async ({
  request,
}) => {
  const op = async (action: string, input: unknown = {}) => {
    const r = await request.post(`${base}/api/studio/${action}`, { data: input });
    expect(r.ok(), await r.text()).toBeTruthy();
    return r.json();
  };
  const thread = await op('threads.create', { title: 'Runtime persistence test' });
  const marker = `private-marker-${randomUUID()}`;
  const client = new Client({ host: base, headers: { 'x-studio-thread-id': thread.id } });
  const { session, response } = await client.sessions.create({
    message: marker,
    signal: AbortSignal.timeout(30000),
  });
  expect((await response.result()).message).toContain(marker);
  expect((await (await session.send('Continue')).result()).message).toBe('Turn 2: Continue');
  const snapshot = await client.sessions.attach(session.state.sessionId).snapshot();
  expect(
    snapshot.events.some((e) => e.type === 'message.received' && e.data.message === marker),
  ).toBe(true);
  const saved = await op('threads.get', { id: thread.id });
  expect(saved.messages).toHaveLength(4);
  const entry = await op('entries.save', {
    title: 'Delete this memory',
    markdown: marker,
    skills: [],
    sourceMessageIds: [saved.messages[0].id],
  });
  const root = resolve('tests/fixtures/eve/.eve/.workflow-data');
  function hasMarker(buffer: Buffer): boolean {
    if (buffer.includes(Buffer.from(marker))) return true;
    if (buffer.subarray(0, 4).toString() === 'zstd') {
      return hasMarker(zstdDecompressSync(buffer.subarray(4)));
    }
    try {
      const visit = (value: any): boolean => {
        if (!value || typeof value !== 'object') return false;
        if (value.__type === 'Uint8Array' && typeof value.data === 'string')
          return hasMarker(Buffer.from(value.data, 'base64'));
        return Object.values(value).some(visit);
      };
      return visit(JSON.parse(buffer.toString()));
    } catch {
      return false;
    }
  }
  async function contains(path: string): Promise<boolean> {
    for (const file of await readdir(path, { withFileTypes: true }).catch(() => [])) {
      const name = resolve(path, file.name);
      if (file.isDirectory()) {
        if (await contains(name)) return true;
      } else if (hasMarker(await readFile(name).catch(() => Buffer.alloc(0)))) return true;
    }
    return false;
  }
  expect(await contains(root)).toBe(true);
  await op('entries.delete', { id: entry.id });
  await expect.poll(() => contains(root), { timeout: 20000 }).toBe(false);
  const after = await op('threads.get', { id: thread.id });
  expect(after.thread.session).toBeNull();
  expect(after.messages.some((m: any) => m.body.includes(marker))).toBe(false);
  expect((await client.health()).status).toBe('ready');
});
test('cross-origin writes and unauthenticated internal calls are rejected', async ({ request }) => {
  await expect(new Client({ host: base }).sessions.create()).rejects.toThrow();
  expect(
    (
      await request.post(`${base}/api/studio/roles.save`, {
        headers: { origin: 'https://evil.example' },
        data: { title: 'No' },
      })
    ).status(),
  ).toBe(403);
  expect(
    (await request.post(`${base}/api/internal`, { data: { action: 'workspace' } })).status(),
  ).toBe(401);
});
test('public holding page saves a single launch signup and honors reduced motion', async ({
  page,
  request,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('http://127.0.0.1:3000');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Making room');
  await page.getByLabel('Let me know when it’s ready').fill('launch@example.com');
  await page.getByRole('button', { name: 'Notify me at launch' }).click();
  await expect(page.getByRole('status')).toContainText('You’re on the list');
  expect(
    (
      await request.post('http://127.0.0.1:3000/api/subscribe', { data: { email: 'invalid' } })
    ).status(),
  ).toBe(400);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: '.data/public-mobile.png', fullPage: true });
});

test('conversation UI streams Markdown and reloads saved history', async ({ page }) => {
  await page.goto(base);
  await page.getByRole('button', { name: 'New conversation', exact: true }).first().click();
  await page.getByLabel('Conversation title').fill('Browser conversation');
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await page.getByRole('textbox', { name: 'Talk with Eve…' }).fill('I built a useful interface.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(
    page.getByText('Turn 1: I built a useful interface.', { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: '.data/studio-conversation.png', fullPage: true });
  await page.reload();
  await page.getByRole('button', { name: 'Browser conversation', exact: true }).first().click();
  await expect(
    page.getByText('Turn 1: I built a useful interface.', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Talk with Eve…' })
    .fill('We learned to document the decisions.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(
    page.getByText('Turn 2: We learned to document the decisions.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Delete conversation and its linked entries' }).click();
  await expect(page.getByRole('heading', { name: 'Start with what you remember.' })).toBeVisible();
});

test('Eve career tools write source-linked knowledge and obey the review switch', async ({
  request,
}) => {
  const op = async (action: string, input: unknown = {}) => {
    const response = await request.post(`${base}/api/studio/${action}`, { data: input });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  };
  const settings = (await op('workspace')).settings;
  for (const reviewRequired of [false, true]) {
    await op('settings.save', { ...settings, reviewRequired });
    const thread = await op('threads.create', { title: `Tool review ${reviewRequired}` });
    const client = new Client({ host: base, headers: { 'x-studio-thread-id': thread.id } });
    const { session, response } = await client.sessions.create({
      message: `Fixture save: I coordinated a launch, review=${reviewRequired}`,
    });
    expect((await response.result()).message).toBe('Saved through the career tool.');
    const state = await op('workspace');
    const source = (await op('threads.get', { id: thread.id })).messages[0];
    if (reviewRequired) {
      const proposal = state.proposals.find((p: any) =>
        p.payload.sourceMessageIds?.includes(source.id),
      );
      expect(proposal).toBeTruthy();
      expect(state.entries.some((e: any) => e.source_message_ids?.includes(source.id))).toBe(false);
      await op('proposals.accept', { id: proposal.id });
    } else
      expect(state.entries.some((e: any) => e.source_message_ids?.includes(source.id))).toBe(true);
    await session.reset({ reason: 'Tool test complete' });
    await op('threads.delete', { id: thread.id });
  }
  await op('settings.save', settings);
});
