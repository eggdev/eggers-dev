import { createDatabase, type Database } from '@repo/database';
import { createCareerService } from '@repo/domain';
import { Effect } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let db: Database;
let service: ReturnType<typeof createCareerService>;
const run = (action: string, input: unknown = {}) =>
  Effect.runPromise(service.execute(action, input));
beforeAll(async () => {
  db = await createDatabase();
  service = createCareerService(db);
});
afterAll(async () => {
  await db.close();
});
const save = (job: any, changes: any = {}) =>
  run('jobs.save', {
    id: job.id,
    expectedRevision: job.revision,
    title: job.title,
    company: job.company,
    stage: job.stage,
    notes: job.notes,
    nextAction: job.next_action,
    nextDueOn: job.next_due_on,
    ...changes,
  });
describe('job tracking', () => {
  it('keeps research separate, imports unknown dates honestly, and does not overwrite progress on reimport', async () => {
    await run('research.queue', { urls: ['https://example.com/jobs/tracking?utm_source=trueup'] });
    const { listings } = await run('workspace');
    expect(await run('jobs.list')).toEqual([]);
    const first = await run('jobs.track', {
      listingId: listings[0].id,
      title: 'Senior Engineer',
      company: 'Example',
      stage: 'applied',
      source: 'TrueUp',
    });
    const detail = await run('jobs.get', { id: first.job.id });
    expect(detail.activities).toHaveLength(1);
    expect(detail.activities[0].happened_on).toBeNull();
    const changed = await save(first.job, {
      stage: 'interviewing',
      happenedOn: '2026-10-13',
      notes: 'Recruiter conversation',
    });
    const second = await run('jobs.track', {
      listingId: listings[0].id,
      stage: 'saved',
      source: 'TrueUp',
    });
    expect(second.created).toBe(false);
    expect(second.job.stage).toBe('interviewing');
    expect(second.job.notes).toBe('Recruiter conversation');
    await expect(save(first.job, { stage: 'rejected' })).rejects.toThrow('changed');
    expect((await run('jobs.get', { id: changed.id })).activities).toHaveLength(2);
  });
  it('records a follow-up completion exactly once, edits activities, and preserves calendar dates', async () => {
    const { job } = await run('jobs.track', {
      url: 'https://example.com/jobs/next',
      title: 'Next job',
    });
    const next = await save(job, { nextAction: 'Email recruiter', nextDueOn: '2026-10-15' });
    expect(next.next_due_on).toBe('2026-10-15');
    await expect(save(next, { nextDueOn: '2026-02-30' })).rejects.toThrow('calendar');
    await expect(save(next, { nextAction: '', nextDueOn: '2026-10-15' })).rejects.toThrow(
      'next action',
    );
    await run('jobs.followup.complete', {
      id: job.id,
      expectedRevision: next.revision,
      happenedOn: '2026-10-15',
    });
    await expect(
      run('jobs.followup.complete', { id: job.id, expectedRevision: next.revision }),
    ).rejects.toThrow();
    const detail = await run('jobs.get', { id: job.id });
    expect(detail.job.next_action).toBe('');
    expect(detail.job.next_due_on).toBeNull();
    const event = detail.activities.find((a: any) => a.kind === 'follow_up');
    expect(event.happened_on).toBe('2026-10-15');
    await run('jobs.activity.save', {
      id: event.id,
      jobId: job.id,
      expectedRevision: event.revision,
      kind: 'follow_up',
      title: event.title,
      body: 'Received a reply',
      happenedOn: null,
    });
    const edited = (await run('jobs.get', { id: job.id })).activities.find(
      (a: any) => a.id === event.id,
    );
    expect(edited.happened_on).toBeNull();
    expect(edited.body).toBe('Received a reply');
    await expect(
      run('jobs.activity.save', {
        id: event.id,
        jobId: job.id,
        expectedRevision: event.revision,
        kind: 'note',
        title: 'stale',
        body: '',
      }),
    ).rejects.toThrow('changed');
  });
  it('retains application history when a research source is deleted, but permanently removes tracking on request', async () => {
    const [job] = await run('jobs.list');
    const researchJob = (await run('jobs.list')).find((j: any) => j.listing_id);
    await run('research.delete', { id: researchJob.listing_id });
    const detail = await run('jobs.get', { id: researchJob.id });
    expect(detail.job.listing_id).toBeNull();
    expect(detail.job.title).toBe('Senior Engineer');
    await run('jobs.delete', { id: job.id });
    expect(await db.query('SELECT id FROM job_activities WHERE job_id=$1', [job.id])).toHaveLength(
      0,
    );
    await expect(run('jobs.get', { id: job.id })).rejects.toThrow('not found');
  });
});
