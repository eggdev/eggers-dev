import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { chromium } from '@playwright/test';

const studio = process.env.STUDIO_URL ?? 'http://127.0.0.1:3001';
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(studio).hostname))
  throw new Error('Browser imports currently connect only to local Studio.');
const ask = createInterface({ input: process.stdin, output: process.stdout });
async function api(action: string, input: unknown = {}) {
  const r = await fetch(`${studio}/api/studio/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error);
  return data;
}
await api('workspace');
const profile = resolve('.data/browser');
await mkdir(profile, { recursive: true });
const browser = await chromium.launchPersistentContext(profile, {
  headless: false,
  channel: process.env.BROWSER_CHANNEL || undefined,
});
try {
  const page = browser.pages()[0] ?? (await browser.newPage());
  await page.goto('https://www.trueup.io');
  console.log(
    'Sign in in the opened browser, then navigate to your saved listings or search results. This profile stays on your computer.',
  );
  await ask.question('Press Enter when the page is ready. ');
  const file = process.argv[2];
  const candidates = file
    ? (await readFile(file, 'utf8')).split(/\s+/).filter(Boolean)
    : await page
        .locator('a[href]')
        .evaluateAll((links) =>
          [...new Set(links.map((a) => (a as HTMLAnchorElement).href))].filter((url) =>
            /\/(jobs?|opportunities|positions)\//i.test(url),
          ),
        );
  if (!candidates.length)
    throw new Error(
      'No listing links found. Provide a text file of URLs: bun run import:browser listings.txt',
    );
  console.log(`Found ${candidates.length} links. Sample:\n${candidates.slice(0, 8).join('\n')}`);
  const answer = await ask.question('Import these pages into Studio? [y/N] ');
  if (answer.trim().toLowerCase() !== 'y') process.exitCode = 0;
  else {
    const family = await ask.question('Role family (optional): ');
    const queued = await api('research.queue', { urls: candidates, family });
    const workspace = await api('workspace');
    const desired = new Set<string>(
      queued.filter((row: any) => row.status !== 'invalid').map((row: any) => row.url),
    );
    const capture = await browser.newPage();
    let count = 0;
    for (const listing of workspace.listings.filter((l: any) => desired.has(l.url))) {
      try {
        await capture.goto(listing.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await capture.waitForTimeout(1500);
        const title = await capture.title();
        if (/sign in|log in|access denied|just a moment/i.test(title)) {
          console.log(`Needs attention in browser: ${listing.url}`);
          continue;
        }
        const content = await capture
          .locator('main, [role="main"], article')
          .first()
          .innerText({ timeout: 5000 })
          .catch(() => capture.locator('body').innerText());
        const result = await api('research.capture', {
          id: listing.id,
          title,
          description: content.slice(0, 100000),
          method: 'browser-visible-v1',
        });
        console.log(`${++count}/${desired.size} ${result.status}: ${listing.url}`);
      } catch (error) {
        console.error(
          `Could not capture ${listing.url}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
    console.log(
      'Capture finished. In Studio → Job research, choose Process with Eve to extract requirements.',
    );
  }
} finally {
  ask.close();
  await browser.close();
}
