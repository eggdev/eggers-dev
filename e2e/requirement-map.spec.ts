import { expect, test } from '@playwright/test';

const base = process.env.STUDIO_TEST_URL ?? 'http://127.0.0.1:3001';
test('requirement hierarchy preserves evidence, supports corrections and fits mobile', async ({
  page,
  request,
}) => {
  const op = async (action: string, input: unknown = {}) => {
    const response = await request.post(`${base}/api/studio/${action}`, { data: input });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  };
  const url = 'https://example.com/requirement-map-fixture';
  const quote = 'Experience preparing repositories for coding agents is preferred.';
  await op('research.queue', { urls: [url] });
  const listing = (await op('workspace')).listings.find((l: any) => l.url === url);
  await op('research.capture', {
    id: listing.id,
    description: `${quote} Build useful tools and collaborate with designers and engineers on reliable software delivery.`,
  });
  const extracted = await request.post(`${base}/api/internal`, {
    headers: { 'x-studio-internal-token': 'isolated-playwright-fixture' },
    data: {
      action: 'research.extract',
      input: {
        id: listing.id,
        title: 'Engineer',
        company: 'Fixture',
        family: 'Software',
        seniority: 'Senior',
        level: 'senior',
        track: 'software',
        location: 'NYC',
        arrangement: 'Hybrid',
        requirements: [
          { label: 'Agent-friendly codebase', kind: 'technical', section: 'Preferred', quote },
        ],
      },
    },
  });
  expect(extracted.ok(), await extracted.text()).toBeTruthy();
  for (const [id, label] of [
    ['fixture-ai', 'AI engineering'],
    ['fixture-dx', 'Developer experience'],
  ])
    await op('map.concept.save', { id, label, description: 'A broader concept.' });
  await op('map.capability.save', {
    id: 'fixture-agent-ready',
    label: 'Agent-ready repositories',
    kind: 'technical',
    description: 'Preparing repository context and tools for coding agents.',
    experienceGuide: 'Discuss a repository change and how it helped the team.',
    prompts: ['What context did you make easier to find?'],
    distinctions: 'Different from orchestrating agents at runtime.',
    conceptIds: ['fixture-ai', 'fixture-dx'],
  });
  const source = (await op('map.labels')).find((r: any) => r.listingId === listing.id);
  await op('map.link', {
    mappings: [
      {
        listingId: listing.id,
        requirementKey: source.requirementKey,
        capabilityIds: ['fixture-agent-ready'],
      },
    ],
  });
  await page.goto(base);
  await page.getByRole('button', { name: 'Requirement map', exact: true }).click();
  const map = page.getByRole('region', { name: 'Requirement map', exact: true });
  await map.getByRole('button', { name: 'List', exact: true }).click();
  await map
    .getByRole('textbox', { name: 'Search requirement concepts and capabilities' })
    .fill('agent-friendly');
  await expect(map.getByRole('button', { name: /Agent-ready repositories/ })).toHaveCount(2);
  await expect(map.getByText('Also in Developer experience')).toBeVisible();
  await map
    .getByRole('button', { name: /Agent-ready repositories/ })
    .first()
    .click();
  let dialog = page.getByRole('dialog');
  await expect(dialog.getByText(quote, { exact: true })).toBeVisible();
  await expect(dialog.getByText('Preferred', { exact: true })).toBeVisible();
  await expect(dialog.getByText('What context did you make easier to find?')).toBeVisible();
  await dialog.getByRole('button', { name: 'Edit capability & guide' }).click();
  dialog = page.getByRole('dialog');
  await dialog
    .getByRole('textbox', { name: 'Experience guide', exact: true })
    .fill('Describe your contribution and a qualitative outcome.');
  await dialog.getByRole('button', { name: 'Save capability', exact: true }).click();
  await expect(
    page
      .getByRole('dialog')
      .getByText('Describe your contribution and a qualitative outcome.', { exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('dialog').getByRole('button', { name: 'Remove association' }).click();
  await expect(page.getByRole('dialog').getByText(quote, { exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await map.getByRole('button', { name: 'Show unmapped requirements' }).click();
  await expect(page.getByRole('dialog').getByText(quote, { exact: true })).toBeVisible();
  expect((await op('research.get', { id: listing.id })).requirements[0].quote).toBe(quote);
});

test('graph view links stories to capabilities and shows unexplored demand by role', async ({
  page,
  request,
}) => {
  const op = async (action: string, input: unknown = {}) => {
    const response = await request.post(`${base}/api/studio/${action}`, { data: input });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  };
  const listing = (await op('workspace')).listings.find((l: any) =>
    l.url.endsWith('requirement-map-fixture'),
  );
  const source = (await op('map.labels')).find((r: any) => r.listingId === listing.id);
  await op('map.link', {
    mappings: [
      {
        listingId: listing.id,
        requirementKey: source.requirementKey,
        capabilityIds: ['fixture-agent-ready'],
      },
    ],
  });
  await op('entries.save', {
    title: 'Agent context cleanup',
    markdown: 'Documented repository conventions for coding agents.',
    skills: [],
    sourceMessageIds: [],
  });
  await page.goto(base);
  await page.getByRole('button', { name: 'Requirement map', exact: true }).click();
  const map = page.getByRole('region', { name: 'Requirement map', exact: true });
  await expect(map.getByTestId('requirement-graph').locator('canvas').first()).toBeVisible();
  const panel = map.getByRole('complementary', { name: 'Map details' });
  const unexplored = panel.getByRole('region', { name: 'Most requested, still unexplored' });
  await expect(unexplored.getByRole('button', { name: /Agent-ready repositories/ })).toBeVisible();
  await map.getByRole('combobox', { name: 'Role track' }).selectOption('software');
  await expect(unexplored.getByRole('button', { name: /Agent-ready repositories/ })).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Software engineering' })).toBeVisible();
  await map.getByRole('combobox', { name: 'Role track' }).selectOption('');
  await map
    .getByRole('textbox', { name: 'Search requirement concepts and capabilities' })
    .fill('agent-ready');
  await map
    .getByRole('textbox', { name: 'Search requirement concepts and capabilities' })
    .press('Enter');
  await expect(panel.getByRole('heading', { name: 'Agent-ready repositories' })).toBeVisible();
  await expect(panel.getByText('Software engineering')).toBeVisible();
  await panel.getByRole('combobox', { name: 'Link a story' }).selectOption({
    label: 'Agent context cleanup',
  });
  await expect(
    panel.getByRole('button', { name: 'Agent context cleanup', exact: true }),
  ).toBeVisible();
  const entry = (await op('workspace')).entries.find(
    (e: any) => e.title === 'Agent context cleanup',
  );
  expect(entry.capability_ids).toEqual(['fixture-agent-ready']);
  await panel.getByRole('button', { name: 'Clear selection' }).click();
  await expect(unexplored).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await op('entries.delete', { id: entry.id });
});
