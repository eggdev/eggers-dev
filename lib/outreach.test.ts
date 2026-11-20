// `bun test lib`: the message drafts for one job (lib/outreach.ts), with a stand-in for the model (fakeAsk) and a
// scratch database of an invented person. What it proves: a draft may use what the person says they learned, and the
// background of a project, only for the projects whose facts carry the application; the kept lines of "How you work"
// help choose and are never facts; a number that stands only in those, and in no fact, is sent back once and a draft
// that still has it is left out. Everything is invented.
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { db, fact, seed } from './scratch.ts';
import { fakeAsk, type Ask } from './llm.ts';
import { draft, storeDrafts } from './outreach.ts';
import type { JobRow } from './jobs.ts';
import { judge } from './derived.ts';
import { derivedNow } from './record.ts';
import { KEPT_LINES, LEARNED, NUMBER_MARK } from './writing.ts';

const CONSOLE = 'Built the dispatch console that schedulers use every day.', QUOTING = 'Rebuilt the quoting API.';
const idOf = (text: string) => (db.query('SELECT id FROM facts WHERE text = ?').get(text) as { id: number }).id;
const project = (roleId: number, title: string, parts: { context?: string; result?: string; learning?: string }) =>
  (db.query('INSERT INTO projects (role_id, title, context, result, learning, created_at) VALUES (?, ?, ?, ?, ?, 1) RETURNING id')
    .get(roleId, title, parts.context ?? '', parts.result ?? '', parts.learning ?? '') as { id: number }).id;
function job(best: string[], strengths = ['Built a dispatch console used every day.']): JobRow & { contact: string } {
  const analysis = { verdict: 'A fair fit.', strengths, requirements: best.map((b, i) => ({ text: `Requirement ${i}`, need: 'must', coverage: 'strong', evidence: '', best: b })) };
  return db.query("INSERT INTO jobs (posting, title, company, status, analysis, created_at, contact) VALUES ('Staff Engineer at Nimbus Yard. Build dispatch software.', 'Staff Engineer', 'Nimbus Yard', 'done', ?, 1, '') RETURNING *")
    .get(JSON.stringify(analysis)) as JobRow & { contact: string };
}
const door = (message: string) => ({ to: 'The hiring manager', find: 'Search for the team lead.', why: 'They run the team.', message });

beforeEach(() => {
  seed();
  const consoleProject = project(1, 'Dispatch console', { context: 'Schedulers planned 35 depots on paper.', result: 'One console for every depot.', learning: 'I learned to ship in 3 week steps.' });
  const quoting = project(2, 'Quoting API', { learning: 'I learned to read flame graphs.' });
  db.query('UPDATE facts SET project_id = ? WHERE id = ?').run(consoleProject, idOf(CONSOLE));
  db.query('UPDATE facts SET project_id = ? WHERE id = ?').run(quoting, idOf(QUOTING));
  fact(1, 'Managed a team of 5 engineers.');
  expect(judge(derivedNow(), 'led', 'kept', 1)).toBe('');
});
afterEach(() => fakeAsk());

test('learned and the background are sent only for the projects whose facts carry the application; kept lines in their own block', async () => {
  const calls: Ask[] = [];
  fakeAsk((c) => { calls.push(c); return { doors: [door('I built the dispatch console that 640 users open every day. Could we talk for 15 minutes? Avery')] }; });
  const { doors } = await draft(job([`fact:${idOf(CONSOLE)}`, 'role:2']), '.');
  expect(calls.length).toBe(1);
  expect(doors.map((d) => d.message)).toEqual(['I built the dispatch console that 640 users open every day. Could we talk for 15 minutes? Avery']);
  const prompt = calls[0].prompt;
  expect(prompt).toContain(LEARNED);
  for (const sent of ['Dispatch console', 'Schedulers planned [number] depots on paper.', 'One console for every depot.', 'I learned to ship in [number] week steps.', CONSOLE, NUMBER_MARK]) expect([sent, prompt.includes(sent)]).toEqual([sent, true]);
  // The quoting API's facts are not used for this job: what was learned there is not sent.
  expect(prompt).not.toContain('flame graphs');
  expect(prompt).toContain(`${KEPT_LINES}\n- Your record shows you managing, hiring or growing a team in [number] of [number] roles.`);
  // The numbers no fact of the project holds are never shown to the model.
  for (const hidden of ['35 depots', '3 week', '2 of 3']) expect([hidden, prompt.includes(hidden)]).toEqual([hidden, false]);
  // With no fact of a project in use, there is no block of learnings.
  calls.length = 0;
  await draft(job(['role:2']), '.');
  expect(calls[0].prompt).not.toContain(LEARNED);
  expect(calls[0].prompt).not.toContain('ship in 3 week');
});

test('a number that stands only in what was learned, a background or a kept line is sent back once; a draft that keeps it is left out', async () => {
  const calls: Ask[] = [];
  const learnedNumber = door('I learned to ship in 3 week steps while building a dispatch console. Could we talk? Avery');
  const fine = door('I built the dispatch console that 640 users open every day. Could we talk? Avery');
  fakeAsk((c) => { calls.push(c); return calls.length === 1 ? { doors: [learnedNumber, fine] } : { doors: [door('I learned to ship in small steps while building a dispatch console. Could we talk? Avery'), fine] }; });
  const { doors, left } = await draft(job([`fact:${idOf(CONSOLE)}`]), '.');
  expect(calls.length).toBe(2);
  expect(calls[1].prompt).toContain('“I learned to ship in 3 week steps while building a dispatch console. Could we talk? Avery” uses 3, which the record has only in what the person learned or a project’s background, not in a fact.');
  expect(doors.map((d) => d.message)).toEqual(['I learned to ship in small steps while building a dispatch console. Could we talk? Avery', fine.message]);
  expect(left).toBe(0);
  // Sent back and still there: that draft is left out, and the others stay.
  calls.length = 0;
  const background = door('Schedulers at 35 depots planned on paper until I built one console. Could we talk? Avery');
  fakeAsk((c) => { calls.push(c); return { doors: [background, fine] }; });
  expect(await draft(job([`fact:${idOf(CONSOLE)}`]), '.')).toEqual({ doors: [fine], left: 1 });
  expect(calls.length).toBe(2);
});

test('only the facts, the profile, the posting and the person\'s note may hold a number: not what a model wrote about the job', async () => {
  // The first reading's strengths were written by a model that saw the project's background.
  const j = job([`fact:${idOf(CONSOLE)}`], ['Replaced paper planning in 35 depots with one console.']);
  const copied = door('I replaced paper planning in 35 depots. Could we talk? Avery');
  fakeAsk(() => ({ doors: [copied] }));
  expect(await draft(j, '.')).toEqual({ doors: [], left: 1 });
  // A number inside a name is no count: a draft about S3 is kept even with a 3 in the background.
  fact(1, 'Moved file storage.', '', 'S3');
  db.run("UPDATE projects SET context = 'Schedulers planned 3 regions on paper.' WHERE title = 'Dispatch console'");
  const s3 = door('I moved our file storage to S3. Could we talk? Avery');
  fakeAsk(() => ({ doors: [s3] }));
  expect(await draft(j, '.')).toEqual({ doors: [s3], left: 0 });
});

test('the repair keeps every good draft in its place, even when its reply leaves drafts out', async () => {
  const good = [door('I built the dispatch console that 640 users open every day. Avery'), door('Could we talk about dispatch software? Avery')];
  const bad = door('Schedulers at 35 depots planned on paper until I built one console. Avery');
  let n = 0;
  fakeAsk(() => (++n === 1 ? { doors: [good[0], bad, good[1]] } : { doors: [door('nothing useful'), door('Schedulers planned on paper until I built one console. Avery')] }));
  expect(await draft(job([`fact:${idOf(CONSOLE)}`]), '.')).toEqual({ doors: [good[0], door('Schedulers planned on paper until I built one console. Avery'), good[1]], left: 0 });
});

test('drafts left out are said on the job; when all are, the earlier drafts stay, and the screen never looks undrafted', () => {
  const j = job([`fact:${idOf(CONSOLE)}`]);
  const row = () => db.query('SELECT outreach, outreach_status, outreach_note FROM jobs WHERE id = ?').get(j.id) as { outreach: string; outreach_status: string; outreach_note: string };
  const kept = [door('I built the dispatch console. Avery')];
  storeDrafts(j.id, { doors: kept, left: 0 });
  expect(row()).toEqual({ outreach: JSON.stringify(kept), outreach_status: 'done', outreach_note: '' });
  storeDrafts(j.id, { doors: kept, left: 1 });
  expect(row().outreach_note).toBe('One draft was left out. It used a number your record does not hold.');
  storeDrafts(j.id, { doors: kept, left: 2 });
  expect(row().outreach_note).toBe('Two drafts were left out. Each used a number your record does not hold.');
  // Every new draft left out: the earlier ones stay, and the note says so.
  storeDrafts(j.id, { doors: [], left: 4 });
  expect(row()).toEqual({ outreach: JSON.stringify(kept), outreach_status: 'done', outreach_note: 'The new drafts were left out: each used a number your record does not hold. These are the earlier drafts.' });
  // With no earlier drafts, the note says that every draft was left out.
  const k = job([`fact:${idOf(CONSOLE)}`]);
  storeDrafts(k.id, { doors: [], left: 3 });
  expect(db.query('SELECT outreach, outreach_status, outreach_note FROM jobs WHERE id = ?').get(k.id)).toEqual({ outreach: '[]', outreach_status: 'done', outreach_note: 'Every draft was left out: each used a number your record does not hold. Draft again to have new ones written.' });
  for (const note of [row().outreach_note]) expect(note).not.toMatch(/model|claude|opus|sonnet|codex/i);
});

test('a draft that prints [number] is sent back; if the answer still has it, that draft is left out and the job says so', async () => {
  const good = door('I built the dispatch console that 640 users open every day. Avery');
  const marked = door('Schedulers planned [number] depots on paper until I built one console. Avery');
  let n = 0;
  fakeAsk(() => (++n === 1 ? { doors: [good, marked] } : { doors: [good, door('Schedulers planned on paper until I built one console. Avery')] }));
  expect(await draft(job([`fact:${idOf(CONSOLE)}`]), '.')).toEqual({ doors: [good, door('Schedulers planned on paper until I built one console. Avery')], left: 0 });
  fakeAsk(() => ({ doors: [good, marked] }));
  const j = job([`fact:${idOf(CONSOLE)}`]), drafted = await draft(j, '.');
  expect(drafted).toEqual({ doors: [good], left: 1 });
  storeDrafts(j.id, drafted);
  expect((db.query('SELECT outreach_note FROM jobs WHERE id = ?').get(j.id) as { outreach_note: string }).outreach_note).toBe('One draft was left out. It used a number your record does not hold.');
});

test('a repair reply that reorders the drafts is checked again after the merge: a wrong pairing never lets a bad draft through', async () => {
  const good = door('I built the dispatch console that 640 users open every day. Avery');
  const bad = door('Schedulers at 35 depots planned on paper until I built one console. Avery');
  const fixed = door('Schedulers planned on paper until I built one console. Avery');
  let n = 0;
  // The reply puts the fixed draft first and the unfixed one second: the merge takes the second for the bad draft's place.
  fakeAsk(() => (++n === 1 ? { doors: [good, bad] } : { doors: [fixed, bad] }));
  expect(await draft(job([`fact:${idOf(CONSOLE)}`]), '.')).toEqual({ doors: [good], left: 1 });
});
