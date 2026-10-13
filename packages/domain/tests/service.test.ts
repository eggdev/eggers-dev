import { createDatabase, type Database } from '@repo/database';
import { createCareerService } from '@repo/domain';
import { canonicalUrl, parsePage } from '@repo/domain/research';
import { Effect } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let db: Database;
let service: ReturnType<typeof createCareerService>;
const retired: string[] = [];
const run = (action: string, input: unknown = {}, actor: 'owner' | 'eve' = 'owner', key?: string) =>
  Effect.runPromise(service.execute(action, input, actor, key));
beforeAll(async () => {
  db = await createDatabase();
  service = createCareerService(db, async (session) => {
    retired.push(session.id ?? session.sessionId);
  });
});
afterAll(async () => {
  await db.close();
});
describe('career workspace', () => {
  it('starts empty with automatic editing enabled', async () => {
    const w = await run('workspace');
    expect(w.entries).toEqual([]);
    expect(w.roles).toEqual([]);
    expect(w.settings.reviewRequired).toBe(false);
  });
  it('stores stories without requiring metrics, prevents stale overwrites and replays', async () => {
    const input = {
      title: 'A useful story',
      markdown: 'I made onboarding easier by documenting decisions.',
      skills: ['Documentation'],
      sourceMessageIds: [],
    };
    const e = await run('entries.save', input, 'eve', 'call-1');
    expect(e.revision).toBe(1);
    expect((await run('entries.save', input, 'eve', 'call-1')).revision).toBe(1);
    await run('entries.save', {
      ...input,
      id: e.id,
      expectedRevision: 1,
      markdown: 'A corrected story.',
    });
    await expect(run('entries.save', { ...input, id: e.id, expectedRevision: 1 })).rejects.toThrow(
      'changed',
    );
    expect((await run('entries.history', { id: e.id })).length).toBe(2);
  });
  it('keeps Eve changes pending only when review is enabled', async () => {
    const settings = await run('settings');
    await run('settings.save', { ...settings, reviewRequired: true });
    const proposal = await run(
      'entries.save',
      {
        title: 'Pending',
        markdown: 'Qualitative impact matters.',
        skills: [],
        sourceMessageIds: [],
      },
      'eve',
      'proposal-call',
    );
    expect(proposal.proposed).toBe(true);
    expect((await run('workspace')).entries.some((e: any) => e.title === 'Pending')).toBe(false);
    await run('proposals.accept', { id: proposal.id });
    expect((await run('workspace')).entries.some((e: any) => e.title === 'Pending')).toBe(true);
    await run('settings.save', settings);
  });
  it('permanently deletes linked messages and revisions, retires sessions, rejects late events', async () => {
    const t = await run('threads.create', { title: 'Recall' });
    await run('messages.save', {
      id: 'source-1',
      threadId: t.id,
      sessionId: 'session-1',
      kind: 'user',
      body: 'Private memory',
    });
    const e = await run('entries.save', {
      title: 'Memory',
      markdown: 'Private memory',
      skills: [],
      sourceMessageIds: ['source-1'],
    });
    await run('entries.delete', { id: e.id });
    expect(retired).toContain('session-1');
    expect(await run('entries.history', { id: e.id })).toEqual([]);
    expect((await run('threads.get', { id: t.id })).messages).toEqual([]);
    expect(
      await run('messages.save', {
        id: 'late',
        threadId: t.id,
        sessionId: 'session-1',
        kind: 'assistant',
        body: 'Late memory',
      }),
    ).toEqual({ retired: true });
    expect(
      (
        await run('threads.cursor', {
          id: t.id,
          session: { sessionId: 'session-1', streamIndex: 2 },
        })
      ).retired,
    ).toBe(true);
  });
  it('deleting a thread deletes derived knowledge', async () => {
    const t = await run('threads.create', { title: 'Second role' });
    await run('messages.save', {
      id: 'source-2',
      threadId: t.id,
      sessionId: 'session-2',
      kind: 'user',
      body: 'Another memory',
    });
    const e = await run('entries.save', {
      title: 'Linked story',
      markdown: 'Another memory',
      skills: [],
      sourceMessageIds: ['source-2'],
    });
    await run('threads.delete', { id: t.id });
    expect((await run('workspace')).entries.some((row: any) => row.id === e.id)).toBe(false);
    await expect(run('threads.get', { id: t.id })).rejects.toThrow('not found');
  });
});
describe('research corpus', () => {
  it('canonicalizes URLs and deduplicates imports', async () => {
    expect(canonicalUrl('https://example.com/job/1?utm_source=x#details')).toBe(
      'https://example.com/job/1',
    );
    const results = await run('research.queue', {
      urls: ['https://example.com/job/1?utm_source=x', 'https://example.com/job/1', 'not a url'],
      family: 'Frontend',
    });
    expect(results.map((r: any) => r.status)).toEqual(['queued', 'existing', 'invalid']);
  });
  it('preserves source excerpts, rejects invented requirements, deduplicates content', async () => {
    const [listing] = (await run('workspace')).listings;
    const description =
      'Build accessible interfaces with React. Collaborate with product managers and designers to improve customer workflows. Experience running A/B tests is helpful.';
    await run('research.capture', { id: listing.id, description, title: 'Frontend Engineer' });
    const captured = await run('research.fetch', { id: listing.id });
    expect(captured.status).toBe('extracting');
    expect(captured.listing.description).toBe(description);
    const input = {
      id: listing.id,
      title: 'Frontend Engineer',
      company: 'Example',
      family: 'Frontend',
      seniority: 'Senior',
      location: 'NYC',
      arrangement: 'Hybrid',
      requirements: [
        {
          label: 'React',
          kind: 'technical',
          section: 'Responsibilities',
          quote: 'Build accessible interfaces with React.',
        },
      ],
    };
    await expect(
      run('research.extract', {
        ...input,
        requirements: [{ ...input.requirements[0], quote: 'You must know Rust.' }],
      }),
    ).rejects.toThrow('exact excerpt');
    await run('research.extract', input);
    expect((await run('research.capture', { id: listing.id, description })).status).toBe(
      'unchanged',
    );
    await run('research.queue', { urls: ['https://another.example/jobs/123'] });
    const other = (await run('workspace')).listings.find((l: any) => l.id !== listing.id);
    expect((await run('research.capture', { id: other.id, description })).status).toBe('duplicate');
    expect((await run('workspace')).requirementHierarchy.listingCount).toBe(1);
    expect((await run('map.labels'))[0].label).toBe('React');
  });
  it('parses structured job pages consistently', () => {
    const page = parsePage(
      '<html><script type="application/ld+json">{"@type":"JobPosting","title":"Engineer","hiringOrganization":{"name":"Example"},"description":"<p>Build useful products.</p>"}</script></html>',
    );
    expect(page.title).toBe('Engineer');
    expect(page.company).toBe('Example');
    expect(page.description).toContain('Build useful products.');
  });
});

describe('review and deletion across the bank', () => {
  it('reviews Eve role and topic edits while owner edits remain direct', async () => {
    const settings = await run('settings');
    await run('settings.save', { ...settings, reviewRequired: true });
    const roleProposal = await run(
      'roles.save',
      { title: 'Reviewed role', company: 'Example' },
      'eve',
      'role-proposal',
    );
    expect(roleProposal.proposed).toBe(true);
    expect((await run('workspace')).roles.some((r: any) => r.title === 'Reviewed role')).toBe(
      false,
    );
    const role = await run('proposals.accept', { id: roleProposal.id });
    const topicProposal = await run(
      'topics.save',
      { roleId: role.id, label: 'Experiment design', status: 'unexplored' },
      'eve',
      'topic-proposal',
    );
    expect(topicProposal.proposed).toBe(true);
    const topic = await run('proposals.accept', { id: topicProposal.id });
    expect(topic.label).toBe('Experiment design');
    const thread = await run('threads.create', { title: 'Role conversation', roleId: role.id });
    await run('entries.save', {
      roleId: role.id,
      title: 'Owner edit',
      markdown: 'Directly entered narrative.',
      skills: [],
      sourceMessageIds: [],
    });
    await run('roles.delete', { id: role.id });
    const state = await run('workspace');
    expect(state.roles.some((r: any) => r.id === role.id)).toBe(false);
    expect(state.topics.some((t: any) => t.id === topic.id)).toBe(false);
    expect(state.threads.some((t: any) => t.id === thread.id)).toBe(false);
    expect(state.entries.some((e: any) => e.role_id === role.id)).toBe(false);
    await run('settings.save', settings);
  });
  it('removes pending proposals sourced from a deleted conversation', async () => {
    const settings = await run('settings');
    const thread = await run('threads.create', { title: 'Delete proposed memory' });
    await run('messages.save', {
      id: 'pending-source',
      threadId: thread.id,
      sessionId: 'pending-session',
      turnId: 'pending-turn',
      kind: 'user',
      body: 'A memory not yet accepted',
    });
    await run('settings.save', { ...settings, reviewRequired: true });
    const proposal = await run(
      'entries.save',
      {
        title: 'Pending memory',
        markdown: 'A memory not yet accepted',
        skills: [],
        sourceMessageIds: ['pending-source'],
      },
      'eve',
      'delete-pending',
    );
    await run('threads.delete', { id: thread.id });
    expect((await run('workspace')).proposals.some((p: any) => p.id === proposal.id)).toBe(false);
    await run('settings.save', settings);
  });
  it('keeps the workspace summary small while source detail remains available', async () => {
    const state = await run('workspace');
    const listing = state.listings.find((l: any) => l.status === 'ready');
    expect(listing.description).toBe('');
    expect(listing.requirements).toEqual([]);
    expect((await run('research.get', { id: listing.id })).description.length).toBeGreaterThan(100);
    expect(state.requirementHierarchy.totalRequirements).toBeGreaterThan(0);
  });
});

it('entry deletion also removes pending drafts based on the deleted source', async () => {
  const settings = await run('settings');
  const thread = await run('threads.create', { title: 'Delete linked drafts' });
  await run('messages.save', {
    id: 'draft-source',
    threadId: thread.id,
    sessionId: 'draft-session',
    kind: 'user',
    body: 'Source for a story',
  });
  const entry = await run('entries.save', {
    title: 'Original',
    markdown: 'Source for a story',
    skills: [],
    sourceMessageIds: ['draft-source'],
  });
  await run('settings.save', { ...settings, reviewRequired: true });
  const proposal = await run(
    'entries.save',
    {
      title: 'Another draft',
      markdown: 'Source for a story',
      skills: [],
      sourceMessageIds: ['draft-source'],
    },
    'eve',
    'draft-call',
  );
  await run('entries.delete', { id: entry.id });
  expect((await run('workspace')).proposals.some((p: any) => p.id === proposal.id)).toBe(false);
  await run('settings.save', settings);
});
