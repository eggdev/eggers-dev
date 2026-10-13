import type { Page } from '@playwright/test';
import type { JobStage } from '@repo/domain/tracking-types';

export interface TrueUpJob {
  url: string;
  title: string;
  company: string;
  location: string;
  sourceStatus: string;
  sourceDetails: string;
  stage: JobStage;
}
export async function readTrueUpTracker(
  page: Page,
  noOfferStage: 'closed' | 'rejected' = 'closed',
): Promise<TrueUpJob[]> {
  if (!['trueup.io', 'www.trueup.io'].includes(new URL(page.url()).hostname))
    throw new Error('Open your signed-in TrueUp tracker first.');
  await page.goto('https://www.trueup.io/jobtracker', { waitUntil: 'domcontentloaded' });
  const jobs = new Map<string, TrueUpJob>();
  for (const tabName of ['Saved', 'In Progress', 'Done']) {
    const tab = page.getByRole('button', { name: new RegExp(`^${tabName}\\s*\\d+$`) });
    await tab.waitFor({ timeout: 30000 });
    const expected = Number((await tab.innerText()).match(/\d+/)?.[0]);
    if (!Number.isFinite(expected)) throw new Error(`Could not read ${tabName} count.`);
    await tab.click();
    const cards = page
      .locator('[data-slot="card-content"]')
      .filter({ has: page.getByRole('combobox') });
    for (let tries = 0; tries < 30 && (await cards.count()) !== expected; tries++)
      await page.waitForTimeout(200);
    const rows = await cards.evaluateAll((elements) =>
      elements.map((card) => {
        const a = card.querySelector<HTMLAnchorElement>('a[target="_blank"]');
        const company = card.querySelector<HTMLAnchorElement>('a[href^="/co/"]');
        return {
          url: a?.href ?? '',
          title: a?.textContent?.trim() ?? '',
          company: company?.textContent?.trim() ?? '',
          location: company?.parentElement?.querySelector('span')?.textContent?.trim() ?? '',
          sourceStatus: card.querySelector('[role="combobox"]')?.textContent?.trim() ?? '',
          sourceDetails: (card as HTMLElement).innerText,
        };
      }),
    );
    if (rows.length !== expected)
      throw new Error(
        `TrueUp ${tabName} shows ${expected} jobs but only ${rows.length} cards loaded. No partial import was made.`,
      );
    for (const row of rows) {
      const stages: Record<string, JobStage> = {
        'Job saved': 'saved',
        Applied: 'applied',
        Interviewing: 'interviewing',
        Offer: 'offer',
        'Offer received': 'offer',
        'No offer': noOfferStage,
        Withdrawn: 'withdrawn',
        Closed: 'closed',
      };
      const stage = stages[row.sourceStatus];
      if (!stage || !row.url || !row.title)
        throw new Error(
          `Unrecognized TrueUp row or status: ${row.sourceStatus}. Review the source before importing.`,
        );
      jobs.set(row.url, { ...row, stage });
    }
  }
  return [...jobs.values()];
}
