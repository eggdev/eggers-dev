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
  await page.getByRole('tab', { name: /In Progress/ }).click();
  await page
    .getByRole('button', { name: 'Details for Product Engineer at Tracker Example', exact: true })
    .click();
  await expect(page.getByText('Date unknown', { exact: true })).toBeVisible();
  await page.getByLabel('Current stage', { exact: true }).selectOption('interviewing');
  await page.getByLabel('Stage date, if known', { exact: true }).fill('2026-10-12');
  await page.getByLabel('Next action', { exact: true }).fill('Send portfolio to recruiter');
  await page.getByLabel('Due date', { exact: true }).fill('2020-01-01');
  await page.getByRole('button', { name: 'Save job', exact: true }).click();
  await expect(page.getByText('Stage changed to interviewing', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'All tracked jobs', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Follow-ups' }).getByText(/Overdue/)).toBeVisible();
  await page
    .getByRole('button', { name: 'Details for Product Engineer at Tracker Example', exact: true })
    .click();
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
  await page.getByRole('tab', { name: /In Progress/ }).click();
  await page
    .getByRole('button', { name: 'Details for Product Engineer at Tracker Example', exact: true })
    .click();
  await expect(page.getByLabel('Current stage', { exact: true })).toHaveValue('interviewing');
  await expect(page.getByText('Recruiter screening', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Remove tracked job and timeline', exact: true }).click();
  await expect(
    page.getByRole('button', {
      name: 'Details for Product Engineer at Tracker Example',
      exact: true,
    }),
  ).toHaveCount(0);
  const missing = await request.post(`${base}/api/studio/jobs.get`, { data: { id: job.id } });
  expect(missing.status()).toBe(404);
  const source = await request.post(`${base}/api/studio/research.get`, {
    data: { id: listing.id },
  });
  expect(source.ok()).toBeTruthy();
});

test('stage tabs update inline, ghosted applications appear in Done, and can be reopened', async ({
  page,
  request,
}) => {
  const fixtures = [
    { title: 'Saved role', stage: 'saved' },
    { title: 'Old application', stage: 'applied', happenedOn: '2020-01-01' },
    { title: 'Undated application', stage: 'applied' },
    { title: 'Negotiation', stage: 'negotiating' },
    { title: 'Accepted offer', stage: 'offer_accepted' },
  ];
  const ids: string[] = [];
  for (const [i, fixture] of fixtures.entries()) {
    const response = await request.post(`${base}/api/studio/jobs.track`, {
      data: { ...fixture, url: `https://example.com/stage-tabs/${i}`, company: 'Stage Example' },
    });
    expect(response.ok()).toBeTruthy();
    ids.push((await response.json()).job.id);
  }
  await page.goto(base);
  await page.getByRole('button', { name: 'Job tracker', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Saved 1', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('tab', { name: 'In Progress 2', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Done 2', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Saved role', exact: true })).toHaveAttribute(
    'target',
    '_blank',
  );
  await page
    .getByLabel('Status for Saved role at Stage Example', { exact: true })
    .selectOption('applied');
  await expect(page.getByRole('tab', { name: 'Saved 0', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'In Progress 3', exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('moved to In Progress');
  await page.getByRole('tab', { name: /In Progress/ }).click();
  await expect(page.getByLabel('Status for Undated application at Stage Example')).toHaveValue(
    'applied',
  );
  await page.getByRole('tab', { name: /Done/ }).click();
  await expect(page.getByLabel('Status for Old application at Stage Example')).toHaveValue(
    'ghosted',
  );
  await expect(page.getByText('14+ days in Applied', { exact: true })).toBeVisible();
  await page.getByLabel('Status for Old application at Stage Example').selectOption('applied');
  await expect(page.getByRole('tab', { name: 'Done 1', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: /In Progress/ }).click();
  await expect(page.getByLabel('Status for Old application at Stage Example')).toHaveValue(
    'applied',
  );
  await page.getByLabel('Status for Saved role at Stage Example').selectOption('negotiating');
  await expect(page.getByLabel('Status for Saved role at Stage Example')).toHaveValue(
    'negotiating',
  );
  await page.reload();
  await page.getByRole('button', { name: 'Job tracker', exact: true }).click();
  await page.getByRole('tab', { name: /In Progress/ }).click();
  await expect(page.getByLabel('Status for Saved role at Stage Example')).toHaveValue(
    'negotiating',
  );
  await page.getByLabel('Search tracked jobs').fill('Undated');
  await expect(page.getByRole('article')).toHaveCount(1);
  await page.getByLabel('Search tracked jobs').fill('');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page
    .getByRole('button', {
      name: 'Remove Undated application at Stage Example from tracker',
      exact: true,
    })
    .click();
  await expect(page.getByLabel('Status for Undated application at Stage Example')).toHaveCount(0);
  for (const id of ids) await request.post(`${base}/api/studio/jobs.delete`, { data: { id } });
});
