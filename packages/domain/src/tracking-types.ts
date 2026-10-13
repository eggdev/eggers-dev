export const jobStages = [
  'saved',
  'applied',
  'interviewing',
  'offer',
  'negotiating',
  'offer_accepted',
  'offer_declined',
  'no_response',
  'ghosted',
  'rejected',
  'withdrawn',
  'closed',
] as const;
export type JobStage = (typeof jobStages)[number];
export const activityKinds = [
  'application',
  'conversation',
  'interview',
  'offer',
  'note',
  'follow_up',
] as const;
export type ActivityKind = (typeof activityKinds)[number];
export interface TrackedJob {
  id: string;
  listing_id: string | null;
  url: string;
  title: string;
  company: string;
  stage: JobStage;
  stage_since: string | null;
  location: string;
  notes: string;
  next_action: string;
  next_due_on: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
}
export interface JobActivity {
  id: string;
  job_id: string;
  kind: ActivityKind | 'stage_change';
  title: string;
  body: string;
  happened_on: string | null;
  stage: JobStage | null;
  source: string;
  revision: number;
  recorded_at: string;
}
export interface TrackedJobDetail {
  job: TrackedJob;
  activities: JobActivity[];
}

export const trackerGroups = ['saved', 'in_progress', 'done'] as const;
export type TrackerGroup = (typeof trackerGroups)[number];
const finishedStages = new Set<JobStage>([
  'offer_accepted',
  'offer_declined',
  'no_response',
  'ghosted',
  'rejected',
  'withdrawn',
  'closed',
]);
export const trackingToday = (now = new Date()) =>
  now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
export function effectiveStage(
  job: Pick<TrackedJob, 'stage' | 'stage_since'>,
  today = trackingToday(),
): JobStage {
  if (job.stage !== 'applied' || !job.stage_since) return job.stage;
  const elapsed = Date.parse(`${today}T00:00:00Z`) - Date.parse(`${job.stage_since}T00:00:00Z`);
  return elapsed >= 14 * 86400000 ? 'ghosted' : job.stage;
}
export function trackerGroup(
  job: Pick<TrackedJob, 'stage' | 'stage_since'>,
  today = trackingToday(),
): TrackerGroup {
  const stage = effectiveStage(job, today);
  return stage === 'saved' ? 'saved' : finishedStages.has(stage) ? 'done' : 'in_progress';
}
