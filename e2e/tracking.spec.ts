import { expect, test } from '@playwright/test';

const base = 'http://127.0.0.1:3001';
test('track an application, retain history, manage follow-ups, and reload on mobile', async ({
  page,
  request,
}) => {
  const response = await request.post(`${base}/api/studio/research.queue`, {
    data: { urls: ['https://example.com/jobs/browser-tracker'] },
  });
  expect(response.ok()).toBeTruthy();
  const workspace = await (await request.post(`${base}/api/studio/workspace`, { data: {} })).json();
  const listing = workspace.listings.find((l: any) => l.url.includes('browser-tracker'));
  const tracking = await request.post(`${base}/api/studio/jobs.track`, {
    data: {
      listingId: listing.id,
      title: 'Product Engineer',
      company: 'Tracker Example',
      stage: 'applied',
      source: 'TrueUp',
    },
  });
  expect(tracking.ok()).toBeTruthy();
  const { job } = await tracking.json();
  await page.goto(base);
  await page.getByRole('button', { name: 'Job tracker', exact: true }).click();
  await page.getByRole('button', { name: /Product Engineer\s*Tracker Example/ }).click();
  await expect(page.getByText('Date unknown', { exact: true })).toBeVisible();
  await page.getByLabel('Current stage', { exact: true }).selectOption('interviewing');
  await page.getByLabel('Stage date, if known', { exact: true }).fill('2026-10-12');
  await page.getByLabel('Next action', { exact: true }).fill('Send portfolio to recruiter');
  await page.getByLabel('Due date', { exact: true }).fill('2020-01-01');
  await page.getByRole('button', { name: 'Save job', exact: true }).click();
  await expect(page.getByText('Stage changed to interviewing', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'All tracked jobs', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Follow-ups' }).getByText(/Overdue/)).toBeVisible();
  await page.getByRole('button', { name: /Product Engineer\s*Tracker Example/ }).click();
  await page.getByRole('button', { name: 'Complete next action', exact: true }).click();
  await expect(page.getByLabel('Next action', { exact: true })).toHaveValue('');
  await expect(
    page
      .getByRole('region', { name: 'Job timeline' })
      .getByText('Send portfolio to recruiter', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Add activity', exact: true }).click();
  await page.getByLabel('Activity type', { exact: true }).selectOption('interview');
  await page.getByLabel('Activity title', { exact: true }).fill('Recruiter screening');
  await page.getByLabel('Activity date', { exact: true }).fill('2026-10-12');
  await page
    .getByLabel('Activity notes', { exact: true })
    .fill('Discussed the team and interview process.');
  await page.getByRole('button', { name: 'Save activity', exact: true }).click();
  await expect(page.getByText('Recruiter screening', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Job tracker', exact: true }).click();
  await page.getByRole('button', { name: /Product Engineer\s*Tracker Example/ }).click();
  await expect(page.getByLabel('Current stage', { exact: true })).toHaveValue('interviewing');
  await expect(page.getByText('Recruiter screening', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Remove tracked job and timeline', exact: true }).click();
  await expect(
    page.getByRole('button', { name: /Product Engineer\s*Tracker Example/ }),
  ).toHaveCount(0);
  const missing = await request.post(`${base}/api/studio/jobs.get`, { data: { id: job.id } });
  expect(missing.status()).toBe(404);
  const source = await request.post(`${base}/api/studio/research.get`, {
    data: { id: listing.id },
  });
  expect(source.ok()).toBeTruthy();
});
