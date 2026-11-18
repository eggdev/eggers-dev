// `bun test lib`: the resume as the screen (lib/resumeview.ts, GET /jobs/:id/resume), on the scratch database of an
// invented person. Rows with the facts each line uses; notes on the line they concern, worded for the owner, in order; the
// balance and what the record has more for; the version head; and nothing that DESIGN.md rule 4 forbids. Each case the
// review of the screen reproduced is a test here.
import { beforeEach, expect, test } from 'bun:test';
import { db, fact, role, seed } from './scratch.ts';
import { readAgain, reflag, type Analysis, type Requirement } from './jobs.ts';
import { raise } from './raised.ts';
import { storeLinks, type Links } from './links.ts';
import { sigOf } from './checks.ts';
import { HOME_RECORD } from './gaps.ts';
import { balanceOf, LEGACY_LINE, resumeView, type Row } from './resumeview.ts';
import { setResume } from './versions.ts';

// The screen's references carry a non-breaking hyphen; compared here as plain ones.
const p = (s: string) => s.replace(/‑/g, '-');
const RESUME = `# Avery Lindqvist
Duluth, MN · avery@lindqvist.example

## Summary
Engineer with 14 years building logistics software in Go.

## Experience
### Director of Engineering, Harborlight Systems
Mar 2021 – Present
- Build the dispatch console that 640 users across 12 depots open every day.
- Cut the nightly billing run from 6 hours to 40 minutes for 2,400 drivers.
- Mentored two engineers.
- Ran the test suite for the console.

### Senior Engineer, Quillfeather Labs
Jan 2016 – Feb 2021
- Rebuilt the quoting API in Go.

## Skills
Go`;
const H = 'harborlight systems', Q = 'quillfeather labs';
const line = (entry: string, text: string, facts: number[], edited = 0) => ({ where: 'bullet' as const, entry, text, facts, edited });
const EDITED = Date.UTC(2026, 10, 14, 12);
const LINKS: Links = { v: 1, lines: [
  { where: 'summary', entry: '', text: 'Engineer with 14 years building logistics software in Go.', facts: [1, 4], edited: 0 },
  line(H, 'Build the dispatch console that 640 users across 12 depots open every day.', [1]),
  line(H, 'Cut the nightly billing run from 6 hours to 40 minutes for 2,400 drivers.', [2]),
  line(H, 'Mentored two engineers.', [], EDITED),
  line(H, 'Ran the test suite for the console.', [3], EDITED),
  line(Q, 'Rebuilt the quoting API in Go.', [4, 99]),
] };
const req = (text: string, coverage: Requirement['coverage'], best = ''): Requirement => ({ text, need: 'must', coverage, evidence: '', roles: [], best, weight: 0.5 });
const REQS = [req('Kafka at scale', 'none'), req('Support desks', 'strong', 'fact:6'), req('Code review culture', 'strong', 'fact:5'), req('Dispatch software', 'strong', 'fact:1'), req('Go services', 'strong', 'role:2'), req('Owning delivery', 'partial')];
const BASE: Analysis = { verdict: '', requirements: REQS, strengths: [], risks: [], changes: [], gaps: [] };
function job(links: Links | null = LINKS, resume = RESUME, analysis: Partial<Analysis> = {}): number {
  const id = (db.query("INSERT INTO jobs (posting, title, company, status, analysis, resume, links, created_at, outcome) VALUES ('A posting.', 'Staff Engineer', 'Nimbus Yard', 'done', ?, ?, ?, 1, '') RETURNING id")
    .get(JSON.stringify({ ...BASE, ...analysis }), resume, storeLinks(links)) as { id: number }).id;
  reflag(id);
  return id;
}
const rowOf = (rows: Row[], start: string) => rows.find((r) => r.text.startsWith(start))!;
const notesOf = (r: Row) => r.notes.map((n) => [n.kind, n.lead, p(n.text)]);
const refsOf = (r: Row) => r.refs.map((x) => p(x.code));
const doc = (body: string) => `# Avery Lindqvist\nDuluth\n\n## Experience\n${body}`;
const ref4 = (id: number) => `F-${String(id).padStart(4, '0')}`;

beforeEach(() => {
  seed();
  // Two questions still open about the record: one about a fact, one about a role.
  raise('record', [{ key: 'record:baseline:1', text: 'Built the dispatch console that schedulers use every day. What was the number before?', about: 'fact:1', choices: ['Give it', 'There was none', 'I don’t know'] },
    { key: 'record:start:2', text: 'When did you start as Senior Engineer at Quillfeather Labs?', about: 'role:2', choices: [], data: { route: '/record/role/2' } }], 1);
});

test('a linked resume: one row per line, the facts each line uses, the role of each heading, and the facts whole', () => {
  const v = resumeView(job())!;
  expect(v.rows.map((r) => r.kind)).toEqual(['name', 'contact', 'section', 'para', 'section', 'role', 'dates', 'bullet', 'bullet', 'bullet', 'bullet', 'role', 'dates', 'bullet', 'section', 'plain']);
  expect(v.rows.map((r) => [r.text.slice(0, 24), refsOf(r)])).toEqual([
    ['Avery Lindqvist', []], ['Duluth, MN · avery@lindq', []], ['Summary', []], ['Engineer with 14 years b', ['F-0001', 'F-0004']], ['Experience', []],
    ['Director of Engineering,', ['R-01']], ['Mar 2021 – Present', []], ['Build the dispatch conso', ['F-0001']], ['Cut the nightly billing ', ['F-0002']], ['Mentored two engineers.', []], ['Ran the test suite for t', ['F-0003']],
    ['Senior Engineer, Quillfe', ['R-02']], ['Jan 2016 – Feb 2021', []], ['Rebuilt the quoting API ', ['F-0004', 'F-0099']], ['Skills', []], ['Go', []]]);
  expect(rowOf(v.rows, 'Rebuilt').refs.map((x) => x.gone)).toEqual([false, true]);
  expect([v.linked, v.legacy, v.title, v.company]).toEqual([true, '', 'Staff Engineer', 'Nimbus Yard']);
  // A reference never breaks at its hyphen.
  expect(v.version).toContain('‑');
  expect(v.rows.flatMap((r) => r.refs).every((x) => x.code.includes('‑'))).toBe(true);
  // The facts the lines use, whole: never where a fact was read from, when it was added, or how sure it is (rule 4).
  for (const f of v.facts) expect(Object.keys(f)).toEqual(['id', 'code', 'text', 'number', 'place', 'when']);
  expect(v.facts.map((f) => [p(f.code), f.number, p(f.place), f.when])).toEqual([
    ['F-0001', '640 users across 12 depots', 'Day to day, in R-01 Director of Engineering, Harborlight Systems', 'Mar 2021 – Present'],
    ['F-0002', 'from 6 hours to 40 minutes', 'Day to day, in R-01 Director of Engineering, Harborlight Systems', 'Mar 2021 – Present'],
    ['F-0003', '212 tests', 'Day to day, in R-01 Director of Engineering, Harborlight Systems', 'Mar 2021 – Present'],
    ['F-0004', 'p95 latency 900 ms to 210 ms', 'Day to day, in R-02 Senior Engineer, Quillfeather Labs', 'Jan 2016 – Feb 2021']]);
  expect(JSON.stringify(v)).not.toMatch(/source|added|confirmed|unsure|from memory|verified/i);
});

test('each note beside its line is worded for the owner: it never quotes the line, tells a writer what to do or shows a key', () => {
  const v = resumeView(job())!;
  expect(notesOf(rowOf(v.rows, 'Cut the nightly'))).toEqual([['fail', 'Failed check', '2,400 is in none of the facts this line uses. F-0002 says “Cut the nightly billing run. (from 6 hours to 40 minutes)”.']]);
  expect(notesOf(rowOf(v.rows, 'Rebuilt the quoting'))).toEqual([['fail', 'Failed check', 'F-0099 is no longer in your record.']]);
  expect(notesOf(rowOf(v.rows, 'Mentored'))).toEqual([['flag', 'Flag', 'This bullet opens in the wrong tense for the job: the present tense is for your current job, the past tense for the others.'], ['note', '', 'You wrote this line.']]);
  expect(notesOf(rowOf(v.rows, 'Ran the test suite'))).toEqual([['flag', 'Flag', 'This bullet opens in the wrong tense for the job: the present tense is for your current job, the past tense for the others.'],
    ['note', '', 'You edited this line on 14 Nov. It used F-0003 before your edit.']]);
  expect(notesOf(rowOf(v.rows, 'Senior Engineer, Quill'))).toEqual([['flag', 'Flag', 'This resume leaves out a measured result your record holds for this job: p95 latency 900 ms to 210 ms (F-0004).'],
    ['question', 'Question', 'When did you start as Senior Engineer at Quillfeather Labs?']]);
  expect(rowOf(v.rows, 'Mar 2021').notes).toEqual([]);
  // Each note is named by its row and its place on it.
  expect(rowOf(v.rows, 'Mentored').notes.map((n) => n.id)).toEqual([`${rowOf(v.rows, 'Mentored').id}-0`, `${rowOf(v.rows, 'Mentored').id}-1`]);
  for (const r of v.rows) for (const n of r.notes) {
    expect(p(n.text)).not.toContain(`“${r.text}”`);
    expect(p(n.text)).not.toMatch(/\bcite\b|take it out|fact:\d/i);
  }
});

test('the other kinds of note, each in the owner’s words beside its line', () => {
  const md = doc('### Director of Engineering, Harborlight Systems\nMar 2021 – Present\n- Cut a run for [number] drivers.\n- Built the console (see fact:12).\n\n### Senior Engineer, Quillfeather Labs\nJan 2016 – Feb 2021\n\n### Support Lead, Tessellate Freight\nMay 2010 – Aug 2012\n- Led the support desk.\n- Answered tickets.\n\n### VP of Engineering, Harborlight Systems\n2019 – 2020\n- Built more.');
  const v = resumeView(job({ v: 1, lines: [line(H, 'Cut a run for [number] drivers.', [2]), line(H, 'Built the console (see fact:12).', [1]), line('tessellate freight', 'Led the support desk.', [6]), line('tessellate freight', 'Answered tickets.', [6])] }, md))!;
  expect(notesOf(rowOf(v.rows, 'Cut a run'))).toEqual([['fail', 'Failed check', 'A number is missing here: no fact of your record holds it.']]);
  expect(notesOf(rowOf(v.rows, 'Built the console'))).toContainEqual(['fail', 'Failed check', 'A stray mark is printed in this line. Edit the line to take it out, or write the resume again.']);
  expect(notesOf(rowOf(v.rows, 'Senior Engineer, Quill'))).toContainEqual(['flag', 'Flag', 'This job has no bullets under it. Give it one, or name it on the Earlier experience line.']);
  expect(notesOf(rowOf(v.rows, 'Support Lead')).map((n) => n[2])).toContainEqual(expect.stringMatching(/^This job ended \d+ years ago and has 2 bullets\. A job that old gets one bullet at most, or a place on the Earlier experience line\.$/));
  expect(notesOf(rowOf(v.rows, 'VP of Engineering'))).toContainEqual(['fail', 'Failed check', 'This employer appears in two entries. One employer is one entry.']);
});

// ---------- Review finding A1: a note is true together with the gutter of its row ----------
// A line that names no fact says so; a line whose facts are of another job, or gone, says only that of each fact.
const NAMES_NONE = 'This line names no fact of your record.';
function agrees(v: ReturnType<typeof resumeView>) {
  for (const r of v!.rows) {
    const shows = r.refs.some((x) => x.kind === 'fact');
    for (const n of r.notes) if (/names no fact|has no fact/.test(n.text)) expect([r.text, shows]).toEqual([r.text, false]);
    if (r.kind === 'bullet' && !shows && v!.linked && !r.notes.some((n) => n.text === 'You wrote this line.')) expect([r.text, r.notes.map((n) => n.text)]).toEqual([r.text, expect.arrayContaining([NAMES_NONE])]);
  }
  expect(v!.whole.map((n) => n.text).filter((t) => /names no fact|has no fact/.test(t))).toEqual([]);
}

test('a fact of another job, a fact gone, a key that is no fact, and a line with no link', () => {
  const v = resumeView(job({ v: 1, lines: [line(H, 'Build the dispatch console that 640 users across 12 depots open every day.', [6]), { ...line(H, 'Cut the nightly billing run from 6 hours to 40 minutes for 2,400 drivers.', []), refused: ['project:3'] },
    line(H, 'Ran the test suite for the console.', [4]), line(Q, 'Rebuilt the quoting API in Go.', [99])] }))!;
  // The gutter shows F-0006: the note says where it is, and nothing about the line having no fact.
  expect(notesOf(rowOf(v.rows, 'Build the dispatch'))).toEqual([['fail', 'Failed check', 'F-0006 is in your record under Tessellate Freight, not under this job.']]);
  expect(notesOf(rowOf(v.rows, 'Ran the test suite')).filter((n) => n[0] === 'fail')).toEqual([['fail', 'Failed check', 'F-0004 is in your record under Quillfeather Labs, not under this job.']]);
  expect(notesOf(rowOf(v.rows, 'Rebuilt the quoting'))).toEqual([['fail', 'Failed check', 'F-0099 is no longer in your record.']]);
  // A key that is no fact, and a line the writer linked to nothing: the gutter is empty, and the note says the line names none.
  expect(notesOf(rowOf(v.rows, 'Cut the nightly'))).toEqual([['flag', 'Flag', NAMES_NONE]]);
  expect(notesOf(rowOf(v.rows, 'Mentored')).filter((n) => n[0] === 'flag').map((n) => n[2])).toContain(NAMES_NONE);
  expect(JSON.stringify(v)).not.toContain('The studio has no fact on record');
  agrees(v);
});

test('every row of several views: no note says a line names no fact while its gutter shows one', () => {
  role({ id: 5, company: 'Tidewater', title: '', standing: 'personal', start: '2022-01' });
  db.run("INSERT INTO projects (id, role_id, via_role, title, created_at) VALUES (40, NULL, 5, '', 1)");
  const views = [
    job(),
    job({ v: 1, lines: [{ where: 'summary', entry: '', text: 'Engineer with 14 years building logistics software in Go.', facts: [4, 6], edited: 0 }, line(H, 'Build the dispatch console that 640 users across 12 depots open every day.', [4, 99]), line(H, 'Mentored two engineers.', [6])] }),
    job({ v: 1, lines: [] }),
    job({ v: 1, lines: [line(H, 'Cut the nightly billing run from 6 hours to 40 minutes for 2,400 drivers.', [99]), line(Q, 'Rebuilt the quoting API in Go.', [1, 2])] }),
    job({ v: 1, lines: [line(H, 'Built the console.', [1]), line('tidewater', 'Wrote a tide table app.', [6])] }, doc('### Director of Engineering, Harborlight Systems\nMar 2021 – Present\n- Built the console.\n\n### Tidewater\n2022 – Present\n- Wrote a tide table app.\n\n## Projects\n### Tidewater\n2022 – Present\n- Wrote it again.')),
  ];
  for (const id of views) agrees(resumeView(id));
});

// ---------- Review finding H1: two lines of the same words ----------
test('two lines of the same words each show their own facts, and the checks agree', () => {
  const md = doc('### Director of Engineering, Harborlight Systems\nMar 2021 – Present\n- Cut the run to 40 minutes.\n- Cut the run to 40 minutes.');
  const v = resumeView(job({ v: 1, lines: [line(H, 'Cut the run to 40 minutes.', [1]), line(H, 'Cut the run to 40 minutes.', [2])] }, md))!;
  const bullets = v.rows.filter((r) => r.kind === 'bullet');
  expect(bullets.map(refsOf)).toEqual([['F-0001'], ['F-0002']]);
  // 40 is in fact 2 only: the first line has the failed check, the second none.
  expect(bullets.map((r) => r.notes.filter((n) => n.kind === 'fail').map((n) => p(n.text)))).toEqual([['40 is in none of the facts this line uses. F-0001 says “Built the dispatch console that schedulers use every day. (640 users across 12 depots)”.'], []]);
  // The same bullet under two entries of one employer: each entry's line keeps its own fact.
  role({ id: 4, company: 'Harborlight Systems', title: 'Staff Engineer', start: '2018-01', end: '2021-02' });
  const f = fact(4, 'Built the depot map.', '30 depots');
  const md2 = doc('### Director of Engineering, Harborlight Systems\nMar 2021 – Present\n- Shipped the console.\n\n### Staff Engineer, Harborlight Systems\nJan 2018 – Feb 2021\n- Shipped the console.');
  const w = resumeView(job({ v: 1, lines: [line(H, 'Shipped the console.', [1]), line(H, 'Shipped the console.', [f])] }, md2))!;
  expect(w.rows.filter((r) => r.kind === 'bullet').map(refsOf)).toEqual([['F-0001'], [ref4(f)]]);
});

// ---------- Review finding H5: a tense flag only where the slip holds ----------
test('the same bullet under a current and a past job is flagged for tense only under the past one', () => {
  const md = doc('### Director of Engineering, Harborlight Systems\nMar 2021 – Present\n- Lead weekly code review sessions.\n\n### Senior Engineer, Quillfeather Labs\nJan 2016 – Feb 2021\n- Lead weekly code review sessions.');
  const v = resumeView(job({ v: 1, lines: [line(H, 'Lead weekly code review sessions.', [1]), line(Q, 'Lead weekly code review sessions.', [5])] }, md))!;
  const tense = (r: Row) => r.notes.filter((n) => n.text.startsWith('This bullet opens in the wrong tense')).length;
  expect(v.rows.filter((r) => r.kind === 'bullet').map(tense)).toEqual([0, 1]);
});

// ---------- Review findings H3 and M5: the reference of a heading, and a role's question on its heading only ----------
test('each heading shows the role it is about; a merged entry shows each; a side project its project; a question on its own role', () => {
  role({ id: 4, company: 'Harborlight Systems', title: 'Staff Engineer', start: '2018-01', end: '2021-02' });
  role({ id: 5, company: 'Tidewater', title: '', standing: 'personal', start: '2022-01' });
  db.run("INSERT INTO projects (id, role_id, via_role, title, created_at) VALUES (40, NULL, 5, '', 1)");
  raise('record', [{ key: 'record:start:4', text: 'When did you start as Staff Engineer?', about: 'role:4', choices: [], data: { route: '/record/role/4' } }], 1);
  const md = doc('### Director of Engineering, Harborlight Systems\nMar 2021 – Present\n- Shipped the console.\n\n### Staff Engineer, Harborlight Systems\nJan 2018 – Feb 2021\n- Built the map.\n\n## Projects\n### Tidewater\n2022 – Present\n- Wrote a tide table app.');
  const v = resumeView(job({ v: 1, lines: [] }, md))!;
  const heads = v.rows.filter((r) => r.kind === 'role');
  expect(heads.map((r) => [r.text, refsOf(r)])).toEqual([['Director of Engineering, Harborlight Systems', ['R-01']], ['Staff Engineer, Harborlight Systems', ['R-04']], ['Tidewater', ['P-040']]]);
  expect(heads.map((r) => r.notes.filter((n) => n.kind === 'question').map((n) => n.text))).toEqual([[], ['When did you start as Staff Engineer?'], []]);
  // One entry for both titles: each role's reference.
  const merged = doc('### Director of Engineering, Harborlight Systems\nMar 2021 – Present\nPreviously Staff Engineer, Jan 2018 – Feb 2021\n- Shipped the console.');
  expect(refsOf(resumeView(job({ v: 1, lines: [] }, merged))!.rows.find((r) => r.kind === 'role')!)).toEqual(['R-01', 'R-04']);
});

// ---------- Review findings H2, M1 and L2: the count, and what the record has more for ----------
test('the count is what the reading found, as on the job page; what the record has more for is said only when true', () => {
  const id = job();
  const b = balanceOf(db.query('SELECT * FROM jobs WHERE id = ?').get(id) as never);
  // The count: every requirement the record covers is answered, as the job page has always counted.
  expect([b.answered, b.asked, b.open.map((o) => o.text)]).toEqual([5, 6, ['Kafka at scale']]);
  expect(b.open[0].note).toBe('Nothing in your record answers it yet.');
  expect(b.more.map((m) => [m.text, p(m.note)])).toEqual([
    ['Support desks', 'F-0006, in R-03 Support Lead, Tessellate Freight, which this resume does not show.'],
    ['Code review culture', 'F-0005, in R-02 Senior Engineer, Quillfeather Labs. No bullet under that job uses it.']]);
  // A requirement answered by another fact is never called open.
  expect(b.open.some((o) => o.text === 'Code review culture' || o.text === 'Dispatch software')).toBe(false);
  expect(resumeView(id)!.balance.answered).toBe(5);
});

test('work the resume shows outside Experience is shown; a carried row has its project reference', () => {
  role({ id: 5, company: 'Tidewater', title: '', standing: 'personal', start: '2022-01' });
  const side = fact(5, 'Wrote a tide table app.', '2,000 installs');
  role({ id: 7, company: 'depot-sync', title: '', part_of: 2, start: '2018-01' });
  const sync = fact(7, 'Wrote the depot sync service.');
  role({ id: 8, company: 'kestrel-cli', title: '', standing: '', start: '2020-01' });
  const cli = fact(8, 'Wrote a CLI.');
  db.run("INSERT INTO projects (id, role_id, via_role, title, created_at) VALUES (40, NULL, 5, '', 1), (41, NULL, 7, '', 1), (42, NULL, 8, '', 1)");
  const reqs = [req('Mobile apps', 'strong', `fact:${side}`), req('Sync', 'strong', `fact:${sync}`), req('CLIs', 'strong', `fact:${cli}`), req('Support', 'strong', 'fact:6'), req('Support role', 'strong', 'role:3'), req('Gone', 'strong', 'fact:999')];
  // Shown: Tidewater under Projects, Quillfeather (and so its repository) under Experience, Tessellate on the Earlier line.
  const md = doc('### Director of Engineering, Harborlight Systems\nMar 2021 – Present\n- Built the console.\n\n### Senior Engineer, Quillfeather Labs\nJan 2016 – Feb 2021\n- Rebuilt the quoting API.\n\n## Earlier experience\nSupport Lead, Tessellate Freight (2010 – 2012)\n\n## Projects\n### Tidewater\n2022 – Present\n- Wrote a tide table app with 2,000 installs.');
  const b = resumeView(job(null, md, { requirements: reqs }))!.balance;
  // No links: only what the resume does not show is said. The repository nobody placed is not shown, in its own words.
  expect(b.more.map((m) => [m.text, p(m.note)])).toEqual([['CLIs', `${ref4(cli)}, in P-042 kestrel-cli, not yet placed, which this resume does not show.`]]);
  const hidden = resumeView(job(null, doc('### Director of Engineering, Harborlight Systems\nMar 2021 – Present\n- Built the console.'), { requirements: reqs }))!.balance;
  expect(hidden.more.map((m) => p(m.note))).toEqual([
    `${ref4(side)}, in P-040 Tidewater, a side project, which this resume does not show.`,
    `${ref4(sync)}, in P-041 depot-sync, under Quillfeather Labs, which this resume does not show.`,
    `${ref4(cli)}, in P-042 kestrel-cli, not yet placed, which this resume does not show.`,
    'F-0006, in R-03 Support Lead, Tessellate Freight, which this resume does not show.',
    'R-03 Support Lead, Tessellate Freight, which this resume does not show.']);
});

test('a fact counts as used only on a bullet that still stands under its own employer', () => {
  // Fact 5 (Quillfeather) cited only by the summary and by a Harborlight bullet: no bullet under its job uses it.
  const v = resumeView(job({ v: 1, lines: [{ where: 'summary', entry: '', text: 'Engineer with 14 years building logistics software in Go.', facts: [5], edited: 0 }, line(H, 'Build the dispatch console that 640 users across 12 depots open every day.', [5])] }))!;
  expect(v.balance.more.map((m) => m.text)).toContain('Code review culture');
});

// ---------- Review finding M2: where a question's action leads ----------
test('“Answer it on Home” only while Home holds the question; else the way leads where it is answered', () => {
  // Fill Home's places for the record's questions with others ranked first.
  // (One call for the kind: a question left out of it would no longer be live.)
  raise('record', [{ key: 'record:baseline:1', text: 'Built the dispatch console that schedulers use every day. What was the number before?', about: 'fact:1', choices: ['Give it', 'There was none', 'I don’t know'], data: { rank: 5 } },
    { key: 'record:start:2', text: 'When did you start as Senior Engineer at Quillfeather Labs?', about: 'role:2', choices: [], data: { route: '/record/role/2', rank: 5 } },
    ...Array.from({ length: HOME_RECORD }, (_, i) => ({ key: `record:own:${100 + i}`, text: `Question ${i}?`, about: `fact:${100 + i}`, choices: ['Write it in one line'], data: { rank: -1 } }))], 2);
  const v = resumeView(job())!;
  const q = rowOf(v.rows, 'Build the dispatch').notes.find((n) => n.kind === 'question')!;
  expect([q.route, q.action]).toEqual(['/record/fact/1', 'Open the fact in Experience']);
  const r = rowOf(v.rows, 'Senior Engineer, Quill').notes.find((n) => n.kind === 'question')!;
  expect([r.route, r.action]).toEqual(['/record/role/2', 'Answer it in Experience']);
  db.run("DELETE FROM raised_questions WHERE key LIKE 'record:own:1%'");
  const w = resumeView(job())!;
  const h = rowOf(w.rows, 'Build the dispatch').notes.find((n) => n.kind === 'question')!;
  expect([h.route, h.action]).toEqual(['/', 'Answer it on Home']);
});

// ---------- Review finding H4: the readers' weak lines ----------
test('the readers’ weak lines show only on the text they read: on their one line, else with their quote; never without one', () => {
  const problems = [{ seat: 'Hiring manager', quote: 'Rebuilt the quoting API in Go.', why: 'It says nothing of what came of it.' }, { seat: 'Editor', quote: 'Go', why: 'Go is named three times.' },
    { seat: 'Recruiter', quote: '', why: 'No quote.' }, { seat: 'Editor', quote: 'Experience', why: 'Only a section head.' }];
  const read = (sig: string) => ({ review: { score: 7, rounds: 1, passed: false, seats: [], changes: [], problems, problemsSig: sig } });
  const v = resumeView(job(LINKS, RESUME, read(sigOf(RESUME))))!;
  expect(notesOf(rowOf(v.rows, 'Rebuilt the quoting'))).toContainEqual(['flag', 'Flag', 'Hiring manager: It says nothing of what came of it.']);
  expect(v.whole.map((n) => p(n.text))).toEqual(expect.arrayContaining(['Editor, on “Go”: Go is named three times.', 'Editor, on “Experience”: Only a section head.']));
  expect(JSON.stringify(v)).not.toContain('No quote.');
  // The text changed after the readers read it (an edit, a rewrite, a fallback): none of their lines is shown.
  const w = resumeView(job(LINKS, RESUME, read(sigOf(`${RESUME}\n- Changed.`))))!;
  expect(JSON.stringify(w)).not.toMatch(/Hiring manager|Editor/);
  const none = resumeView(job(LINKS, RESUME, { review: { score: 7, rounds: 1, passed: false, seats: [], changes: [], problems } }))!;
  expect(JSON.stringify(none)).not.toMatch(/Hiring manager|Editor/);
});

// ---------- Review finding M3: the version head ----------
test('the version head: its letter and date, then the last five versions newest first, each with its letter and reason', () => {
  const id = job();
  const a = resumeView(id)!;
  expect([p(a.version), a.letter, a.date, a.changes]).toEqual([`V-${String(id).padStart(3, '0')}-A`, 'A', '', []]);
  for (let i = 0; i < 25; i++) setResume(id, `${RESUME}\n- v${i}.`, 'same', i === 23 ? 'skills' : 'edited', i === 23 ? 'The Skills line was written again from your reviewed list.' : 'You edited 1 line.');
  // 26 versions (A, then 25): kept are A and the 20 newest; the screen shows the newest 5.
  const v = resumeView(id)!;
  expect([p(v.version), v.letter, v.date !== '']).toEqual([`V-${String(id).padStart(3, '0')}-Z`, 'Z', true]);
  expect(v.changes.map((c) => [c.letter, c.text, c.date !== ''])).toEqual([['Z', 'You edited 1 line.', true], ['Y', 'The Skills line was written again from your reviewed list.', true],
    ['X', 'You edited 1 line.', true], ['W', 'You edited 1 line.', true], ['V', 'You edited 1 line.', true]]);
});

// ---------- Review findings L1 and L3: what cannot be read, and no resume yet ----------
test('links it cannot read, of a later shape, or none: the one line, no fact references, and no failure', () => {
  for (const stored of ['', '{not json', '{"v":2,"lines":[]}', '{"v":1,"lines":[null]}', '{"v":1,"lines":[{"where":"bullet","entry":"harborlight systems","text":"x","facts":"1","edited":0}]}', '{"v":1,"lines":[{"where":"bullet","entry":"harborlight systems","text":"x","edited":0}]}']) {
    const id = (db.query("INSERT INTO jobs (posting, status, analysis, resume, links, created_at) VALUES ('p', 'done', ?, ?, ?, 1) RETURNING id").get(JSON.stringify(BASE), RESUME, stored) as { id: number }).id;
    const v = resumeView(id)!;
    expect([stored, v.linked, v.legacy, v.rows.flatMap((r) => r.refs.filter((x) => x.kind === 'fact'))]).toEqual([stored, false, LEGACY_LINE, []]);
  }
  expect(LEGACY_LINE).toBe('The studio has no record of which facts each line of this resume uses. Write it again to record them.');
  // An analysis it cannot read, and a resume of odd shape, give a screen, never a failure.
  const weird = `- a bullet before any heading\n# Avery Lindqvist\n## Experience\n### Director of Engineering, Harborlight Systems\n- top\n  - nested\n| a | b |\n|---|---|\n### Lonely heading\n## Summary\n${'x'.repeat(2000)}\n`;
  for (const analysis of ['{bad', '{"requirements":null,"flags":null}', '{"review":{"problems":[{"seat":"x"}],"problemsSig":"y"}}', '{"flags":[{"kind":"x","severity":"warn","at":[{"where":"bullet"}]}]}', '{"flags":[null,{"kind":"x"}]}', '{"requirements":[{"coverage":"strong","best":"fact:1"}]}']) {
    const id = (db.query("INSERT INTO jobs (posting, status, analysis, resume, links, created_at) VALUES ('p', 'done', ?, ?, '{\"v\":1,\"lines\":[null]}', 1) RETURNING id").get(analysis, weird) as { id: number }).id;
    expect(resumeView(id)!.rows.length).toBeGreaterThan(0);
  }
});

test('a job with no resume yet: no rows, no version lines, no line about links', () => {
  const id = (db.query("INSERT INTO jobs (posting, status, analysis, resume, links, created_at, resume_status) VALUES ('p', 'running', '', '', '', 1, 'running') RETURNING id").get() as { id: number }).id;
  const v = resumeView(id)!;
  expect([v.rows, v.changes, v.legacy, v.pdf, v.facts]).toEqual([[], [], '', '', []]);
  expect(resumeView(99999)).toBeNull();
});

test('a job read again keeps the readers’ weak lines and each flag’s place (the trap in readJob)', () => {
  const problems = [{ seat: 'Hiring manager', quote: 'Rebuilt the quoting API in Go.', why: 'It says nothing of what came of it.' }];
  const id = job(LINKS, RESUME, { review: { score: 7, rounds: 1, passed: false, seats: [], changes: [], problems, problemsSig: sigOf(RESUME) } });
  const before = JSON.parse((db.query('SELECT analysis FROM jobs WHERE id = ?').get(id) as { analysis: string }).analysis) as Analysis;
  const again = readAgain({ verdict: 'Read again.', requirements: [], strengths: [], risks: [], changes: [], gaps: [] }, before);
  expect([again.review?.problems, again.review?.problemsSig]).toEqual([problems, sigOf(RESUME)]);
  expect(again.flags).toEqual(before.flags);
});

test('nothing on this screen is written on a read', () => {
  const id = job();
  const before = (db.query('SELECT total_changes() AS n').get() as { n: number }).n;
  resumeView(id);
  expect((db.query('SELECT total_changes() AS n').get() as { n: number }).n - before).toBe(0);
});

// ---------- Review finding A2: "No bullet under that job uses it." only where bullets carry links ----------
test('a fact whose work the resume shows outside Experience is not said to be unused', () => {
  role({ id: 5, company: 'Tidewater', title: '', standing: 'personal', start: '2022-01' });
  const side = fact(5, 'Wrote a tide table app.', '2,000 installs');
  db.run("INSERT INTO projects (id, role_id, via_role, title, created_at) VALUES (40, NULL, 5, '', 1)");
  const reqs = [req('Mobile apps', 'strong', `fact:${side}`), req('Billing', 'strong', 'fact:2')];
  const md = doc('### Director of Engineering, Harborlight Systems\nMar 2021 – Present\n- Built the console.\n\n## Projects\n### Tidewater\n2022 – Present\n- Wrote a tide table app with 2,000 installs.');
  const b = resumeView(job({ v: 1, lines: [line(H, 'Built the console.', [1])] }, md, { requirements: reqs }))!.balance;
  expect(b.more.map((m) => [m.text, p(m.note)])).toEqual([['Billing', 'F-0002, in R-01 Director of Engineering, Harborlight Systems. No bullet under that job uses it.']]);
  // The same side project as an entry of Experience: its bullets carry links, so an unused fact is said.
  const md2 = doc('### Director of Engineering, Harborlight Systems\nMar 2021 – Present\n- Built the console.\n\n### Tidewater\n2022 – Present\n- Wrote a tide table app.');
  const c = resumeView(job({ v: 1, lines: [line(H, 'Built the console.', [1]), line('tidewater', 'Wrote a tide table app.', [])] }, md2, { requirements: reqs }))!.balance;
  expect(c.more.map((m) => m.text)).toEqual(['Mobile apps', 'Billing']);
  expect(p(c.more[0].note)).toBe(`${ref4(side)}, in P-040 Tidewater, a side project. No bullet under that project uses it.`);
});

// ---------- Review finding A3: several results left out of one job ----------
test('a job with two results left out shows both on its heading, and nothing of them for the whole resume', () => {
  const md = doc('### Director of Engineering, Harborlight Systems\nMar 2021 – Present\n- Mentored two engineers.\n\n### Senior Engineer, Quillfeather Labs\nJan 2016 – Feb 2021\n- Rebuilt the quoting API in Go.');
  const v = resumeView(job({ v: 1, lines: [line(H, 'Mentored two engineers.', [1]), line(Q, 'Rebuilt the quoting API in Go.', [4])] }, md))!;
  const left = (start: string) => notesOf(rowOf(v.rows, start)).map((n) => n[2]).filter((t) => t.startsWith('This resume leaves out'));
  expect(left('Director of Engineering')).toEqual(expect.arrayContaining([
    'This resume leaves out a measured result your record holds for this job: 640 users across 12 depots (F-0001).',
    'This resume leaves out a measured result your record holds for this job: from 6 hours to 40 minutes (F-0002).']));
  expect(left('Senior Engineer')).toEqual(['This resume leaves out a measured result your record holds for this job: p95 latency 900 ms to 210 ms (F-0004).']);
  expect(v.whole.map((n) => n.text).filter((t) => /measured result|Left out/.test(t))).toEqual([]);
});

// ---------- Review finding B2: a heading whose title the owner changed ----------
test('a heading with a title the record lacks keeps its role by its dates, else the newest; the title note says both titles', () => {
  role({ id: 8, company: 'Harborlight Systems', title: 'Director of Engineering', start: '2015-01', end: '2016-06' });
  raise('record', [{ key: 'record:start:2', text: 'When did you start as Senior Engineer at Quillfeather Labs?', about: 'role:2', choices: [], data: { route: '/record/role/2' } },
    { key: 'record:start:1', text: 'What did you lead as Director of Engineering?', about: 'role:1', choices: [], data: { route: '/record/role/1' } }], 3);
  const head = (md: string) => resumeView(job({ v: 1, lines: [] }, doc(md)))!.rows.find((r) => r.kind === 'role')!;
  // Dates of the newest row: that row, with its question.
  const now = head('### Head of Engineering, Harborlight Systems\nMar 2021 – Present\n- Built the console.');
  expect(refsOf(now)).toEqual(['R-01']);
  expect(notesOf(now)).toContainEqual(['question', 'Question', 'What did you lead as Director of Engineering?']);
  expect(notesOf(now)).toContainEqual(['fail', 'Failed check', 'This resume gives the title “Head of Engineering” here. Your record has “Director of Engineering” at this employer.']);
  // Dates of the older row: that row.
  expect(refsOf(head('### Head of Engineering, Harborlight Systems\nJan 2015 – Jun 2016\n- Built the console.'))).toEqual(['R-08']);
  // Dates of no row: the employer's newest.
  expect(refsOf(head('### Head of Engineering, Harborlight Systems\nJan 2019 – Present\n- Built the console.'))).toEqual(['R-01']);
});

test('a "Previously" title the employer never had: the note names the resume’s title and the record’s', () => {
  role({ id: 9, company: 'Quillfeather Labs', title: 'Staff Engineer', start: '2014-01', end: '2015-12' });
  const v = resumeView(job({ v: 1, lines: [] }, doc('### Director of Engineering, Harborlight Systems\nMar 2021 – Present\nPreviously Staff Engineer, Jan 2014 – Dec 2015\n- Built the console.')))!;
  const h = v.rows.find((r) => r.kind === 'role')!;
  expect(refsOf(h)).toEqual(['R-01']);
  expect(notesOf(h)).toContainEqual(['fail', 'Failed check', 'This resume gives the title “Staff Engineer” here. Your record has “Director of Engineering” at this employer.']);
  expect(notesOf(h).map((n) => n[2])).not.toContain('Your record gives the title as “Director of Engineering”. A background check verifies titles.');
});

// ---------- A reference unbroken; the owner's words as written ----------
test('only the references the screen builds carry the non-breaking hyphen; the owner’s words keep theirs', () => {
  db.run("INSERT INTO projects (id, role_id, via_role, title, created_at) VALUES (50, 1, NULL, 'V-8 console rebuild', 1)");
  db.run("UPDATE facts SET project_id = 50, text = 'Built the F-16 dispatch console.' WHERE id = 1");
  raise('record', [{ key: 'record:baseline:1', text: 'Was the F-16 console the first? What was the number before?', about: 'fact:1', choices: ['Give it'] }], 4);
  const v = resumeView(job({ v: 1, lines: [line(H, 'Build the dispatch console that 640 users across 12 depots open every day, all 2,400 of them.', [1])] },
    RESUME.replace('open every day.', 'open every day, all 2,400 of them.')))!;
  const row = rowOf(v.rows, 'Build the dispatch');
  expect(row.notes.find((n) => n.kind === 'question')!.text).toBe('Was the F-16 console the first? What was the number before?');
  expect(row.notes.find((n) => n.kind === 'fail')!.text).toBe('2,400 is in none of the facts this line uses. F‑0001 says “Built the F-16 dispatch console. (640 users across 12 depots)”.');
  const card = v.facts.find((f) => f.id === '1')!;
  expect([card.code, card.text, card.place]).toEqual(['F‑0001', 'Built the F-16 dispatch console.', 'P‑050 V-8 console rebuild, in R‑01 Director of Engineering, Harborlight Systems']);
  expect(v.version).not.toContain('-');
});

// ---------- Where a question about a repository nobody placed leads ----------
test('a question about a repository nobody placed, written as an entry, leads to its own place in Experience', () => {
  role({ id: 8, company: 'kestrel-cli', title: '', standing: '', start: '2020-01' });
  db.run("INSERT INTO projects (id, role_id, via_role, title, created_at) VALUES (42, NULL, 8, '', 1)");
  // Home's list holds other questions first, so the way leads into Experience.
  raise('record', [{ key: 'record:place:8', text: 'Was kestrel-cli work for one of your employers, or your own project?', about: 'role:8', choices: ['Done at Harborlight Systems', 'My own side project'], data: { rank: 5 } },
    ...Array.from({ length: HOME_RECORD }, (_, i) => ({ key: `record:own:${100 + i}`, text: `Question ${i}?`, about: `fact:${100 + i}`, choices: ['Write it in one line'], data: { rank: -1 } }))], 6);
  const v = resumeView(job({ v: 1, lines: [] }, doc('### Director of Engineering, Harborlight Systems\nMar 2021 – Present\n- Built the console.\n\n## Projects\n### kestrel-cli\n2020 – Present\n- Wrote a CLI.')))!;
  const q = rowOf(v.rows, 'kestrel-cli').notes.find((n) => n.kind === 'question')!;
  expect([q.route, q.action]).toEqual(['/record/project/42', 'Open the project in Experience']);
});

// ---------- The noise rule never makes the links' check louder ----------
test('a line that reads a count its fact states as “212 tests” is not called unsupported', () => {
  const md = doc('### Director of Engineering, Harborlight Systems\nMar 2021 – Present\n- Ran the console tests, all 212 of them.');
  const v = resumeView(job({ v: 1, lines: [line(H, 'Ran the console tests, all 212 of them.', [3])] }, md))!;
  expect(JSON.stringify(v)).not.toContain('212 is in none');
});
