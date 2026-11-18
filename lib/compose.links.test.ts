// `bun test lib`: rule 7's links in the writing loop, with a stand-in for every model call (fakeAsk) and the scratch
// database of an invented person. The writer, the council's reviser and the skim's fix end each line with the keys of
// the facts it draws on; code takes them out at once (tidy), keeps them in `jobs.links`, and checks them. No key reaches
// the stored text, its file, the printed page, a reader, or the words beside the resume. Everything is invented.
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { db, seed } from './scratch.ts';
import { codeFlags, flagContext, type Flag } from './checks.ts';
import { compose, publish, reflag, review, storeComposed, type Analysis, type JobRow, type Requirement } from './jobs.ts';
import { fakeAsk, type Ask } from './llm.ts';
import { parseLinks, stripLinks, type Links } from './links.ts';
import { inData } from './paths.ts';
import { chrome, renderPdf, resumeHtml } from './pdf.ts';
import { versionsOf } from './versions.ts';
import { LINKS } from './writing.ts';
import { extractText, getDocumentProxy } from 'unpdf';

const POSTING = 'Staff Engineer at Nimbus Yard. You will build Go services on Kafka. Our first platform engineer.';
const TERMS = ['Go', 'Kafka'];
const REQS: Requirement[] = [{ text: 'Go services in production', need: 'must', coverage: 'strong', evidence: 'Rebuilt the quoting API in Go.', roles: ['role:2'], best: 'fact:4', bestText: 'Rebuilt the quoting API.', weight: 0.9 }];
// The seed's facts: 1 the dispatch console (640 users across 12 depots), 2 the billing run (6 hours to 40 minutes), 3 the
// test suite, all at Harborlight; 4 the quoting API (p95 900 ms to 210 ms) and 5 code review at Quillfeather; 6 the
// support desk at Tessellate.
const KEYED = `# Avery Lindqvist
line

## Summary
Engineer with 14 years building logistics software in Go. {fact:1, fact:4}

## Experience
### Director of Engineering, Harborlight Systems
Mar 2021 – Present
- Build the dispatch console that 640 users across 12 depots open every day. {fact:1}
- Cut the nightly billing run from 6 hours to 40 minutes. {fact:2}

### Senior Engineer, Quillfeather Labs
Jan 2016 – Feb 2021
- Rebuilt the quoting API in Go, cutting p95 latency from 900 ms to 210 ms. {fact:4}

## Skills
Go`;
const BAD_LINE = '- Cut the nightly billing run from 6 hours to 40 minutes. {fact:2}';
const OFF_NUMBER = '- Cut the nightly billing run from 6 hours to 40 minutes for 2,400 drivers. {fact:2}';
const KEY = /(?:fact|project|role)\s*:\s*\d/i;

let calls: Ask[] = [];
const kind = (c: Ask) => (c.prompt.startsWith('You are measuring one job posting') ? 'write' : c.prompt.startsWith('You are a recruiter with six seconds') ? 'glance' : c.prompt.startsWith('You are fixing the top') ? 'fix' : c.prompt.startsWith('You are revising') ? 'revise' : 'read');
const glance = (yes: boolean) => ({ conclusion: 'A lead.', misleading: '', questions: [], top: [{ requirement: '', answered: yes, note: yes ? '' : 'Not at the top.' }] });
function model(written = KEYED, o: { fix?: (prompt: string) => string; revise?: string; answered?: boolean; changes?: string[]; score?: number } = {}) {
  calls = [];
  fakeAsk((c) => {
    calls.push(c);
    const k = kind(c);
    if (k === 'write') return { resume: written, changes: o.changes ?? ['Led with the console.'], questions: ['Who used fact:4 day to day?'] };
    if (k === 'glance') return glance(o.answered ?? true);
    if (k === 'fix') return { resume: o.fix ? o.fix(c.prompt) : written, changes: ['Reworded {fact:2}.'] };
    if (k === 'revise') return { resume: o.revise ?? written, changes: ['Cut the count of tests from fact:3.'], questions: [] };
    return { score: o.score ?? 9, note: 'Clear.', problems: [] };
  });
}
const job = (resume = '', links = '', edited = 0) => (db.query("INSERT INTO jobs (posting, title, company, status, fit, analysis, resume, links, resume_status, created_at, edited, outcome) VALUES (?, 'Staff Engineer', 'Nimbus Yard', 'done', 60, ?, ?, ?, 'running', 1, ?, '') RETURNING id")
  .get(POSTING, JSON.stringify({ verdict: 'A fair fit.', requirements: REQS, strengths: [], risks: [], changes: [], gaps: [] }), resume, links, edited) as { id: number }).id;
const row = (id: number) => db.query('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow & { links: string };
const flagsOf = (id: number) => (JSON.parse(row(id).analysis) as Analysis).flags ?? [];
const whatToFix = (prompt: string) => prompt.split('What to fix:\n')[1].split('\n\n')[0];
const resumeIn = (prompt: string) => prompt.split('<resume>\n')[1].split('\n</resume>')[0];

beforeEach(() => { seed(); process.env.EGG_COUNCIL = 'off'; delete process.env.EGG_SKIM; delete process.env.EGG_LINKS; });
afterEach(() => { fakeAsk(); delete process.env.EGG_COUNCIL; delete process.env.EGG_SKIM; delete process.env.EGG_LINKS; });

test('the writer is told to cite; no key reaches the resume, its file, its versions, the printed page or the words beside it', async () => {
  model();
  const c = await compose(POSTING, 2, TERMS, REQS);
  expect(calls.map(kind)).toEqual(['write', 'glance']);
  expect(calls[0].prompt).toContain(LINKS);
  expect(c.resume).not.toMatch(KEY);
  expect(c.resume).toBe(stripLinks(c.resume));
  expect(c.links!.lines.map((l) => [l.where, l.entry, l.facts])).toEqual([['summary', '', [1, 4]], ['bullet', 'harborlight systems', [1]], ['bullet', 'harborlight systems', [2]], ['bullet', 'quillfeather labs', [4]]]);
  // What the models said beside it names facts by their reference, never by a key.
  expect([c.changes, c.questions]).toEqual([['Led with the console.'], ['Who used F-0004 day to day?']]);
  const id = job();
  expect(storeComposed(id, c, 'sig', 1)).toBe(true);
  const r = row(id);
  expect(r.resume).toBe(c.resume);
  expect(parseLinks(r.links)).toEqual(c.links);
  const file = readdirSync(inData('resumes')).find((f) => f.startsWith(`${id}-`))!;
  expect(readFileSync(`${inData('resumes')}/${file}`, 'utf8')).not.toMatch(KEY);
  expect(versionsOf(id).map((v) => KEY.test(v.resume))).toEqual([false]);
  expect(resumeHtml(r.resume)).not.toMatch(KEY);
  await publish(id, false);
  expect(flagsOf(id).filter((f) => f.kind.startsWith('link') || f.kind === 'unlinked')).toEqual([]);
});

test.skipIf(!chrome())('the printed PDF of a linked resume holds no key', async () => {
  model();
  const c = await compose(POSTING, 2, TERMS, REQS);
  const { text } = await extractText(await getDocumentProxy(await renderPdf(c.resume, 2)), { mergePages: true });
  expect(String(text)).toContain('640 users across 12 depots');
  expect(String(text)).not.toMatch(KEY);
}, 120_000);

test('the council’s readers never see a key; the reviser and the fix see each line’s keys, and are told the rule', async () => {
  process.env.EGG_COUNCIL = 'on';
  // The reviser forgets the keys of a line it leaves as it was: the line keeps its link.
  model(KEYED, { answered: false, revise: KEYED.replace(' {fact:2}', '') });
  const c = await compose(POSTING, 2, TERMS, REQS);
  const reads = calls.filter((x) => kind(x) === 'read'), revises = calls.filter((x) => kind(x) === 'revise'), fixes = calls.filter((x) => kind(x) === 'fix');
  expect([reads.length > 0, revises.length > 0, fixes.length]).toEqual([true, true, 2]);
  for (const x of reads) { expect(resumeIn(x.prompt)).not.toMatch(KEY); expect(x.prompt).not.toContain(LINKS); }
  for (const x of calls.filter((y) => kind(y) === 'glance')) expect(x.prompt).not.toMatch(/\{fact/);
  for (const x of [...revises, ...fixes]) { expect(resumeIn(x.prompt)).toContain('open every day. {fact:1}'); expect(x.prompt).toContain(LINKS); }
  // The rule-based check of the bullets, given to the reviser, quotes the lines without their keys.
  expect(revises[0].prompt.split('A rule-based check')[1] ?? '').not.toMatch(KEY);
  expect(resumeIn(fixes[0].prompt)).toContain('40 minutes. {fact:2}');
  expect(c.links!.lines.find((l) => l.text.startsWith('Cut the nightly'))!.facts).toEqual([2]);
  expect(c.resume).not.toMatch(KEY);
});

test('a number in none of the cited facts is sent back to the fix, then flagged on the line when it stays', async () => {
  model(KEYED.replace(BAD_LINE, OFF_NUMBER), { fix: (p) => stripLinks(resumeIn(p)) });
  const c = await compose(POSTING, 2, TERMS, REQS);
  expect(calls.map(kind)).toEqual(['write', 'glance', 'fix', 'glance', 'fix', 'glance']);
  const said = '“Cut the nightly billing run from 6 hours to 40 minutes for 2,400 drivers.” uses 2,400, which is in none of the facts it cites. F-0002 says “Cut the nightly billing run. (from 6 hours to 40 minutes)”. Take it out, or cite the fact that states it.';
  expect(whatToFix(calls[2].prompt)).toBe(`- ${said}`);
  // The fix returned the text with no keys and the line unchanged: it keeps its link, and the finding stays.
  expect(c.links!.lines.map((l) => l.facts)).toEqual([[1, 4], [1], [2], [4]]);
  const id = job();
  storeComposed(id, c, 'sig', 1);
  await publish(id, false);
  const f = flagsOf(id).find((x) => x.kind === 'link-number')!;
  expect(f).toEqual({ kind: 'link-number', severity: 'high', text: said, at: [{ where: 'bullet', entry: 'harborlight systems', text: 'Cut the nightly billing run from 6 hours to 40 minutes for 2,400 drivers.' }] });
});

test('a fix that takes the number out and keeps the key ends the loop', async () => {
  model(KEYED.replace(BAD_LINE, OFF_NUMBER), { fix: () => KEYED });
  const c = await compose(POSTING, 2, TERMS, REQS);
  expect(calls.map(kind)).toEqual(['write', 'glance', 'fix', 'glance']);
  expect(c.resume).toContain('- Cut the nightly billing run from 6 hours to 40 minutes.\n');
});

test('a key to no fact, a fact of another job, a project and a line with no key are each sent back in words, never repaired', async () => {
  const written = KEYED.replace(' {fact:1}\n', ' {fact:6, fact:99}\n').replace(BAD_LINE, '- Cut the nightly billing run from 6 hours to 40 minutes. {project:3}').replace(' {fact:4}\n', '\n');
  model(written, { fix: () => written });
  const c = await compose(POSTING, 2, TERMS, REQS);
  expect(whatToFix(calls[2].prompt).split('\n')).toEqual([
    '- “Build the dispatch console that 640 users across 12 depots open every day.” cites F-0099, which is no longer in your record. A link is never moved to another fact: cite one your record has.',
    '- “Build the dispatch console that 640 users across 12 depots open every day.” cites F-0006, which your record has under Tessellate Freight, not under Harborlight Systems. A line cites only facts of its own job.',
    '- “Build the dispatch console that 640 users across 12 depots open every day.” has no fact left that stands behind it.',
    '- “Cut the nightly billing run from 6 hours to 40 minutes.” cites project:3, which is not a fact. Only a fact of your record stands behind a line.',
    '- “Cut the nightly billing run from 6 hours to 40 minutes.” has no fact left that stands behind it.',
    '- “Rebuilt the quoting API in Go, cutting p95 latency from 900 ms to 210 ms.” names no fact of your record that it draws on.',
  ]);
  // Stored as the writer gave them: the check says what is wrong at every reflag; code never moves a key.
  expect(c.links!.lines.map((l) => [l.facts, l.refused ?? []])).toEqual([[[1, 4], []], [[6, 99], []], [[], ['project:3']]]);
});

test('with EGG_LINKS=off the writer is not told, nothing is taken out, annotated or checked, and no links are kept', async () => {
  process.env.EGG_LINKS = 'off';
  model(KEYED.replace(BAD_LINE, OFF_NUMBER).replace('Go, cutting p95', 'Go (project: 3), cutting p95'));
  const c = await compose(POSTING, 2, TERMS, REQS);
  expect(calls.map(kind)).toEqual(['write', 'glance']);
  expect(calls[0].prompt).not.toContain('Where each line comes from');
  expect(c.links).toBeNull();
  // The writer is not told about keys with links off; what a model writes is left as the last commit before links left it.
  expect(c.resume).toContain('Rebuilt the quoting API in Go (project: 3), cutting p95');
  expect(c.resume).toContain('640 users across 12 depots open every day. {fact:1}');
  const id = job();
  storeComposed(id, c, 'sig', 1);
  expect(row(id).links).toBe('');
  await publish(id, false);
  expect(flagsOf(id).map((f) => f.kind).filter((k) => k.startsWith('link') || k === 'unlinked')).toEqual([]);
});

test('a cited fact edited or deleted later is said at the next reflag, and never moved to another fact', async () => {
  model();
  const c = await compose(POSTING, 2, TERMS, REQS), id = job();
  storeComposed(id, c, 'sig', 1);
  db.run("UPDATE facts SET metric = 'from 6 hours to 50 minutes' WHERE id = 2");
  db.run('DELETE FROM facts WHERE id = 4');
  reflag(id);
  expect(flagsOf(id).filter((f) => f.kind.startsWith('link')).map((f) => [f.kind, f.text])).toEqual([
    ['link-unknown', 'The summary cites F-0004, which is no longer in your record. A link is never moved to another fact: cite one your record has.'],
    ['link-number', '“Cut the nightly billing run from 6 hours to 40 minutes.” uses 40, which is in none of the facts it cites. F-0002 says “Cut the nightly billing run. (from 6 hours to 50 minutes)”. Take it out, or cite the fact that states it.'],
    ['link-unknown', '“Rebuilt the quoting API in Go, cutting p95 latency from 900 ms to 210 ms.” cites F-0004, which is no longer in your record. A link is never moved to another fact: cite one your record has.'],
  ]);
  expect(parseLinks(row(id).links)!.lines.map((l) => l.facts)).toEqual([[1, 4], [1], [2], [4]]);
});

test('on a linked line the number check reads the cited facts, not the whole employer; an unlinked resume is checked as before', () => {
  db.run("INSERT INTO projects (role_id, title, situation, created_at) VALUES (1, 'Console', 'It served 640 users.', 1)");
  const md = '# Avery Lindqvist\nline\n\n## Summary\nEngineer.\n\n## Experience\n### Director of Engineering, Harborlight Systems\nMar 2021 – Present\n- Cut the nightly billing run for 640 users.';
  const links: Links = { v: 1, lines: [{ where: 'summary', entry: '', text: 'Engineer.', facts: [1], edited: 0 }, { where: 'bullet', entry: 'harborlight systems', text: 'Cut the nightly billing run for 640 users.', facts: [2], edited: 0 }] };
  const kinds = (fs: Flag[]) => fs.filter((f) => ['context-number', 'link-number'].includes(f.kind)).map((f) => f.kind);
  // 640 stands in a project's background and in fact 1 of the same employer: the old check holds it; the line cites fact 2.
  expect(kinds(codeFlags(md, 2, Date.now(), flagContext(), null))).toEqual([]);
  expect(kinds(codeFlags(md, 2, Date.now(), flagContext(), links))).toEqual(['link-number']);
  // A number only in the background, on an unlinked line: today's context check, unchanged.
  const other = md.replace('640 users', '640 users').replace('Cut the nightly billing run for 640 users.', 'Served 640 users.');
  db.run('UPDATE facts SET metric = \'\' WHERE id = 1');
  expect(kinds(codeFlags(other, 2, Date.now(), flagContext(), null))).toEqual(['context-number']);
  expect(kinds(codeFlags(other, 2, Date.now(), flagContext(), { v: 1, lines: [] }))).toEqual(['context-number']);
});

test('a key a model left in its text is a high flag on its line; never on the owner’s edit, an old resume, or with links off', () => {
  const md = '# Avery Lindqvist\nline\n\n## Summary\nEngineer.\n\n## Experience\n### Director of Engineering, Harborlight Systems\nMar 2021 – Present\n- Built the console (see fact:12).\n- Ran {F-0003} reviews.';
  const linked: Links = { v: 1, lines: [] }, marks = (fs: Flag[]) => fs.filter((f) => f.kind === 'link-mark');
  expect(marks(codeFlags(md, 2, Date.now(), flagContext(), linked))).toEqual([{ kind: 'link-mark', severity: 'high',
    text: 'This resume prints “fact:12”, a key that names a fact of your record. It is never meant to be printed. Take it out.',
    at: [{ where: 'bullet', entry: 'harborlight systems', text: 'Built the console (see fact:12).' }, { where: 'bullet', entry: 'harborlight systems', text: 'Ran {F-0003} reviews.' }] }]);
  // The owner may type what they like; a resume written before links has none of this; nor has one with links off.
  expect(marks(codeFlags(md, 2, Date.now(), flagContext(), linked, true))).toEqual([]);
  expect(marks(codeFlags(md, 2, Date.now(), flagContext(), null))).toEqual([]);
  process.env.EGG_LINKS = 'off';
  expect(marks(codeFlags(md, 2, Date.now(), flagContext(), linked))).toEqual([]);
});

test('a review of a resume written before links asks the reviser to cite; of a linked one, shows it the keys', async () => {
  process.env.EGG_SKIM = 'off';
  const legacy = stripLinks(KEYED);
  // The readers score 5, so the council rewrites.
  model(KEYED, { revise: KEYED, score: 5 });
  const old = job(legacy);
  await review(row(old), false);
  const revises = calls.filter((x) => kind(x) === 'revise');
  expect(revises.length).toBeGreaterThan(0);
  expect(resumeIn(revises[0].prompt)).not.toMatch(KEY);
  expect(revises[0].prompt).toContain(LINKS);
  expect(parseLinks(row(old).links)!.lines.length).toBe(4);
  // Now linked: the next review shows the reviser the stored keys.
  model(KEYED, { revise: KEYED, score: 5 });
  await review(row(old), false);
  expect(resumeIn(calls.find((x) => kind(x) === 'revise')!.prompt)).toContain('open every day. {fact:1}');
});

// ---------- Keys in near shapes (review finding 1 and 5) ----------
// Every shape a model may write is taken out by tidy() alone, with no fix round (EGG_SKIM=off): the stored text, its file,
// the printed page and its PDF hold no key. Where the ids can be read without a guess they are the line's links.
const LINE = '- Build the dispatch console that 640 users across 12 depots open every day.';
const SHAPES: [string, number[] | null][] = [
  ['{fact:1}', [1]], ['[fact:1]', [1]], ['(fact:1)', [1]], ['<fact:1>', [1]], ['{"fact:1"}', [1]], ['\\{fact:1\\}', [1]], ['{fact: 1}', [1]], ['{Fact:1}', [1]],
  ['{FACT : 1}', [1]], ['{fact:1;fact:3}', [1, 3]], ['{fact:1 and fact:3}', [1, 3]], ['{fact:1, fact:3,}', [1, 3]], ['{fact:1}{fact:3}', [1, 3]], ['[fact:1, fact:3]', [1, 3]],
  ['{facts: 1, 3}', [1, 3]], ['{F-0001}', [1]], ['{fact 1}', [1]], ['{fact:#1}', [1]], ['{fact_1}', [1]], ['{fact：1}', [1]], ['{fact:1', [1]],
  ['{fact:1, 3}', null],
];
const KEYISH = /fact|F-000|\{|\}|<|>/i;
test('every near shape of a key is taken out by tidy() alone, and read as the line’s link where it can be read', async () => {
  process.env.EGG_SKIM = 'off';
  for (const [shape, facts] of SHAPES) {
    model(KEYED.replace('open every day. {fact:1}', `open every day. ${shape}`));
    const c = await compose(POSTING, 2, TERMS, REQS);
    const bullet = c.resume.split('\n').find((l) => l.startsWith('- Build'))!;
    expect([shape, bullet]).toEqual([shape, `${LINE}`]);
    expect([shape, KEYISH.test(c.resume.split('## Summary')[1])]).toEqual([shape, false]);
    expect([shape, KEYISH.test(resumeHtml(c.resume).split('Build the dispatch')[1].split('</li>')[0])]).toEqual([shape, false]);
    const l = c.links!.lines.find((x) => x.text.startsWith('Build'));
    expect([shape, l?.facts ?? null]).toEqual([shape, facts]);
    const id = job();
    storeComposed(id, c, 'sig', 1);
    const file = readdirSync(inData('resumes')).find((f) => f.startsWith(`${id}-`))!;
    expect([shape, KEYISH.test(readFileSync(`${inData('resumes')}/${file}`, 'utf8').split('## Summary')[1])]).toEqual([shape, false]);
    // An unreadable group gives the line nothing: it is then a line with no fact, never a guess.
    if (facts === null) { await publish(id, false); expect(flagsOf(id).filter((f) => f.kind === 'unlinked').map((f) => f.text)).toEqual([`“${LINE.slice(2)}” names no fact of your record that it draws on.`]); }
  }
});

test.skipIf(!chrome())('no near shape of a key reaches the printed PDF', async () => {
  process.env.EGG_SKIM = 'off';
  const all = KEYED.replace('open every day. {fact:1}', `open every day. ${SHAPES.map(([s]) => s).slice(0, 12).join(' ')}`).replace('40 minutes. {fact:2}', `40 minutes. ${SHAPES.map(([s]) => s).slice(12).join(' ')}`);
  model(all);
  const c = await compose(POSTING, 2, TERMS, REQS);
  const { text } = await extractText(await getDocumentProxy(await renderPdf(c.resume, 2)), { mergePages: true });
  expect(String(text)).toContain('640 users across 12 depots open every day.');
  expect(String(text)).not.toMatch(/fact|F-000|[{}<>]/i);
}, 120_000);

test('text that is not a key stays as the model wrote it', async () => {
  process.env.EGG_SKIM = 'off';
  const kept = ['Planned the {TBD} rollout.', 'Named each {id} route.', 'Supported the (F-16 program) avionics team.', 'Wrote fact-based reviews.', 'Shipped {42} builds.', 'Cut cost (role: 2 people).'];
  model(KEYED.replace('- Cut the nightly billing run from 6 hours to 40 minutes. {fact:2}', kept.map((k) => `- ${k} {fact:2}`).join('\n')));
  const c = await compose(POSTING, 2, TERMS, REQS);
  for (const k of kept) expect(c.resume).toContain(`- ${k}\n`);
});

test('the marks that only wrapped a key go with it, and no doubled full stop or space before one is left', async () => {
  process.env.EGG_SKIM = 'off';
  const cases: [string, string][] = [['open every day. ({fact:1})', 'open every day.'], ['open every day. **{fact:1}**', 'open every day.'], ['open every day. `{fact:1}`', 'open every day.'],
    ['open every day {fact:1}.', 'open every day.'], ['open every day. {fact:1}.', 'open every day.'], ['open every day {fact:1} .', 'open every day.'], ['open {fact:1} every day.', 'open every day.']];
  for (const [written, stored] of cases) {
    model(KEYED.replace('open every day. {fact:1}', written));
    const c = await compose(POSTING, 2, TERMS, REQS);
    expect([written, c.resume.split('\n').find((l) => l.startsWith('- Build'))]).toEqual([written, `- Build the dispatch console that 640 users across 12 depots ${stored}`]);
    expect([written, c.links!.lines.find((x) => x.text.startsWith('Build'))!.facts]).toEqual([written, [1]]);
  }
});

// ---------- A reference in round or angle brackets, or after a lead-in word (review, the last round) ----------
test('a reference written as (F-0001), <F-0001> or {ref F-0001} is flagged, sent back, and gone once the writer corrects it', async () => {
  process.env.EGG_SKIM = 'on';
  for (const shape of ['(F-0001)', '<F-0001>', '{ref F-0001}']) {
    model(KEYED.replace('open every day. {fact:1}', `open every day. ${shape}`), { fix: () => KEYED });
    const c = await compose(POSTING, 2, TERMS, REQS);
    expect([shape, calls.map(kind)]).toEqual([shape, ['write', 'glance', 'fix', 'glance']]);
    expect([shape, whatToFix(calls[2].prompt)]).toEqual([shape, `- “Build the dispatch console that 640 users across 12 depots open every day. ${shape}” names no fact of your record that it draws on.\n- This resume prints “${shape}”, a key that names a fact of your record. It is never meant to be printed. Take it out.`]);
    expect([shape, c.resume.includes('F-0001')]).toEqual([shape, false]);
  }
});

test('a form or aircraft name in round brackets in a model line is not flagged as a key', async () => {
  process.env.EGG_SKIM = 'off';
  const line = '- Cut the nightly billing run from 6 hours to 40 minutes for the (F-16 program), the (F-150 trucks) and the (Form F-1065) filings. {fact:2}';
  model(KEYED.replace('- Cut the nightly billing run from 6 hours to 40 minutes. {fact:2}', line));
  const c = await compose(POSTING, 2, TERMS, REQS);
  expect(c.resume).toContain('for the (F-16 program), the (F-150 trucks) and the (Form F-1065) filings.\n');
  expect(codeFlags(c.resume, 2, Date.now(), flagContext(), c.links).filter((f) => f.kind === 'link-mark')).toEqual([]);
});
