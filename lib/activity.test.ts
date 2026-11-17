// `bun test lib`: the log of slow work (lib/activity.ts). It follows the status columns the server and the worker keep,
// so each test moves a piece of work only by those columns, as they do. The log is emptied before each test; the
// sources, jobs and companies here are invented.
import { beforeEach, expect, test } from 'bun:test';
import { activity, dismiss, dueIn, FEWEST_RUNS, markSeen, median, prune, seenAt, setStage, usual } from './activity.ts';
import { db } from './db.ts';

const NOW = () => Date.now();
const source = (title: string) => (db.query("INSERT INTO sources (kind, title, body, created_at) VALUES ('text', ?, 'Invented text.', ?) RETURNING id").get(title, NOW()) as { id: number }).id;
const job = (title: string, company: string, fit = -1) => (db.query('INSERT INTO jobs (posting, title, company, fit, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id').get('An invented posting.', title, company, fit, NOW()) as { id: number }).id;
const setSource = (id: number, status: string, note = '') => db.query('UPDATE sources SET status = ?, note = ? WHERE id = ?').run(status, note, id);
const rowsOf = (kind: string, subject: number) => db.query('SELECT * FROM activity WHERE kind = ? AND subject = ? ORDER BY id').all(kind, subject) as { id: number; state: string; asked_at: number; started_at: number; ended_at: number; stage: string; reason: string; cleared_at: number }[];
const itemOf = (kind: string, subject: number) => activity(NOW()).items.find((i) => i.kind === kind && i.subject === String(subject));

beforeEach(() => {
  db.run('DELETE FROM activity');
  db.run("UPDATE sources SET status = 'done' WHERE status IN ('queued', 'running')");
  db.run("UPDATE jobs SET status = 'done', resume_status = '', outreach_status = '' WHERE status IN ('queued', 'running') OR resume_status IN ('queued', 'running') OR outreach_status IN ('queued', 'running')");
  db.run("UPDATE profile SET status = 'none'");
  db.run('DELETE FROM activity');
  db.run('UPDATE activity_seen SET at = 0');
});

test('a piece of work is followed from asked, to running with its stage, to done', () => {
  const id = source('Resume 2024');
  let [row] = rowsOf('read-source', id);
  expect(row).toMatchObject({ state: 'waiting', started_at: 0, ended_at: 0 });
  expect(row.asked_at).toBeGreaterThan(0);
  expect(itemOf('read-source', id)).toMatchObject({ status: 'waiting', what: 'Reading Resume 2024', ahead: 0, link: `/source/${id}` });
  expect(activity(NOW()).busy).toBe(true);

  setSource(id, 'running');
  setStage('read-source', id, 'Reading the second half');
  [row] = rowsOf('read-source', id);
  expect(row).toMatchObject({ state: 'running', stage: 'Reading the second half' });
  expect(row.started_at).toBeGreaterThanOrEqual(row.asked_at);
  expect(itemOf('read-source', id)).toMatchObject({ status: 'running', ahead: -1, stage: 'Reading the second half' });

  setSource(id, 'done');
  [row] = rowsOf('read-source', id);
  expect(row).toMatchObject({ state: 'done', stage: '' });
  expect(row.ended_at).toBeGreaterThanOrEqual(row.started_at);
  const a = activity(NOW());
  expect(a.busy).toBe(false);
  expect(a.items.find((i) => i.subject === String(id))).toBeUndefined();
  expect(a.done[0]).toMatchObject({ kind: 'read-source', subject: String(id), status: 'done' });
  expect(a.done[0].took).toBeGreaterThanOrEqual(0);
  expect(a.lastEnded).toBe(row.ended_at);
  // A stage is kept only while the work runs.
  setStage('read-source', id, 'Too late');
  expect(rowsOf('read-source', id)[0].stage).toBe('');
});

test('a failed piece stays in view with its reason until it is asked for again, which starts a new row', () => {
  const id = source('Old review notes');
  setSource(id, 'running');
  setSource(id, 'failed', 'The file could not be opened.');
  expect(itemOf('read-source', id)).toMatchObject({ status: 'failed', reason: 'The file could not be opened.', ahead: -1 });
  expect(activity(NOW()).busy).toBe(false);
  // Asked for again (the screens' Read again sets the source back to queued): the failure is put away.
  setSource(id, 'queued');
  const rows = rowsOf('read-source', id);
  expect(rows.map((r) => r.state)).toEqual(['failed', 'waiting']);
  expect(rows[0].cleared_at).toBeGreaterThan(0);
  expect(activity(NOW()).items.filter((i) => i.subject === String(id)).map((i) => i.status)).toEqual(['waiting']);
});

test('a worker that starts again puts running work back to waiting, on the same row; deleted work is dropped', () => {
  const id = source('Team wiki export');
  setSource(id, 'running');
  db.run("UPDATE sources SET status = 'queued', note = '' WHERE status = 'running'");
  expect(rowsOf('read-source', id).map((r) => [r.state, r.started_at])).toEqual([['waiting', 0]]);
  db.query('DELETE FROM sources WHERE id = ?').run(id);
  expect(rowsOf('read-source', id).map((r) => r.state)).toEqual(['dropped']);
  expect(activity(NOW()).items.find((i) => i.subject === String(id))).toBeUndefined();
});

test('the place in line follows the worker: sources first, then the profile, then postings; resumes best fit first', () => {
  const a = source('First source'), b = source('Second source'), c = source('Third source');
  setSource(a, 'running');
  expect(itemOf('read-source', b)?.ahead).toBe(1);
  expect(itemOf('read-source', c)?.ahead).toBe(2);
  db.run("UPDATE profile SET status = 'queued' WHERE id = 1");
  expect(itemOf('write-profile', 1)).toMatchObject({ ahead: 3, what: 'Writing your profile' });
  const j = job('Staff Engineer', 'Globex');
  expect(itemOf('read-posting', j)).toMatchObject({ ahead: 4, ref: `J-${String(j).padStart(3, '0')}`, what: `Reading the posting for J-${String(j).padStart(3, '0')}, Staff Engineer at Globex` });
  // Resumes have their own line: the best fit is written first, whatever was asked first.
  const low = job('Engineer', 'Initech', 40), high = job('Principal Engineer', 'Hooli', 90);
  db.query("UPDATE jobs SET status = 'done', resume_status = 'queued' WHERE id IN (?, ?)").run(low, high);
  expect(itemOf('write-resume', high)?.ahead).toBe(0);
  expect(itemOf('write-resume', low)?.ahead).toBe(1);
  // Running first, then by place: each line's next piece before the second ones.
  expect(activity(NOW()).items.slice(0, 4).map((i) => [i.kind, i.status, i.ahead])).toEqual([['read-source', 'running', -1], ['write-resume', 'waiting', 0], ['read-source', 'waiting', 1], ['write-resume', 'waiting', 1]]);
});

test('a resume waiting behind its posting is shown but is not work in hand', () => {
  const j = job('Data Engineer', 'Vandelay');
  db.query("UPDATE jobs SET status = 'failed', resume_status = 'queued' WHERE id = ?").run(j);
  expect(itemOf('write-resume', j)?.status).toBe('waiting');
  expect(activity(NOW()).busy).toBe(false);
});

test('the usual duration is the median of the last 10 runs that ended well, and unknown under 3', () => {
  expect(median([5, 1, 3])).toBe(3);
  expect(median([4, 1, 3, 2])).toBe(3);
  const T = 1_800_000_000_000;
  const run = (took: number, ended: number) => db.query("INSERT INTO activity (kind, subject, asked_at, started_at, ended_at, state) VALUES ('write-resume', 1, ?, ?, ?, 'done')").run(T + ended - took, T + ended - took, T + ended);
  run(60_000, 1_000);
  run(120_000, 2_000);
  expect(usual().get('write-resume')).toBeUndefined();
  expect(FEWEST_RUNS).toBe(3);
  run(600_000, 3_000);
  expect(usual().get('write-resume')).toBe(120_000);
  // A failed run and a run with no start do not count.
  db.run("INSERT INTO activity (kind, subject, asked_at, started_at, ended_at, state) VALUES ('write-resume', 1, 1, 1, 1800009000000, 'failed')");
  db.run("INSERT INTO activity (kind, subject, asked_at, started_at, ended_at, state) VALUES ('write-resume', 1, 1, 0, 1800009000001, 'done')");
  expect(usual().get('write-resume')).toBe(120_000);
  // Ten newer runs of 9 minutes: the three older ones fall out of the last 10.
  for (let i = 0; i < 10; i++) run(540_000, 10_000_000 + i);
  expect(usual().get('write-resume')).toBe(540_000);
  // Every row of the kind carries it; another kind with no runs says unknown (-1).
  const id = job('Platform Engineer', 'Globex', 70);
  db.query("UPDATE jobs SET status = 'done', resume_status = 'queued' WHERE id = ?").run(id);
  expect(itemOf('write-resume', id)?.usual).toBe(540_000);
  const s = source('Notes');
  expect(itemOf('read-source', s)?.usual).toBe(-1);
});

test('the digest lists what finished since the owner last looked, once', () => {
  const s = source('Resume 2023'), j = job('Staff Engineer', 'Globex', 80);
  setSource(s, 'running');
  setSource(s, 'done');
  db.query("UPDATE jobs SET status = 'running' WHERE id = ?").run(j);
  db.query("UPDATE jobs SET status = 'done', resume_status = 'running' WHERE id = ?").run(j);
  db.query("UPDATE jobs SET resume_status = 'failed', resume_note = 'No reader could be reached.' WHERE id = ?").run(j);
  const ref = `J-${String(j).padStart(3, '0')}`;
  const digest = activity(NOW()).digest;
  expect(digest.map((d) => d.line)).toEqual(['Resume 2023 was read', `the posting for ${ref} was read`, `the resume for ${ref} couldn’t be written`]);
  // Seen up to the latest line drawn: the server's own time is not used, so what ends later is still announced.
  const upTo = Math.max(...digest.map((d) => d.endedAt));
  expect(markSeen(NOW() + 60_000, NOW())).toBe('That time has not come yet.');
  expect(markSeen(upTo, NOW())).toBe('');
  expect(markSeen(upTo - 1, NOW())).toBe('A later digest has already been seen.');
  expect(seenAt()).toBe(upTo);
  expect(activity(NOW()).digest).toEqual([]);
  db.query("UPDATE jobs SET resume_status = 'queued' WHERE id = ?").run(j);
  db.query("UPDATE jobs SET resume_status = 'running' WHERE id = ?").run(j);
  Bun.sleepSync(5);
  db.query("UPDATE jobs SET resume_status = 'done' WHERE id = ?").run(j);
  expect(activity(NOW()).digest).toMatchObject([{ line: `the resume for ${ref} is ready`, link: `/job/${j}/resume` }]);
});

test('a failed row can be dismissed, and only a failed one', () => {
  const s = source('Broken export');
  setSource(s, 'failed', 'The text was empty.');
  const failed = itemOf('read-source', s)!;
  const other = source('Fine export');
  expect(dismiss(Number(itemOf('read-source', other)!.id), NOW())).toBe(false);
  expect(dismiss(Number(failed.id), NOW())).toBe(true);
  expect(dismiss(Number(failed.id), NOW())).toBe(false);
  expect(itemOf('read-source', s)).toBeUndefined();
  // Dismissing changes nothing else: the source still says it failed.
  expect((db.query('SELECT status FROM sources WHERE id = ?').get(s) as { status: string }).status).toBe('failed');
});

test('a thing marked done by hand puts its failure away, and is neither a run, a finished row nor news', () => {
  db.run("UPDATE profile SET status = 'running' WHERE id = 1");
  db.run("UPDATE profile SET status = 'failed', note = 'No reader could be reached.' WHERE id = 1");
  expect(itemOf('write-profile', 1)?.status).toBe('failed');
  // Saved by hand (POST /profile/save, tools/refresh.ts): straight to done.
  db.run("UPDATE profile SET status = 'done', note = '' WHERE id = 1");
  const a = activity(NOW());
  expect(a.items.find((i) => i.kind === 'write-profile')).toBeUndefined();
  expect(a.done.find((i) => i.kind === 'write-profile')).toBeUndefined();
  expect(a.digest.map((d) => d.line)).toEqual(['your profile couldn’t be written']);
  expect(rowsOf('write-profile', 1).map((r) => r.state)).toEqual(['failed', 'done']);
  // It still tells the screens that the profile changed.
  expect(a.changes.find((c) => c.kind === 'write-profile')!.at).toBeGreaterThan(0);
  expect(a.lastChanged).toBeGreaterThanOrEqual(a.changes.find((c) => c.kind === 'write-profile')!.at);
  // Asked for, then saved by hand before it started: not news either.
  db.run("UPDATE profile SET status = 'queued' WHERE id = 1");
  db.run("UPDATE profile SET status = 'done' WHERE id = 1");
  expect(activity(NOW()).digest.map((d) => d.line)).toEqual(['your profile couldn’t be written']);
});

test('rows that ended over 90 days ago are pruned, but a failure in view and the last 10 good runs of a kind stay', () => {
  const DAY = 86_400_000, now = NOW(), old = now - 200 * DAY;
  const add = (kind: string, state: string, ended: number, cleared = 0) => db.query('INSERT INTO activity (kind, subject, asked_at, started_at, ended_at, state, cleared_at) VALUES (?, 1, ?, ?, ?, ?, ?)').run(kind, ended - 60_000, ended - 60_000, ended, state, cleared);
  for (let i = 0; i < 12; i++) add('read-posting', 'done', old + i);
  add('read-posting', 'failed', old, 0);
  add('read-posting', 'failed', old, old + 5);
  add('write-reply', 'dropped', old);
  add('write-reply', 'done', now - DAY);
  expect(prune(now)).toBe(4);
  const left = db.query('SELECT kind, state, cleared_at, ended_at FROM activity ORDER BY id').all() as { kind: string; state: string; cleared_at: number; ended_at: number }[];
  expect(left.filter((r) => r.kind === 'read-posting' && r.state === 'done').map((r) => r.ended_at)).toEqual(Array.from({ length: 10 }, (_, i) => old + 2 + i));
  expect(left.filter((r) => r.state === 'failed').map((r) => r.cleared_at)).toEqual([0]);
  expect(left.filter((r) => r.kind === 'write-reply').map((r) => r.state)).toEqual(['done']);
  expect(usual().get('read-posting')).toBe(60_000);
});

test('when the record changed, the time the studio will write unsent resumes again is said, within 20 minutes only', () => {
  db.run("UPDATE jobs SET outcome = 'rejected'");
  db.run("UPDATE activity_bank SET sig = '', since = 0");
  const t = 1_900_000_000_000, MIN = 60_000;
  expect(dueIn(t, () => 'sig-b')).toBe(0);
  // An unsent resume written from an older record: due 3 minutes after the record was first seen changed.
  const id = job('Staff Engineer', 'Globex', 80);
  db.query("UPDATE jobs SET status = 'done', resume = '# Ada Example', bank_sig = 'sig-a', resume_status = 'done', outcome = '' WHERE id = ?").run(id);
  expect(dueIn(t, () => 'sig-a')).toBe(0);
  expect(dueIn(t, () => 'sig-b')).toBe(3 * MIN);
  expect(dueIn(t + MIN, () => 'sig-b')).toBe(2 * MIN);
  // The record changed again: the wait starts again.
  expect(dueIn(t + 2 * MIN, () => 'sig-c')).toBe(3 * MIN);
  // Overdue by more than a minute: the worker is not taking it, so nothing is said (an idle tab must not keep asking).
  expect(dueIn(t + 7 * MIN, () => 'sig-c')).toBe(0);
  // More than 20 minutes away is not said either; the answer is part of GET /activity while nothing is in hand.
  db.query("UPDATE activity_bank SET since = ? WHERE id = 1").run(t + 30 * MIN);
  expect(dueIn(t, () => 'sig-c')).toBe(0);
  expect(activity(t + 31 * MIN, () => 'sig-c').dueIn).toBe(2 * MIN);
  // A resume edited by hand is never written again by itself; nor any when the rule is off.
  db.query('UPDATE jobs SET edited = 1 WHERE id = ?').run(id);
  expect(dueIn(t + 31 * MIN, () => 'sig-c')).toBe(0);
  process.env.EGG_AUTO_RESUME = 'off';
  db.query('UPDATE jobs SET edited = 0 WHERE id = ?').run(id);
  expect(dueIn(t + 31 * MIN, () => 'sig-c')).toBe(0);
  delete process.env.EGG_AUTO_RESUME;
});
