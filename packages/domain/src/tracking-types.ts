export const jobStages = [
  'saved',
  'applied',
  'interviewing',
  'offer',
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
