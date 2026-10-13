import { randomUUID } from 'node:crypto';
import type { Database } from '@repo/database';
import { DomainError } from '@repo/domain/errors';
import { canonicalUrl } from '@repo/domain/research';
import {
  activityKinds,
  type JobActivity,
  jobStages,
  type TrackedJob,
} from '@repo/domain/tracking-types';
import { Schema } from 'effect';

const label = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500));
const text = Schema.String.check(Schema.isMaxLength(100_000));
const dayInput = Schema.optional(Schema.NullOr(Schema.String));
const TrackInput = Schema.Struct({
  listingId: Schema.optional(label),
  url: Schema.optional(label),
  title: Schema.optional(label),
  company: Schema.optional(text),
  stage: Schema.optional(Schema.Literals(jobStages)),
  happenedOn: dayInput,
  source: Schema.optional(label),
  sourceDetails: Schema.optional(text),
});
const SaveInput = Schema.Struct({
  id: label,
  expectedRevision: Schema.Number,
  title: label,
  company: text,
  stage: Schema.Literals(jobStages),
  notes: text,
  nextAction: text,
  nextDueOn: dayInput,
  happenedOn: dayInput,
});
const CompleteInput = Schema.Struct({
  id: label,
  expectedRevision: Schema.Number,
  happenedOn: dayInput,
});
const ActivityInput = Schema.Struct({
  id: Schema.optional(label),
  jobId: label,
  expectedRevision: Schema.optional(Schema.Number),
  kind: Schema.Literals([...activityKinds, 'stage_change']),
  title: label,
  body: text,
  happenedOn: dayInput,
});
const activityColumns =
  'id,job_id,kind,title,body,happened_on::text AS happened_on,stage,source,revision,recorded_at';
const jobColumns =
  'id,listing_id,url,title,company,stage,notes,next_action,next_due_on::text AS next_due_on,revision,created_at,updated_at';
function decode<T>(schema: Schema.Codec<T, any>, raw: unknown): T {
  try {
    return Schema.decodeUnknownSync(schema)(raw);
  } catch {
    throw new DomainError('Some tracking fields are missing or invalid.');
  }
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 500)
    throw new DomainError('A valid ID is required.');
  return value;
}
function day(value?: string | null): string | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new DomainError('Use a date in YYYY-MM-DD format.');
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value)
    throw new DomainError('Use a real calendar date.');
  return value;
}
export function tracking(db: Database) {
  const getJob = async (jobId: string) => {
    const [job] = await db.query<TrackedJob>(`SELECT ${jobColumns} FROM tracked_jobs WHERE id=$1`, [
      jobId,
    ]);
    if (!job) throw new DomainError('Tracked job not found.', 404);
    return job;
  };
  return async (action: string, raw: any): Promise<any> => {
    switch (action) {
      case 'jobs.list':
        return db.query<TrackedJob>(
          `SELECT ${jobColumns} FROM tracked_jobs ORDER BY updated_at DESC,id`,
        );
      case 'jobs.get': {
        const job = await getJob(id(raw.id));
        const activities = await db.query<JobActivity>(
          `SELECT ${activityColumns} FROM job_activities WHERE job_id=$1 ORDER BY happened_on DESC NULLS LAST,recorded_at DESC,id`,
          [job.id],
        );
        return { job, activities };
      }
      case 'jobs.track': {
        const input = decode(TrackInput, raw);
        const listing = input.listingId
          ? (
              await db.query('SELECT id,url,title,company FROM listings WHERE id=$1', [
                input.listingId,
              ])
            )[0]
          : undefined;
        if (input.listingId && !listing) throw new DomainError('Listing not found.', 404);
        if (!listing && (!input.url || !input.title))
          throw new DomainError('Provide a listing or a job URL and title.');
        const url = canonicalUrl(listing?.url ?? input.url ?? '');
        const [existing] = await db.query<TrackedJob>(
          `SELECT ${jobColumns} FROM tracked_jobs WHERE url=$1 OR listing_id=$2`,
          [url, listing?.id ?? null],
        );
        if (existing) return { job: existing, created: false };
        const jobId = randomUUID();
        const stage = input.stage ?? 'saved';
        const source = input.source ?? 'owner';
        // The timeline event is inserted only when the job is newly created, even during a concurrent import.
        const rows = await db.query(
          `WITH added AS (
          INSERT INTO tracked_jobs(id,listing_id,url,title,company,stage)
          VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id
        ) INSERT INTO job_activities(id,job_id,kind,title,happened_on,stage,source,body)
          SELECT $7,id,'stage_change',$8,$9::date,$6,$10,$11 FROM added RETURNING job_id`,
          [
            jobId,
            listing?.id ?? null,
            url,
            input.title ?? (listing?.title || url),
            input.company ?? listing?.company ?? '',
            stage,
            randomUUID(),
            source === 'owner' ? `Started tracking: ${stage}` : `Imported current stage: ${stage}`,
            day(input.happenedOn),
            source,
            input.sourceDetails ?? '',
          ],
        );
        const [job] = await db.query<TrackedJob>(
          `SELECT ${jobColumns} FROM tracked_jobs WHERE url=$1 OR listing_id=$2`,
          [url, listing?.id ?? null],
        );
        return { job, created: rows.length > 0 };
      }
      case 'jobs.save': {
        const input = decode(SaveInput, raw);
        const existing = await getJob(input.id);
        const due = day(input.nextDueOn);
        if (due && !input.nextAction.trim())
          throw new DomainError('Add a next action for the due date.');
        const rows = await db.query(
          `WITH changed AS (
          UPDATE tracked_jobs SET title=$2,company=$3,stage=$4,notes=$5,next_action=$6,next_due_on=$7::date,
            revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$8 RETURNING *
        ), logged AS (
          INSERT INTO job_activities(id,job_id,kind,title,happened_on,stage)
            SELECT $9,id,'stage_change',$10,$11::date,stage FROM changed WHERE stage<>$12 RETURNING id
        ) SELECT *,next_due_on::text AS next_due_on FROM changed`,
          [
            input.id,
            input.title,
            input.company,
            input.stage,
            input.notes,
            input.nextAction,
            due,
            input.expectedRevision,
            randomUUID(),
            `Stage changed to ${input.stage}`,
            day(input.happenedOn),
            existing.stage,
          ],
        );
        if (!rows.length) throw new DomainError('This job changed. Reload it before saving.', 409);
        return rows[0];
      }
      case 'jobs.delete':
        await db.query('DELETE FROM tracked_jobs WHERE id=$1', [id(raw.id)]);
        return { ok: true };
      case 'jobs.followup.complete': {
        const input = decode(CompleteInput, raw);
        const job = await getJob(input.id);
        if (!job.next_action) throw new DomainError('No next action to complete.');
        const rows = await db.query(
          `WITH changed AS (
          UPDATE tracked_jobs SET next_action='',next_due_on=NULL,revision=revision+1,updated_at=now()
          WHERE id=$1 AND revision=$2 RETURNING id
        ) INSERT INTO job_activities(id,job_id,kind,title,happened_on)
          SELECT $3,id,'follow_up',$4,$5::date FROM changed RETURNING ${activityColumns}`,
          [job.id, input.expectedRevision, randomUUID(), job.next_action, day(input.happenedOn)],
        );
        if (!rows.length)
          throw new DomainError('This job changed. Reload it before completing the action.', 409);
        return rows[0];
      }
      case 'jobs.activity.save': {
        const input = decode(ActivityInput, raw);
        await getJob(input.jobId);
        const when = day(input.happenedOn);
        if (input.id) {
          // Editing historical dates or notes never changes the job's current stage.
          const rows = await db.query(
            `UPDATE job_activities SET kind=$3,title=$4,body=$5,happened_on=$6::date,
            revision=revision+1 WHERE id=$1 AND job_id=$2 AND revision=$7
            AND ((kind='stage_change' AND $3='stage_change') OR (kind<>'stage_change' AND $3<>'stage_change')) RETURNING ${activityColumns}`,
            [
              input.id,
              input.jobId,
              input.kind,
              input.title,
              input.body,
              when,
              input.expectedRevision,
            ],
          );
          if (!rows.length)
            throw new DomainError(
              'This activity changed or cannot be edited. Reload it before saving.',
              409,
            );
          return rows[0];
        }
        if (input.kind === 'stage_change')
          throw new DomainError('Change stages in the job editor.');
        return (
          await db.query(
            `INSERT INTO job_activities(id,job_id,kind,title,body,happened_on)
          VALUES($1,$2,$3,$4,$5,$6::date) RETURNING ${activityColumns}`,
            [randomUUID(), input.jobId, input.kind, input.title, input.body, when],
          )
        )[0];
      }
      case 'jobs.activity.delete':
        await db.query('DELETE FROM job_activities WHERE id=$1 AND job_id=$2', [
          id(raw.id),
          id(raw.jobId),
        ]);
        return { ok: true };
      default:
        throw new DomainError('Unknown tracking operation.', 404);
    }
  };
}
