// `bun test lib`: the You screen's read models (lib/you.ts). What stands out is chosen from the record in the order of
// projects (lib/standing.ts), one fact per project by a fixed rule; the owner's own line is never replaced, a project
// left out gives its place to the next. Everything told is the record as one document with the words behind each fact,
// and leaves out what the profile may not use. On a scratch database; every person and employer is invented.
import { beforeEach, expect, test } from 'bun:test';
import { db, fact, reset, role } from './scratch.ts';
import { addOrigin } from './origins.ts';
import { keptFacts, mayUse, placeProject, setFactMark, setProjectMark } from './standing.ts';
import { syncProjects } from './projects.ts';
import { bringBack, day, leaveOut, leftOut, MAX_LINE, pick, restore, setStandOut, standsOut, STAND_OUTS, told, toldCounts } from './you.ts';

const TODAY = '2026-11';
let console1 = 0, billing = 0, quoting = 0, support = 0, tides = 0, empty = 0;
const project = (roleId: number, title: string, parts: Record<string, string> = {}) =>
  (db.query('INSERT INTO projects (role_id, title, context, action, result, learning, created_at) VALUES (?, ?, ?, ?, ?, ?, 1) RETURNING id')
    .get(roleId, title, parts.context ?? '', parts.action ?? '', parts.result ?? '', parts.learning ?? '') as { id: number }).id;
const inProject = (p: number, roleId: number, text: string, metric = '') => { const id = fact(roleId, text, metric); db.query('UPDATE facts SET project_id = ? WHERE id = ?').run(p, id); return id; };

beforeEach(() => {
  reset();
  role({ id: 1, company: 'Harborlight Systems', title: 'Director of Engineering', start: '2021-03' });
  role({ id: 2, company: 'Quillfeather Labs', title: 'Senior Engineer', start: '2016-01', end: '2021-02' });
  role({ id: 3, company: 'Tessellate Freight', title: 'Support Lead', start: '2010-05', end: '2012-08' });
  // A side project: a `roles` row its project points at.
  role({ id: 10, company: 'Tidepool Tide Tables', title: '', start: '2023-05', end: '2024-02', standing: 'personal' });
  syncProjects(1);
  tides = (db.query('SELECT id FROM projects WHERE via_role = 10').get() as { id: number }).id;
  console1 = project(1, 'Dispatch console', { context: 'Schedulers used paper.', result: 'The paper went.' });
  billing = project(1, 'Billing run');
  quoting = project(2, 'Quoting API');
  support = project(3, 'Support desk');
  empty = project(2, 'Nothing told yet');
  // The order is the owner's, so the test does not depend on dates: console, billing, empty, quoting, support, tides.
  [console1, billing, empty, quoting, support, tides].forEach((p, i) => expect(placeProject(p, i + 1)).toBe(''));
});

test('one line per project in the order of projects, a project with no fact skipped, four at most', () => {
  inProject(console1, 1, 'Built the dispatch console.');
  inProject(console1, 1, 'Cut dispatch time.', '12 minutes to 3');
  inProject(billing, 1, 'Moved billing to nightly runs.');
  inProject(quoting, 2, 'Rebuilt the quoting API.', 'p95 latency 900 ms to 210 ms');
  inProject(support, 3, 'Led the support desk.');
  fact(10, 'Published tide tables for 40 harbours.');
  const lines = standsOut(TODAY);
  expect(lines.length).toBe(STAND_OUTS);
  expect(lines.map((l) => [l.place, l.projectTitle, l.text, l.metric, l.edited])).toEqual([
    [1, 'Dispatch console', 'Cut dispatch time.', '12 minutes to 3', false],
    [2, 'Billing run', 'Moved billing to nightly runs.', '', false],
    [3, 'Quoting API', 'Rebuilt the quoting API.', 'p95 latency 900 ms to 210 ms', false],
    [4, 'Support desk', 'Led the support desk.', '', false],
  ]);
});

test('the fact a project shows: one a saved job leans on, then one with a measured result, then the first', () => {
  const facts = [{ id: 1, metric: '' }, { id: 2, metric: '40 users' }, { id: 3, metric: '9 depots' }];
  expect(pick(facts, new Set([3]))?.id).toBe(3);
  expect(pick(facts, new Set())?.id).toBe(2);
  expect(pick([{ id: 5, metric: '' }, { id: 6, metric: ' ' }], new Set())?.id).toBe(5);
  expect(pick([], new Set())).toBeUndefined();
  // In the record: an unsent job names the second measured fact as its best evidence.
  inProject(console1, 1, 'Built the dispatch console.', 'p95 latency 900 ms to 210 ms');
  const depots = inProject(console1, 1, 'Rolled the console out.', '640 users');
  db.query("INSERT INTO jobs (posting, title, company, status, analysis, resume, created_at, outcome) VALUES ('A posting.', 'Engineer', 'Initech', 'done', ?, '# A resume', 1, '')")
    .run(JSON.stringify({ requirements: [{ text: 'Rollouts', need: 'must', coverage: 'strong', evidence: '', best: `fact:${depots}` }] }));
  expect(standsOut(TODAY)[0]).toMatchObject({ factId: String(depots), text: 'Rolled the console out.' });
});

test('the owner’s own line is shown as written and never replaced, even past fourth place; a project left out gives its place', () => {
  const built = inProject(console1, 1, 'Built the dispatch console.');
  inProject(billing, 1, 'Moved billing to nightly runs.');
  inProject(quoting, 2, 'Rebuilt the quoting API.');
  inProject(support, 3, 'Led the support desk.');
  fact(10, 'Published tide tables for 40 harbours.');
  expect(setStandOut(console1, '  Gave 12 depots one console in place of paper.  ', 5)).toBe('');
  // A later fact with a measured result is now the fact the project would show; the owner's line stays theirs.
  const cut = inProject(console1, 1, 'Cut dispatch time.', '12 minutes to 3');
  expect(standsOut(TODAY)[0]).toEqual({ place: 1, factId: String(cut), projectId: String(console1), projectTitle: 'Dispatch console', text: 'Gave 12 depots one console in place of paper.', metric: '', edited: true, hasRecordLine: true });
  expect(built).not.toBe(cut);
  // The project moves to last place, far past fourth: the owner's line is still there, first, and three chosen lines follow.
  expect(placeProject(console1, 6)).toBe('');
  expect(standsOut(TODAY).map((l) => [l.place, l.projectTitle, l.edited])).toEqual([[1, 'Dispatch console', true], [2, 'Billing run', false], [3, 'Quoting API', false], [4, 'Support desk', false]]);
  // Lines the owner wrote for more than four projects: all of theirs, in the order of projects, and none chosen.
  for (const [p, w] of [[billing, 'B.'], [quoting, 'Q.'], [support, 'S.'], [tides, 'T.']] as const) expect(setStandOut(p, w, 6)).toBe('');
  expect(standsOut(TODAY).map((l) => [l.place, l.text])).toEqual([[1, 'B.'], [2, 'Q.'], [3, 'S.'], [4, 'T.'], [5, 'Gave 12 depots one console in place of paper.']]);
  for (const p of [billing, quoting, support, tides]) expect(restore(p)).toBe('');
  // Left out, the project gives its place; restored, it comes back with the owner's own words, not the record's choice.
  expect(leaveOut(console1, 7)).toBe('');
  expect(standsOut(TODAY).map((l) => l.projectTitle)).toEqual(['Billing run', 'Quoting API', 'Support desk', 'Tidepool Tide Tables']);
  expect(db.query('SELECT text, left_out FROM stand_outs WHERE project_id = ?').get(console1)).toEqual({ text: 'Gave 12 depots one console in place of paper.', left_out: 1 });
  expect(bringBack(console1)).toBe('');
  expect(bringBack(console1)).toBe('');
  expect(standsOut(TODAY)[0]).toMatchObject({ projectTitle: 'Dispatch console', text: 'Gave 12 depots one console in place of paper.', edited: true });
  // Restored again, the owner's line is taken back and the record's choice shows, in the project's own place.
  expect(restore(console1)).toBe('');
  expect(standsOut(TODAY).map((l) => [l.projectTitle, l.text])).toEqual([['Billing run', 'Moved billing to nightly runs.'], ['Quoting API', 'Rebuilt the quoting API.'], ['Support desk', 'Led the support desk.'], ['Tidepool Tide Tables', 'Published tide tables for 40 harbours.']]);
  // A line the owner writes for a project left out brings it back with their words.
  expect(leaveOut(console1, 8)).toBe('');
  expect(setStandOut(console1, 'My words.', 9)).toBe('');
  expect(standsOut(TODAY)[0]).toMatchObject({ text: 'My words.', edited: true });
  // Refusals, said in words, and nothing changed.
  expect(setStandOut(console1, '   ', 9)).toBe('Write the line, or leave the project out.');
  expect(setStandOut(console1, 'a'.repeat(MAX_LINE + 1), 9)).toBe(`Keep the line to one line of at most ${MAX_LINE} characters.`);
  expect(setStandOut(console1, 'Two\nlines', 9)).toBe(`Keep the line to one line of at most ${MAX_LINE} characters.`);
  expect(setStandOut(99999, 'Words.', 9)).toBe('That project is not in the record.');
  expect(leaveOut(Number.NaN, 9)).toBe('That project is not in the record.');
  expect(standsOut(TODAY)[0]).toMatchObject({ text: 'My words.' });
  // A deleted project takes its line with it.
  db.query('DELETE FROM projects WHERE id = ?').run(console1);
  expect(db.query('SELECT count(*) AS n FROM stand_outs WHERE project_id = ?').get(console1)).toEqual({ n: 0 });
});

test('what stands out leaves out what the profile may not use: a kept fact, and a kept project', () => {
  const secret = inProject(console1, 1, 'Built the console for an unnamed client.', '9 depots');
  inProject(console1, 1, 'Built the dispatch console.');
  inProject(billing, 1, 'Moved billing to nightly runs.');
  expect(setFactMark(secret, 'kept')).toBe('');
  expect(standsOut(TODAY).map((l) => l.text)).toEqual(['Built the dispatch console.', 'Moved billing to nightly runs.']);
  expect(setProjectMark(console1, 'kept')).toBe('');
  expect(setStandOut(console1, 'My words about the console.', 3)).toBe('');
  expect(standsOut(TODAY).map((l) => l.projectTitle)).toEqual(['Billing run']);
});

test('everything told: roles newest first, their projects with the parts told, facts with the words behind them, kept ones left out', () => {
  const built = inProject(console1, 1, 'Built the dispatch console.', '640 users');
  const secret = inProject(console1, 1, 'Built the console for an unnamed client.');
  const day1 = fact(1, 'Ran the weekly planning call.');
  inProject(quoting, 2, 'Rebuilt the quoting API.');
  fact(10, 'Published tide tables for 40 harbours.');
  const general = fact(null, 'Speaks conversational Icelandic.');
  expect(setFactMark(secret, 'kept')).toBe('');
  const at = Date.UTC(2026, 2, 3, 12);
  const turn = (db.query("INSERT INTO talk (who, body, created_at) VALUES ('you', 'I built the dispatch console. 640 people use it.', ?) RETURNING id").get(at) as { id: number }).id;
  expect(addOrigin(built, { kind: 'talk', refId: turn, start: 2, end: 29 }, at + 999_999_999).ok).toBe(true);
  const t = told();
  expect(t.roles.map((r) => r.company)).toEqual(['Harborlight Systems', 'Quillfeather Labs', 'Tessellate Freight']);
  const harbor = t.roles[0];
  expect(harbor.projects.map((p) => p.title)).toEqual(['Dispatch console', 'Billing run']);
  expect(harbor.projects[0].parts).toEqual([{ name: 'Context', text: 'Schedulers used paper.' }, { name: 'Result', text: 'The paper went.' }]);
  // The words behind a fact, dated by when they were said; a fact with none has none, and a kept fact is not there.
  expect(harbor.projects[0].facts).toEqual([{ id: String(built), ref: expect.stringMatching(/^F-/), text: 'Built the dispatch console.', metric: '640 users', origins: [{ id: expect.any(String), kind: 'talk', when: day(at), quote: 'built the dispatch console.' }] }]);
  expect(day(at)).toBe('Mar 3, 2026');
  expect(harbor.facts.map((f) => [f.id, f.origins])).toEqual([[String(day1), []]]);
  expect(t.sides.map((p) => [p.title, p.facts.map((f) => f.text)])).toEqual([['Tidepool Tide Tables', ['Published tide tables for 40 harbours.']]]);
  expect(t.general.map((f) => f.id)).toEqual([String(general)]);
  expect(JSON.stringify(t)).not.toContain('unnamed client');
  expect(t.counts).toEqual({ roles: 3, projects: 6, facts: 5, withWords: 1 });
  // A kept project is left out whole.
  expect(setProjectMark(console1, 'kept')).toBe('');
  expect(told().roles[0].projects.map((p) => p.title)).toEqual(['Billing run']);
  expect(told().counts).toEqual({ roles: 3, projects: 5, facts: 4, withWords: 0 });
});

// With no place set by the owner, the order is lib/standing.ts's own (rank, autoOrder, rankItems). No screen writes a
// project's state yet, so it is the record's convention that decides current work: a project in a role with no end,
// itself with no end, counts as running (currentByRecord) and comes first; then projects with an end month, newest first.
test('with no places set, current work comes first, then work that ended, newest first', () => {
  for (const p of [console1, billing, empty, quoting, support, tides]) expect(placeProject(p, null)).toBe('');
  db.query("UPDATE projects SET start = '2024-01', end = '' WHERE id = ?").run(console1);
  db.query("UPDATE projects SET start = '2017-01', end = '2019-06' WHERE id = ?").run(quoting);
  db.query("UPDATE projects SET start = '2011-01', end = '2012-02' WHERE id = ?").run(support);
  for (const [p, r] of [[console1, 1], [billing, 1], [quoting, 2], [support, 3]] as const) inProject(p, r, `A fact of project ${p}.`);
  fact(10, 'Published tide tables for 40 harbours.');
  // Harborlight (role 1) is current. The console (from 2024-01) and billing (no dates of its own) are current work in it;
  // the console has 35 months to billing's none. Then the side project's row (ended 2024-02) and the quoting API (2019-06).
  expect(standsOut(TODAY).map((l) => l.projectTitle)).toEqual(['Dispatch console', 'Billing run', 'Tidepool Tide Tables', 'Quoting API']);
});

test('a kept fact’s words are not shown through another fact’s origin on the same message', () => {
  const at = Date.UTC(2026, 2, 3, 12);
  const body = 'I built the console for Varnholt Bank under NDA. It cut dispatch time to 3 minutes.';
  const turn = (db.query("INSERT INTO talk (who, body, created_at) VALUES ('you', ?, ?) RETURNING id").get(body, at) as { id: number }).id;
  const secret = fact(1, 'Built the console for Varnholt Bank.'), cut = fact(1, 'Cut dispatch time to 3 minutes.'), other = fact(1, 'Ran the rota.');
  const span = (w: string) => ({ start: body.indexOf(w), end: body.indexOf(w) + w.length });
  expect(addOrigin(secret, { kind: 'talk', refId: turn, ...span('I built the console for Varnholt Bank under NDA.') }).ok).toBe(true);
  // A passage of its own, apart from the kept one; and the whole message, which holds the kept words.
  expect(addOrigin(cut, { kind: 'talk', refId: turn, ...span('It cut dispatch time to 3 minutes.') }).ok).toBe(true);
  expect(addOrigin(other, { kind: 'talk', refId: turn, start: 0, end: body.length }).ok).toBe(true);
  const quotesOf = (t: ReturnType<typeof told>) => Object.fromEntries(t.roles[0].facts.map((f) => [f.text, f.origins.map((o) => o.quote)]));
  expect(quotesOf(told())).toEqual({ 'Built the console for Varnholt Bank.': ['I built the console for Varnholt Bank under NDA.'], 'Cut dispatch time to 3 minutes.': ['It cut dispatch time to 3 minutes.'], 'Ran the rota.': [body] });
  expect(setFactMark(secret, 'kept')).toBe('');
  const t = told();
  expect(quotesOf(t)).toEqual({ 'Cut dispatch time to 3 minutes.': ['It cut dispatch time to 3 minutes.'], 'Ran the rota.': [] });
  expect(JSON.stringify(t)).not.toContain('Varnholt');
  expect(t.counts).toEqual(toldCounts());
  expect(t.counts.withWords).toBe(1);
  // A kept project hides the words of the facts in it the same way.
  expect(setFactMark(secret, '')).toBe('');
  db.query('UPDATE facts SET project_id = ? WHERE id = ?').run(console1, secret);
  expect(setProjectMark(console1, 'kept')).toBe('');
  expect(JSON.stringify(told())).not.toContain('Varnholt');
  expect(told().counts).toEqual(toldCounts());
});

test('one query for kept facts agrees with mayUse on every fact', () => {
  const a = inProject(console1, 1, 'In a project to be kept.'), b = fact(1, 'Kept by its own mark.'), c = fact(10, 'In the side project.'), d = fact(null, 'General.');
  expect(setFactMark(b, 'kept')).toBe('');
  expect(setProjectMark(console1, 'kept')).toBe('');
  expect(setProjectMark(tides, 'kept')).toBe('');
  const kept = keptFacts();
  for (const id of [a, b, c, d]) expect([id, kept.has(id)]).toEqual([id, !mayUse(id, 'profile')]);
  expect([...kept].sort((x, y) => x - y)).toEqual([a, b, c].sort((x, y) => x - y));
});

test('the projects left out are listed in the order of projects, with whether the owner wrote a line; kept ones are not', () => {
  for (const [p, r] of [[console1, 1], [billing, 1], [quoting, 2]] as const) inProject(p, r, `A fact of project ${p}.`);
  expect(leftOut(TODAY)).toEqual([]);
  expect(setStandOut(quoting, 'My words about quoting.', 1)).toBe('');
  for (const p of [quoting, console1, billing, support]) expect(leaveOut(p, 2)).toBe('');
  expect(setProjectMark(billing, 'kept')).toBe('');
  expect(leftOut(TODAY)).toEqual([
    { projectId: String(console1), projectTitle: 'Dispatch console', hasOwnLine: false },
    { projectId: String(quoting), projectTitle: 'Quoting API', hasOwnLine: true },
    { projectId: String(support), projectTitle: 'Support desk', hasOwnLine: false },
  ]);
  expect(standsOut(TODAY).map((l) => l.projectTitle)).not.toContain('Quoting API');
  // Restored, a project leaves the list: with the owner's line when they wrote one.
  expect(bringBack(quoting)).toBe('');
  expect(leftOut(TODAY).map((l) => l.projectTitle)).toEqual(['Dispatch console', 'Support desk']);
  expect(standsOut(TODAY)[0]).toMatchObject({ projectTitle: 'Quoting API', text: 'My words about quoting.', edited: true });
});

test("restoring an owner's line without a usable record fact keeps their words", () => {
  expect(setStandOut(empty, 'My only line.', 3)).toBe('');
  expect(standsOut(TODAY)[0]).toMatchObject({ text: 'My only line.', hasRecordLine: false });
  expect(restore(empty)).toBe('This project has no line in the record to use.');
  expect(standsOut(TODAY)[0].text).toBe('My only line.');
});

test('an origin is added once and legacy duplicate spans are shown once', () => {
  const id = inProject(console1, 1, 'Shipped a console.');
  const origin = { kind: 'typed', refId: id, start: 0, end: 7 } as const;
  const added = addOrigin(id, origin, 1);
  expect(added.ok).toBe(true);
  expect(addOrigin(id, origin, 2)).toEqual(added);
  expect(db.query('SELECT COUNT(*) AS n FROM fact_origins WHERE fact_id = ?').get(id)).toEqual({ n: 1 });
  db.query(`INSERT INTO fact_origins (fact_id, kind, ref_id, span_start, span_end, quote, added_at)
    SELECT fact_id, kind, ref_id, span_start, span_end, quote, added_at FROM fact_origins WHERE fact_id = ?`).run(id);
  expect(told().roles[0].projects[0].facts[0].origins).toHaveLength(1);
});
