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

describe('TrueUp stages and application aging', () => {
  it('moves Applied to Done as Ghosted at 14 calendar days, including across daylight saving time', async () => {
    const { effectiveStage, trackerGroup } = await import('@repo/domain/tracking-types');
    const applied = { stage: 'applied' as const, stage_since: '2026-10-25' };
    expect(effectiveStage(applied, '2026-11-07')).toBe('applied');
    expect(effectiveStage(applied, '2026-11-08')).toBe('ghosted');
    expect(trackerGroup(applied, '2026-11-08')).toBe('done');
    expect(effectiveStage({ ...applied, stage_since: null }, '2026-11-08')).toBe('applied');
    expect(effectiveStage({ ...applied, stage_since: '2026-11-09' }, '2026-11-08')).toBe('applied');
    for (const stage of ['interviewing', 'offer', 'negotiating'] as const)
      expect(trackerGroup({ ...applied, stage }, '2026-11-08')).toBe('in_progress');
    for (const stage of [
      'offer_accepted',
      'offer_declined',
      'no_response',
      'rejected',
      'withdrawn',
      'closed',
      'ghosted',
    ] as const)
      expect(trackerGroup({ ...applied, stage }, '2026-11-08')).toBe('done');
  });
  it('keeps the application clock through notes and follow-ups, supports correction and reopening, and rejects stale changes', async () => {
    const { effectiveStage } = await import('@repo/domain/tracking-types');
    const { job } = await run('jobs.track', {
      url: 'https://example.com/jobs/aging',
      title: 'Aging application',
      stage: 'applied',
      happenedOn: '2026-09-01',
    });
    expect(job.stage_since).toBe('2026-09-01');
    const noted = await save(job, { notes: 'Updated context', nextAction: 'Follow up' });
    expect(noted.stage_since).toBe('2026-09-01');
    await run('jobs.followup.complete', {
      id: job.id,
      expectedRevision: noted.revision,
      happenedOn: '2026-09-12',
    });
    let detail = await run('jobs.get', { id: job.id });
    expect(effectiveStage(detail.job, '2026-09-15')).toBe('ghosted');
    const corrected = await save(detail.job, { happenedOn: '2026-09-10' });
    expect(effectiveStage(corrected, '2026-09-15')).toBe('applied');
    detail = await run('jobs.get', { id: job.id });
    const stageEvent = detail.activities.find((a: any) => a.kind === 'stage_change');
    expect(stageEvent.happened_on).toBe('2026-09-10');
    await run('jobs.activity.save', {
      id: stageEvent.id,
      jobId: job.id,
      expectedRevision: stageEvent.revision,
      kind: 'stage_change',
      title: stageEvent.title,
      body: '',
      happenedOn: '2026-08-01',
    });
    detail = await run('jobs.get', { id: job.id });
    expect(detail.job.stage_since).toBe('2026-08-01');
    expect(detail.job.revision).toBeGreaterThan(corrected.revision);
    await expect(
      run('jobs.stage', {
        id: job.id,
        expectedRevision: corrected.revision,
        stage: 'interviewing',
      }),
    ).rejects.toThrow('changed');
    const reopened = await run('jobs.stage', {
      id: job.id,
      expectedRevision: detail.job.revision,
      stage: 'applied',
      happenedOn: '2026-10-13',
    });
    expect(effectiveStage(reopened, '2026-10-13')).toBe('applied');
    expect(reopened.notes).toBe('Updated context');
    detail = await run('jobs.get', { id: job.id });
    const latest = detail.activities.find(
      (a: any) => a.kind === 'stage_change' && a.happened_on === '2026-10-13',
    );
    await run('jobs.activity.delete', { id: latest.id, jobId: job.id });
    detail = await run('jobs.get', { id: job.id });
    expect(detail.job.stage_since).toBeNull();
    await save(detail.job, { notes: 'Still unknown' });
    detail = await run('jobs.get', { id: job.id });
    expect(detail.activities.find((a: any) => a.id === stageEvent.id).happened_on).toBe(
      '2026-08-01',
    );
    expect(detail.job.stage_since).toBeNull();
    for (const stage of [
      'negotiating',
      'offer_accepted',
      'offer_declined',
      'no_response',
      'ghosted',
    ] as const) {
      const changed = await run('jobs.stage', {
        id: job.id,
        expectedRevision: detail.job.revision,
        stage,
        happenedOn: '2026-10-13',
      });
      expect(changed.stage).toBe(stage);
      detail = await run('jobs.get', { id: job.id });
    }
  });
});
