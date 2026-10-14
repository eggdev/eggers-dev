import { createDatabase, type Database } from '@repo/database';
import { createCareerService } from '@repo/domain';
import { requirementKey } from '@repo/domain/requirement-taxonomy';
import { Effect } from 'effect';
import { afterAll, beforeAll, expect, it } from 'vitest';

let db: Database;
let service: ReturnType<typeof createCareerService>;
const run = (a: string, input: unknown = {}) => Effect.runPromise(service.execute(a, input));
beforeAll(async () => {
  db = await createDatabase();
  service = createCareerService(db);
});
afterAll(async () => db.close());
const first = {
  label: 'React and TypeScript',
  kind: 'technical' as const,
  section: 'Required',
  quote: 'Build with React and TypeScript.',
};
const second = {
  ...first,
  label: 'Reusable React interfaces',
  quote: 'Build reusable React interfaces.',
};
const ids: string[] = [];
it('retains source distinctions and counts distinct listings through cross-linked capabilities', async () => {
  for (const id of ['frontend', 'languages'])
    await run('map.concept.save', { id, label: id, description: 'Research concept' });
  for (const id of ['react', 'typescript'])
    await run('map.capability.save', {
      id,
      label: id,
      kind: 'technical',
      description: 'Specific capability',
      experienceGuide: 'Explore contribution, decisions and qualitative outcomes.',
      prompts: ['What did you build?'],
      distinctions: 'Related experience does not imply every capability.',
      conceptIds: id === 'react' ? ['frontend'] : ['frontend', 'languages'],
    });
  for (const suffix of ['a', 'b']) {
    await run('research.queue', { urls: [`https://example.com/taxonomy/${suffix}`] });
    const listing = (await run('workspace')).listings.find((l: any) => l.url.endsWith(suffix));
    ids.push(listing.id);
    const requirements = suffix === 'a' ? [first, second] : [first];
    await run('research.capture', {
      id: listing.id,
      description: `${first.quote} ${second.quote} Collaborate with product teams and designers to deliver accessible customer experiences. ${suffix}`,
    });
    await run('research.extract', {
      id: listing.id,
      title: 'Engineer',
      company: suffix,
      family: 'Frontend',
      seniority: 'Senior',
      level: 'senior',
      track: 'frontend',
      location: 'NYC',
      arrangement: 'Hybrid',
      requirements,
    });
  }
  expect((await run('map.pending')).remaining).toBe(3);
  const mappings = [
    {
      listingId: ids[0],
      requirementKey: requirementKey(first),
      capabilityIds: ['react', 'typescript'],
    },
    { listingId: ids[0], requirementKey: requirementKey(second), capabilityIds: ['react'] },
    {
      listingId: ids[1],
      requirementKey: requirementKey(first),
      capabilityIds: ['react', 'typescript'],
    },
  ];
  await run('map.link', { mappings });
  await run('map.link', { mappings });
  const map = await run('map.get');
  expect(map.concepts.find((c: any) => c.id === 'frontend').count).toBe(2);
  expect(map.capabilities.find((c: any) => c.id === 'react').count).toBe(2);
  expect(map.capabilities.find((c: any) => c.id === 'typescript').conceptIds.sort()).toEqual([
    'frontend',
    'languages',
  ]);
  expect(map.mappedRequirements).toBe(3);
  expect(map.unmappedRequirements).toBe(0);
  const detail = await run('map.capability', { id: 'react' });
  expect(detail.evidence).toHaveLength(3);
  expect(detail.evidence[0]).toMatchObject({ quote: first.quote, section: 'Required' });
  expect((await run('research.get', { id: ids[0] })).requirements).toEqual([first, second]);
  expect((await run('workspace')).entries).toHaveLength(0);
});
it('rejects stale source keys and vocabulary writes without partial links', async () => {
  await expect(
    run('map.link', {
      mappings: [
        { listingId: ids[0], requirementKey: requirementKey(first), capabilityIds: ['typescript'] },
        { listingId: ids[0], requirementKey: 'invented', capabilityIds: ['react'] },
      ],
    }),
  ).rejects.toThrow('source requirement changed');
  const { capability } = await run('map.capability', { id: 'react' });
  const input = {
    id: 'react',
    label: 'React engineering',
    kind: 'technical',
    description: capability.description,
    experienceGuide: capability.experience_guide,
    prompts: capability.prompts,
    distinctions: capability.distinctions,
    conceptIds: ['frontend'],
    expectedRevision: capability.revision,
  };
  await run('map.capability.save', input);
  await expect(run('map.capability.save', input)).rejects.toThrow('changed');
  await run('map.unlink', {
    listingId: ids[0],
    requirementKey: requirementKey(second),
    capabilityId: 'react',
  });
  expect((await run('map.pending')).remaining).toBe(1);
});
it('links stories to capabilities with revision history and per-track listings', async () => {
  const entry = await run('entries.save', {
    title: 'Design system migration',
    markdown: 'Moved shared components to typed React primitives.',
    skills: [],
    capabilityIds: ['react', 'typescript', 'react'],
    sourceMessageIds: [],
  });
  expect(entry.capability_ids).toEqual(['react', 'typescript']);
  let map = await run('map.get');
  expect(map.capabilities.find((c: any) => c.id === 'react').entryIds).toEqual([entry.id]);
  expect(map.listings.map((l: any) => l.track)).toEqual(['frontend', 'frontend']);
  // Omitting capabilityIds keeps the links; a supplied list replaces them.
  const kept = await run('entries.save', {
    id: entry.id,
    title: 'Design system migration',
    markdown: 'More detail.',
    skills: [],
    sourceMessageIds: [],
    expectedRevision: 1,
  });
  expect(kept.capability_ids).toEqual(['react', 'typescript']);
  await run('entries.save', {
    id: entry.id,
    title: 'Design system migration',
    markdown: 'More detail.',
    skills: [],
    capabilityIds: ['typescript'],
    sourceMessageIds: [],
    expectedRevision: 2,
  });
  map = await run('map.get');
  expect(map.capabilities.find((c: any) => c.id === 'react').entryIds).toEqual([]);
  const history = await run('entries.history', { id: entry.id });
  expect(history.map((r: any) => r.capability_ids)).toEqual([
    ['typescript'],
    ['react', 'typescript'],
    ['react', 'typescript'],
  ]);
  await expect(
    run('entries.save', {
      id: entry.id,
      title: 'Design system migration',
      markdown: 'More detail.',
      skills: [],
      capabilityIds: ['invented'],
      sourceMessageIds: [],
      expectedRevision: 3,
    }),
  ).rejects.toThrow('existing requirement-map capabilities');
  expect((await run('workspace')).entries[0].capability_ids).toEqual(['typescript']);
  await run('research.classify', { id: ids[1], track: 'full_stack', level: 'staff' });
  map = await run('map.get');
  expect(map.listings.find((l: any) => l.id === ids[1])).toMatchObject({
    track: 'full_stack',
    level: 'staff',
  });
  await expect(
    run('research.classify', { id: ids[1], track: 'astronaut', level: '' }),
  ).rejects.toThrow('invalid');
  await run('map.capability.delete', { id: 'typescript' });
  expect((await run('workspace')).entries[0].capability_ids).toEqual([]);
  await run('entries.delete', { id: entry.id });
});
it('does not count deleted, changed or duplicate sources and permits permanent capability removal', async () => {
  await db.query('UPDATE listings SET duplicate_of=$2 WHERE id=$1', [ids[1], ids[0]]);
  expect((await run('map.get')).capabilities.find((c: any) => c.id === 'react').count).toBe(1);
  await db.query('UPDATE listings SET requirements=$2::text::jsonb WHERE id=$1', [
    ids[0],
    JSON.stringify([{ ...first, label: 'Changed requirement' }]),
  ]);
  const map = await run('map.get');
  expect(map.mappedRequirements).toBe(0);
  expect(map.unmappedRequirements).toBe(1);
  await run('research.delete', { id: ids[0] });
  expect(
    await db.query('SELECT * FROM requirement_links WHERE listing_id=$1', [ids[0]]),
  ).toHaveLength(0);
  await run('map.capability.delete', { id: 'react' });
  await expect(run('map.capability', { id: 'react' })).rejects.toThrow('not found');
  expect(
    await db.query('SELECT * FROM requirement_links WHERE capability_id=$1', ['react']),
  ).toHaveLength(0);
});
