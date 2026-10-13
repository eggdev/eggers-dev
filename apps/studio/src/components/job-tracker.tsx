'use client';
import {
  activityKinds,
  type JobActivity,
  type JobStage,
  jobStages,
  type TrackedJob,
  type TrackedJobDetail,
} from '@repo/domain/tracking-types';
import { Badge, Button, Dialog, Input, Select, Textarea } from '@repo/ui';
import { api } from '@studio/components/api';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

const label = (value: string) => value.replaceAll('_', ' ').replace(/^./, (c) => c.toUpperCase());
const today = () => new Date().toLocaleDateString('en-CA');
const displayDate = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString();
const closed = new Set<JobStage>(['rejected', 'withdrawn', 'closed']);
const field = 'block space-y-2 text-sm';
export function JobTracker({ initialId }: { initialId?: string }) {
  const [jobs, setJobs] = useState<TrackedJob[]>([]);
  const [selected, setSelected] = useState(initialId);
  const [detail, setDetail] = useState<TrackedJobDetail>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [stage, setStage] = useState('all');
  const [adding, setAdding] = useState(false);
  const refresh = useCallback(async () => {
    setJobs(await api<TrackedJob[]>('jobs.list'));
  }, []);
  useEffect(() => {
    void refresh()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [refresh]);
  useEffect(() => {
    let active = true;
    setDetail(undefined);
    if (selected)
      void api<TrackedJobDetail>('jobs.get', { id: selected })
        .then((value) => {
          if (active) setDetail(value);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [selected]);
  const run = async (action: string, input: unknown, jobId = selected) => {
    setBusy(true);
    setError('');
    try {
      const result = await api(action, input);
      await refresh();
      if (jobId) setDetail(await api('jobs.get', { id: jobId }));
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      setBusy(false);
    }
  };
  const due = jobs
    .filter((job) => job.next_due_on && job.next_action && !closed.has(job.stage))
    .sort((a, b) => (a.next_due_on ?? '').localeCompare(b.next_due_on ?? ''));
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 md:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Job tracker</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Keep the process, the conversations, and the next step together.
          </p>
        </div>
        <Button onClick={() => setAdding(true)}>
          <Plus />
          Add job
        </Button>
      </header>
      {error && (
        <div role="alert" className="space-y-2 rounded-md border p-3 text-sm text-destructive">
          <p>{error}</p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setError('');
              void refresh()
                .then(async () => {
                  if (selected) setDetail(await api('jobs.get', { id: selected }));
                })
                .catch((e) => setError(e.message));
            }}
          >
            Reload latest
          </Button>
        </div>
      )}
      {selected ? (
        <>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSelected(undefined);
              setError('');
            }}
          >
            <ArrowLeft />
            All tracked jobs
          </Button>
          {detail ? (
            <JobDetail
              key={`${detail.job.id}:${detail.job.revision}`}
              detail={detail}
              busy={busy}
              error={error}
              run={run}
              remove={() =>
                void run('jobs.delete', { id: selected }, '')
                  .then(() => setSelected(undefined))
                  .catch(() => {})
              }
            />
          ) : (
            <p className="text-sm text-muted-foreground">Opening job…</p>
          )}
        </>
      ) : (
        <>
          {due.length > 0 && (
            <section className="rounded-lg border p-5" aria-label="Follow-ups">
              <h3 className="font-medium">Upcoming and overdue</h3>
              <div className="mt-3 divide-y">
                {due.map((job) => (
                  <button
                    key={job.id}
                    type="button"
                    onClick={() => setSelected(job.id)}
                    className="flex w-full flex-wrap items-center justify-between gap-2 py-3 text-left text-sm"
                  >
                    <span>
                      {job.next_action}
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {job.company} · {job.title}
                      </span>
                    </span>
                    <Badge>
                      {(job.next_due_on ?? '') < today()
                        ? 'Overdue · '
                        : job.next_due_on === today()
                          ? 'Today · '
                          : ''}
                      {displayDate(job.next_due_on ?? '')}
                    </Badge>
                  </button>
                ))}
              </div>
            </section>
          )}
          <div className="flex flex-wrap gap-3">
            <Input
              aria-label="Search tracked jobs"
              placeholder="Search company or role…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-md"
            />
            <Select
              aria-label="Filter by stage"
              value={stage}
              onChange={(e) => setStage(e.target.value)}
            >
              <option value="all">All stages</option>
              {jobStages.map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </Select>
            <span className="self-center text-sm text-muted-foreground">{jobs.length} tracked</span>
          </div>
          {loading && <p className="text-sm">Loading jobs…</p>}
          {!loading && !jobs.length && (
            <p className="py-12 text-sm text-muted-foreground">
              Track a listing from Job research, import your TrueUp tracker, or add a job by URL.
            </p>
          )}
          <div className="divide-y">
            {jobs
              .filter(
                (job) =>
                  (stage === 'all' || job.stage === stage) &&
                  `${job.title} ${job.company}`.toLowerCase().includes(search.toLowerCase()),
              )
              .map((job) => (
                <button
                  type="button"
                  key={job.id}
                  className="flex w-full flex-wrap items-center justify-between gap-3 py-5 text-left break-words"
                  onClick={() => setSelected(job.id)}
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{job.title}</span>
                    <span className="mt-1 block text-sm text-muted-foreground">
                      {job.company || new URL(job.url).hostname}
                    </span>
                    {job.next_action && (
                      <span className="mt-2 block text-xs text-muted-foreground">
                        Next: {job.next_action}
                        {job.next_due_on ? ` · ${displayDate(job.next_due_on)}` : ''}
                      </span>
                    )}
                  </span>
                  <Badge>{label(job.stage)}</Badge>
                </button>
              ))}
          </div>
        </>
      )}
      <Dialog
        title="Track a job"
        description="Add a job even if its description is no longer available."
        open={adding}
        onOpenChange={setAdding}
      >
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            void run(
              'jobs.track',
              {
                url: data.get('url'),
                title: data.get('title'),
                company: data.get('company'),
                stage: data.get('stage'),
                happenedOn: data.get('date'),
              },
              '',
            )
              .then(({ job }) => {
                setAdding(false);
                setSelected(job.id);
              })
              .catch(() => {});
          }}
        >
          <div className={field}>
            <label htmlFor="tracker-field-1">Job URL</label>
            <Input id="tracker-field-1" name="url" type="url" required />
          </div>
          <div className={field}>
            <label htmlFor="tracker-field-2">Job title</label>
            <Input id="tracker-field-2" name="title" required />
          </div>
          <div className={field}>
            <label htmlFor="tracker-field-3">Company</label>
            <Input id="tracker-field-3" name="company" />
          </div>
          <div className={field}>
            <label htmlFor="tracker-field-4">Current stage</label>
            <Select id="tracker-field-4" name="stage" defaultValue="saved" className="w-full">
              {jobStages.map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </Select>
          </div>
          <div className={field}>
            <label htmlFor="tracker-field-5">Stage date, if known</label>
            <Input id="tracker-field-5" name="date" type="date" />
          </div>
          <Button type="submit" disabled={busy}>
            Add to tracker
          </Button>
        </form>
      </Dialog>
    </div>
  );
}
type Run = (action: string, input: unknown, jobId?: string) => Promise<any>;
function JobDetail({
  detail,
  busy,
  error,
  run,
  remove,
}: {
  detail: TrackedJobDetail;
  busy: boolean;
  error: string;
  run: Run;
  remove: () => void;
}) {
  const { job, activities } = detail;
  const [draft, setDraft] = useState(job);
  const [stageDate, setStageDate] = useState(today());
  const [edit, setEdit] = useState<JobActivity>();
  const [adding, setAdding] = useState(false);
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    void run('jobs.save', {
      id: job.id,
      expectedRevision: job.revision,
      title: draft.title,
      company: draft.company,
      stage: draft.stage,
      notes: draft.notes,
      nextAction: draft.next_action,
      nextDueOn: draft.next_due_on,
      happenedOn: stageDate,
    }).catch(() => {});
  };
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section>
        <div className="mb-5 flex items-start justify-between gap-3">
          <a href={job.url} target="_blank" rel="noreferrer" className="text-sm underline">
            Open original listing ↗
          </a>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Remove tracked job and timeline"
            title="Remove tracked job and timeline"
            onClick={remove}
            disabled={busy}
          >
            <Trash2 />
          </Button>
        </div>
        <form className="space-y-4" onSubmit={save}>
          <div className={field}>
            <label htmlFor="tracker-field-6">Job title</label>
            <Input
              id="tracker-field-6"
              required
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </div>
          <div className={field}>
            <label htmlFor="tracker-field-7">Company</label>
            <Input
              id="tracker-field-7"
              value={draft.company}
              onChange={(e) => setDraft({ ...draft, company: e.target.value })}
            />
          </div>
          <div className={field}>
            <label htmlFor="tracker-field-8">Current stage</label>
            <Select
              id="tracker-field-8"
              className="w-full"
              value={draft.stage}
              onChange={(e) => setDraft({ ...draft, stage: e.target.value as JobStage })}
            >
              {jobStages.map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </Select>
          </div>
          {draft.stage !== job.stage && (
            <div className={field}>
              <label htmlFor="tracker-field-9">Stage date, if known</label>
              <Input
                id="tracker-field-9"
                type="date"
                value={stageDate}
                onChange={(e) => setStageDate(e.target.value)}
              />
              <span className="block text-xs text-muted-foreground">
                Clear the date if you don’t remember when the stage changed.
              </span>
            </div>
          )}
          <div className={field}>
            <label htmlFor="tracker-field-10">Next action</label>
            <Input
              id="tracker-field-10"
              placeholder="Follow up with the recruiter…"
              value={draft.next_action}
              onChange={(e) => setDraft({ ...draft, next_action: e.target.value })}
            />
          </div>
          <div className={field}>
            <label htmlFor="tracker-field-11">Due date</label>
            <Input
              id="tracker-field-11"
              type="date"
              value={draft.next_due_on ?? ''}
              onChange={(e) => setDraft({ ...draft, next_due_on: e.target.value || null })}
            />
          </div>
          <div className={field}>
            <label htmlFor="tracker-field-12">Job notes</label>
            <Textarea
              id="tracker-field-12"
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              placeholder="People, links, context, and questions to bring to the conversation…"
            />
          </div>
          <Button type="submit" disabled={busy}>
            Save job
          </Button>
          {job.next_action && (
            <Button
              type="button"
              variant="outline"
              className="ml-2"
              disabled={busy}
              onClick={() =>
                void run('jobs.followup.complete', {
                  id: job.id,
                  expectedRevision: job.revision,
                  happenedOn: today(),
                }).catch(() => {})
              }
            >
              Complete next action
            </Button>
          )}
        </form>
      </section>
      <section aria-label="Job timeline">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Timeline</h3>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setEdit(undefined);
              setAdding(true);
            }}
          >
            <Plus />
            Add activity
          </Button>
        </div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          Dates describe when things happened. Undated imports stay undated. Adding an activity does
          not change the current stage.
        </p>
        <ol className="mt-4 divide-y">
          {activities.map((activity) => (
            <li key={activity.id} className="space-y-2 py-4">
              <div className="flex flex-wrap justify-between gap-2">
                <span className="text-sm font-medium">{activity.title}</span>
                <span className="text-xs text-muted-foreground">
                  {activity.happened_on ? displayDate(activity.happened_on) : 'Date unknown'}
                </span>
              </div>
              <p className="whitespace-pre-wrap break-words text-sm leading-6">{activity.body}</p>
              <p className="text-xs text-muted-foreground">
                {label(activity.kind)}
                {activity.source !== 'owner' ? ` · ${activity.source}` : ''}
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setEdit(activity);
                    setAdding(true);
                  }}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void run('jobs.activity.delete', { id: activity.id, jobId: job.id }).catch(
                      () => {},
                    )
                  }
                >
                  Delete activity
                </Button>
              </div>
            </li>
          ))}
        </ol>
        {!activities.length && (
          <p className="py-8 text-sm text-muted-foreground">No activity recorded.</p>
        )}
        <Dialog
          title={edit ? 'Edit activity' : 'Add activity'}
          open={adding}
          onOpenChange={setAdding}
          description="Record applications, interviews, conversations, and follow-ups. Leave an unknown date blank."
        >
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <form
            key={edit?.id ?? 'new'}
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              void run('jobs.activity.save', {
                id: edit?.id,
                expectedRevision: edit?.revision,
                jobId: job.id,
                kind: edit?.kind === 'stage_change' ? 'stage_change' : data.get('kind'),
                title: data.get('title'),
                body: data.get('body'),
                happenedOn: data.get('date'),
              })
                .then(() => setAdding(false))
                .catch(() => {});
            }}
          >
            {edit?.kind !== 'stage_change' && (
              <div className={field}>
                <label htmlFor="tracker-field-13">Activity type</label>
                <Select
                  id="tracker-field-13"
                  className="w-full"
                  name="kind"
                  defaultValue={edit?.kind ?? 'note'}
                >
                  {activityKinds.map((k) => (
                    <option key={k} value={k}>
                      {label(k)}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            <div className={field}>
              <label htmlFor="tracker-field-14">Activity title</label>
              <Input id="tracker-field-14" name="title" required defaultValue={edit?.title ?? ''} />
            </div>
            <div className={field}>
              <label htmlFor="tracker-field-15">Activity date</label>
              <Input
                id="tracker-field-15"
                type="date"
                name="date"
                defaultValue={edit ? (edit.happened_on ?? '') : today()}
              />
            </div>
            <div className={field}>
              <label htmlFor="tracker-field-16">Activity notes</label>
              <Textarea id="tracker-field-16" name="body" defaultValue={edit?.body ?? ''} />
            </div>
            <Button type="submit" disabled={busy}>
              Save activity
            </Button>
          </form>
        </Dialog>
      </section>
    </div>
  );
}
