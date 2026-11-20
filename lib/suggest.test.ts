// `bun test lib`: rule 7, stage 3a. On a resume the owner edited, the studio never changes the text by itself: what it
// would write there (the Skills line from the reviewed list, a heading's title or employer, a dates line from the
// record) becomes a suggestion the owner keeps or rejects. No model is asked. Each source, each guard, Keep, Reject and
// Undo, stale suggestions, and that a read writes nothing. Everything is invented.
import { beforeEach, expect, test } from 'bun:test';
import { db, seed } from './scratch.ts';
import { checkEntries } from './entries.ts';
import { refreshDueSkills, refreshSkills, saveOwnerEdit, skillsChanged, SKILLS_QUIET_MS, type JobRow } from './jobs.ts';
import { storeLinks, type Links } from './links.ts';
import { markSkills, syncSkills, withSkillLines } from './skills.ts';
import { publish, saveResume, storePrinted } from './jobs.ts';
import { pdfPath } from './pdf.ts';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inData } from './paths.ts';
import { patchRole } from './record.ts';
import { setResume } from './versions.ts';
import { resumeView } from './resumeview.ts';
import { candidates, decide, guard, seeRoles, shownSuggestions, suggestAfterRoles, suggestAfterSave, suggestSkills, wordDiff } from './suggest.ts';

const POSTING = 'A posting about Go and Kafka.';
const RESUME = `# Avery Lindqvist
Duluth, MN

## Experience
### Director of Engineering, Harborlight Systems
Mar 2021 – Present · Remote
- Build the dispatch console.

### Senior Engineer, Quillfeather Labs
Jan 2016 – Feb 2021 · Duluth, MN
- Rebuilt the quoting API.

## Skills
Go, Python, Kafka`;
const LINKS: Links = { v: 1, lines: [
  { where: 'bullet', entry: 'harborlight systems', text: 'Build the dispatch console.', facts: [1], edited: 0 },
  { where: 'bullet', entry: 'quillfeather labs', text: 'Rebuilt the quoting API.', facts: [4], edited: 0 }] };

function job(resume = RESUME, o: { edited?: number; outcome?: string; links?: Links | null } = {}): number {
  return (db.query("INSERT INTO jobs (posting, title, company, status, analysis, resume, links, created_at, edited, outcome, pdf) VALUES (?, 'Staff Engineer', 'Nimbus Yard', 'done', ?, ?, ?, 1, ?, ?, '/invented/old.pdf') RETURNING id")
    .get(POSTING, JSON.stringify({ verdict: '', requirements: [], strengths: [], risks: [], changes: [], gaps: [] }), resume, storeLinks(o.links === undefined ? LINKS : o.links), o.edited ?? 1, o.outcome ?? '') as { id: number }).id;
}
const row = (id: number) => db.query('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow & { edited: number; links: string; pdf: string };
type Sug = { id: number; where_: string; old: string; new: string; kind: string; why: string; status: string; source: string };
const sugs = (id: number) => db.query('SELECT * FROM resume_suggestions WHERE job_id = ? ORDER BY id').all(id) as Sug[];
const versions = (id: number) => db.query('SELECT n, why, reason FROM resume_versions WHERE job_id = ? ORDER BY n').all(id) as { n: number; why: string; reason: string }[];
const changes = () => (db.query('SELECT total_changes() AS n').get() as { n: number }).n;
const swap = (text: string, from: string, to: string) => text.split('\n').map((l) => (l === from ? to : l)).join('\n');

beforeEach(() => {
  seed();
  db.run('DELETE FROM resume_suggestions');
  syncSkills(1);
  // The list reviewed: Go, Kafka and TypeScript are the tools the owner would defend.
  markSkills([{ name: 'Go', mark: 'confident' }, { name: 'Kafka', mark: 'confident' }, { name: 'TypeScript', mark: 'confident' }], true, 2);
  seeRoles();
});

test('the resume these tests start from agrees with the record: no heading or dates finding', () => {
  expect(checkEntries(RESUME, db.query('SELECT * FROM roles').all() as never)).toEqual([]);
});

// ---------- Where suggestions come from ----------

// ---------- The Skills line: only what the owner marked not confident goes ----------
const notConfident = (...names: string[]) => markSkills(names.map((name) => ({ name, mark: 'not-confident' })), false, 3);

test('the Skills line: only the skills the owner marked not confident are taken out; nothing is added, moved or reworded', () => {
  const id = job(RESUME.replace('Go, Python, Kafka', 'Go, Python, Kafka, TypeScript'));
  // Nothing marked not confident: no suggestion, though the list would write the line otherwise.
  expect(suggestSkills(9)).toEqual([]);
  notConfident('Kafka');
  expect(suggestSkills(10)).toEqual([id]);
  // Python is not on the list: it stays (the skills flag speaks about it). The owner's order and separators stay.
  expect(sugs(id).map((s) => [s.where_, s.kind, s.old, s.new, s.why, s.status, s.source])).toEqual([['skills', 'skills', 'Go, Python, Kafka, TypeScript', 'Go, Python, TypeScript', 'You marked Kafka as not confident.', 'open', 'rule']]);
  // Nothing in the text changed, and no version was made.
  expect([row(id).edited, versions(id)]).toEqual([1, []]);
});

test('two skills marked not confident are named in the line’s order; the owner’s separators and label stay', () => {
  const id = job(RESUME.replace('Go, Python, Kafka', '- Languages: TypeScript; Go · Kafka.'));
  notConfident('Kafka', 'TypeScript');
  suggestSkills(10);
  expect(sugs(id).map((s) => [s.old, s.new, s.why])).toEqual([['- Languages: TypeScript; Go · Kafka.', '- Languages: Go.', 'You marked TypeScript and Kafka as not confident.']]);
});

test('no Skills suggestion before the first review, or when it would empty the line; a skill inside another skill’s name stays', () => {
  db.run("INSERT INTO skills (key, name, kind, added_at, facts, in_bank) VALUES ('java', 'Java', 'language', 1, 1, 1), ('javascript', 'JavaScript', 'language', 1, 1, 1)");
  const only = job(RESUME.replace('Go, Python, Kafka', 'Kafka'));
  const inside = job(RESUME.replace('Go, Python, Kafka', 'Go, JavaScript, Java'));
  notConfident('Kafka', 'Java');
  expect(suggestSkills(10)).toEqual([inside]);
  expect(sugs(only)).toEqual([]);
  expect(sugs(inside).map((s) => [s.old, s.new, s.why])).toEqual([['Go, JavaScript, Java', 'Go, JavaScript', 'You marked Java as not confident.']]);
  db.run('UPDATE skills_review SET reviewed_at = 0 WHERE id = 1');
  const before = job(RESUME);
  expect(suggestSkills(11)).toEqual([]);
  expect(sugs(before)).toEqual([]);
});

test('the Skills heading is never touched, whatever its wording or case', () => {
  const tech = job(RESUME.replace('## Skills', '## Technical Skills'));
  const caps = job(RESUME.replace('## Skills', '## SKILLS'));
  notConfident('Kafka');
  suggestSkills(10);
  for (const id of [tech, caps]) expect(sugs(id).map((s) => [s.old, s.new])).toEqual([['Go, Python, Kafka', 'Go, Python']]);
  // The reviewer's case: a heading the list would rename and a line already right make no suggestion.
  const right = job(RESUME.replace('## Skills\nGo, Python, Kafka', '## Technical Skills\nGo, TypeScript'));
  suggestSkills(11);
  expect(sugs(right)).toEqual([]);
});

test('a rejected Skills suggestion comes back only when another skill on the line is marked not confident', () => {
  const id = job(RESUME.replace('Go, Python, Kafka', 'Go, Python, Kafka, TypeScript'));
  notConfident('Kafka');
  suggestSkills(10);
  decide(sugs(id)[0].id, 'reject', 11);
  // The list changes in other ways (a mark of confidence, the review again): nothing new.
  markSkills([{ name: 'PostgreSQL', mark: 'confident' }], true, 12);
  expect(suggestSkills(13)).toEqual([]);
  notConfident('TypeScript');
  expect(suggestSkills(14)).toEqual([id]);
  expect(sugs(id).map((s) => [s.status, s.new, s.why])).toEqual([['rejected', 'Go, Python, TypeScript', 'You marked Kafka as not confident.'], ['open', 'Go, Python', 'You marked Kafka and TypeScript as not confident.']]);
});

test('a heading’s title, a heading’s employer, and a dates line that differ from the record, after the owner’s Save', () => {
  const id = job();
  const head = swap(RESUME, '### Director of Engineering, Harborlight Systems', '### Head of Engineering, Harborlight Systems');
  expect(saveOwnerEdit(id, head)).toBe('saved');
  expect(sugs(id).map((s) => [s.where_, s.kind, s.old, s.new, s.why])).toEqual([['heading', 'title', '### Head of Engineering, Harborlight Systems', '### Director of Engineering, Harborlight Systems', 'Your record gives the title as “Director of Engineering”.']]);
  const id2 = job();
  expect(saveOwnerEdit(id2, swap(RESUME, '### Senior Engineer, Quillfeather Labs', '### Senior Engineer, Quillfeather'))).toBe('saved');
  expect(sugs(id2).map((s) => [s.kind, s.old, s.new, s.why])).toEqual([['employer', '### Senior Engineer, Quillfeather', '### Senior Engineer, Quillfeather Labs', 'Your record gives the employer as “Quillfeather Labs”.']]);
  const id3 = job();
  expect(saveOwnerEdit(id3, swap(RESUME, 'Jan 2016 – Feb 2021 · Duluth, MN', 'Jan 2015 – Feb 2021 · Duluth, MN'))).toBe('saved');
  expect(sugs(id3).map((s) => [s.where_, s.kind, s.old, s.new, s.why])).toEqual([['dates', 'dates', 'Jan 2015 – Feb 2021 · Duluth, MN', 'Jan 2016 – Feb 2021 · Duluth, MN', 'Your record gives the dates as Jan 2016 – Feb 2021.']]);
  // Only the date range changes: the owner's place stays, and none is added.
  const at = (line: string) => { const n = job(); saveOwnerEdit(n, swap(RESUME, 'Mar 2021 – Present · Remote', line)); return sugs(n).map((s) => [s.old, s.new]); };
  expect(at('Mar 2020 – Present · Austin, TX')).toEqual([['Mar 2020 – Present · Austin, TX', 'Mar 2021 – Present · Austin, TX']]);
  expect(at('Mar 2020 – Present')).toEqual([['Mar 2020 – Present', 'Mar 2021 – Present']]);
  expect(at('Mar 2020 – Present · Contract')).toEqual([['Mar 2020 – Present · Contract', 'Mar 2021 – Present · Contract']]);
  // The range already the record's: no dates suggestion, whatever else the line says.
  expect(at('Mar 2021 – Present · Austin, TX')).toEqual([]);
  // Never a word about where the record's value came from or how sure it is.
  for (const s of [...sugs(id), ...sugs(id2), ...sugs(id3)]) expect(s.why).not.toMatch(/source|LinkedIn|confirmed|memory|sure|verified/i);
});

test('a role whose title, employer or dates change: a suggestion on each edited resume that shows its employer, and only there', () => {
  const shows = job();
  const other = job('# Avery Lindqvist\nDuluth, MN\n\n## Experience\n### Senior Engineer, Quillfeather Labs\nJan 2016 – Feb 2021 · Duluth, MN\n- Rebuilt the quoting API.');
  expect(patchRole(1, { start: '2021-04' }).wrote).toBe(true);
  suggestAfterRoles(20);
  expect(sugs(shows).map((s) => [s.kind, s.old, s.new])).toEqual([['dates', 'Mar 2021 – Present · Remote', 'Apr 2021 – Present · Remote']]);
  expect(sugs(other)).toEqual([]);
  // Nothing changed since: a second pass writes nothing.
  const before = changes();
  suggestAfterRoles(21);
  expect(changes() - before).toBe(0);
});

test('no suggestion on a sent job, on a job being written, or on a resume a model wrote; that one is repaired directly as today', () => {
  const sent = job(RESUME, { outcome: 'applied' });
  const written = job(RESUME, { edited: 0 });
  const busy = job();
  db.run("UPDATE jobs SET resume_status = 'running' WHERE id = ?", [busy]);
  const reading = job();
  db.run("UPDATE jobs SET status = 'queued' WHERE id = ?", [reading]);
  notConfident('Kafka');
  expect(suggestSkills(10)).toEqual([]);
  expect(saveOwnerEdit(sent, swap(RESUME, '### Director of Engineering, Harborlight Systems', '### Head of Engineering, Harborlight Systems'))).toBe('saved');
  suggestAfterSave(sent, 11);
  expect([sugs(sent), sugs(written), sugs(busy), sugs(reading)]).toEqual([[], [], [], []]);
  // The model-written resume takes the list's Skills line straight away, as before rule 7.
  expect(refreshSkills()).toContain(written);
  expect(row(written).resume).toBe(withSkillLines(RESUME, POSTING, 2));
  expect(sugs(written)).toEqual([]);
});

test('an unchanged state makes no new row and no write', () => {
  const id = job();
  notConfident('Kafka');
  suggestSkills(10);
  let before = changes();
  expect(suggestSkills(11)).toEqual([]);
  expect(changes() - before).toBe(0);
  // A Save of a text that agrees with the record makes no suggestion.
  const id2 = job();
  expect(saveOwnerEdit(id2, RESUME.replace('Build the dispatch console.', 'Build the dispatch console for schedulers.'))).toBe('saved');
  expect(sugs(id2)).toEqual([]);
  before = changes();
  suggestAfterSave(id2, 12);
  expect(changes() - before).toBe(0);
  expect(sugs(id).length).toBe(1);
});

// ---------- The guards: a failure drops the suggestion, never repairs it ----------

test('each guard drops a suggestion that fails it', () => {
  const j = row(job());
  const base = { where_: 'skills' as const, entry: '', kind: 'skills' as const, why: 'Your skills list changed.' };
  notConfident('Kafka');
  const good = 'Go, Python';
  expect(guard(j, { ...base, old: 'Go, Python, Kafka', new: good })).toBe('');
  // The old words must be exactly one line of the text, standing once.
  expect(guard(j, { ...base, old: 'Go, Python', new: good })).toBe('old');
  expect(guard({ ...j, resume: `${RESUME}\n\n## Interests\nGo, Python, Kafka` }, { ...base, old: 'Go, Python, Kafka', new: good })).toBe('old');
  // The text with the line swapped raises no flag that was not there.
  const one = swap(RESUME, 'Go, Python, Kafka', 'Go');
  expect(guard({ ...j, resume: one }, { ...base, old: 'Go', new: 'Go, Fortran' })).toBe('flags');
  // The rule that asked for it no longer fires after the swap: no skill marked not confident is left on the line.
  expect(guard(j, { ...base, old: 'Go, Python, Kafka', new: 'Go, Kafka' })).toBe('rule');
  // A Skills suggestion never touches a heading line.
  expect(guard(j, { ...base, old: '## Skills', new: '## Skill' })).toBe('old');
  // A heading's new words are exactly the record's.
  const head = { ...j, resume: swap(RESUME, '### Director of Engineering, Harborlight Systems', '### Head of Engineering, Harborlight Systems') };
  const h = { where_: 'heading' as const, entry: 'harborlight systems', kind: 'title' as const, why: 'Your record gives the title as “Director of Engineering”.', old: '### Head of Engineering, Harborlight Systems' };
  expect(guard(head, { ...h, new: '### Director of Engineering, Harborlight Systems' })).toBe('');
  expect(guard(head, { ...h, new: '### Director of Engineering, Harborlight Systems, Inc.' })).toBe('record');
  expect(guard(head, { ...h, new: '### Principal Engineer, Harborlight Systems' })).toBe('rule');
});

// ---------- Keep, Reject and Undo ----------

function titled(): { id: number; s: Sug; text: string } {
  const id = job(), text = swap(RESUME, '### Director of Engineering, Harborlight Systems', '### Head of Engineering, Harborlight Systems');
  saveOwnerEdit(id, text);
  return { id, s: sugs(id)[0], text };
}

test('Keep: the line replaced, the other lines’ links untouched, a new letter, no PDF older than the text, still edited', () => {
  const { id, s, text } = titled();
  const links = row(id).links;
  expect(decide(s.id, 'keep', 30)).toEqual({ ok: true, jobId: id, wrote: true });
  const j = row(id);
  expect(j.resume).toBe(swap(text, s.old, s.new));
  expect([j.links, j.edited, j.pdf]).toEqual([links, 1, '']);
  expect(versions(id).at(-1)).toMatchObject({ why: 'suggestion', reason: 'You kept the suggested title.' });
  expect(sugs(id)[0].status).toBe('kept');
  // Decided once: a second Keep is refused in words.
  expect(decide(s.id, 'keep', 31)).toEqual({ ok: false, status: 409, error: 'This suggestion was already decided.' });
});

test('Keep of a new employer moves the links of its lines to the employer’s new name', () => {
  const id = job(swap(RESUME, '### Senior Engineer, Quillfeather Labs', '### Senior Engineer, Quillfeather'), { links: { v: 1, lines: [LINKS.lines[0], { ...LINKS.lines[1], entry: 'quillfeather' }] } });
  expect(saveOwnerEdit(id, row(id).resume.replace('Rebuilt the quoting API.', 'Rebuilt the quoting API in Go.'))).toBe('saved');
  const s = sugs(id).find((x) => x.kind === 'employer')!;
  decide(s.id, 'keep', 30);
  expect((JSON.parse(row(id).links) as Links).lines.map((l) => l.entry)).toEqual(['harborlight systems', 'quillfeather labs']);
  expect(resumeView(id)!.rows.find((r) => r.text === 'Rebuilt the quoting API in Go.')!.refs.map((x) => x.code.replace('‑', '-'))).toEqual(['F-0004']);
});

test('Reject sets the status only; nothing else is written', () => {
  const { id, s } = titled();
  const before = { resume: row(id).resume, links: row(id).links, pdf: row(id).pdf, versions: versions(id) }, at = changes();
  expect(decide(s.id, 'reject', 30)).toEqual({ ok: true, jobId: id, wrote: false });
  expect(changes() - at).toBe(1);
  expect({ resume: row(id).resume, links: row(id).links, pdf: row(id).pdf, versions: versions(id) }).toEqual(before);
  expect(sugs(id)[0].status).toBe('rejected');
});

test('Undo after Keep swaps back with a new letter; after Reject it opens again; refused in words when the line changed since', () => {
  const { id, s, text } = titled();
  decide(s.id, 'keep', 30);
  expect(decide(s.id, 'undo', 31)).toEqual({ ok: true, jobId: id, wrote: true });
  expect(row(id).resume).toBe(text);
  expect(versions(id).at(-1)).toMatchObject({ why: 'undo', reason: 'You undid the suggested title.' });
  expect([sugs(id)[0].status, row(id).edited, row(id).pdf]).toEqual(['open', 1, '']);
  expect(decide(s.id, 'reject', 32).ok).toBe(true);
  expect(decide(s.id, 'undo', 33)).toEqual({ ok: true, jobId: id, wrote: false });
  expect(sugs(id)[0].status).toBe('open');
  expect(decide(s.id, 'undo', 34)).toEqual({ ok: false, status: 409, error: 'There is nothing to undo.' });
  // Kept, then the owner edits that line: Undo is refused, and nothing is written.
  decide(s.id, 'keep', 35);
  saveOwnerEdit(id, swap(row(id).resume, s.new, '### Director of Engineering (Platform), Harborlight Systems'));
  const at = changes();
  expect(decide(s.id, 'undo', 36)).toEqual({ ok: false, status: 409, error: 'This line changed since. Nothing was undone.' });
  expect(changes() - at).toBe(0);
});

test('an unknown suggestion is gone; one whose line changed is stale and refused in words', () => {
  expect(decide(999, 'keep', 1)).toEqual({ ok: false, status: 404, error: 'That suggestion is gone.' });
  const { id, s, text } = titled();
  saveOwnerEdit(id, swap(text, s.old, '### Head of Platform, Harborlight Systems'));
  expect(sugs(id).find((x) => x.id === s.id)!.status).toBe('stale');
  expect(decide(s.id, 'keep', 30)).toEqual({ ok: false, status: 409, error: 'This line changed since the suggestion was made. Your words stay as they are.' });
});

// ---------- Stale ----------

test('an edit of that line makes the suggestion stale; an edit of another line does not; a rewrite makes all stale', () => {
  const { id, s, text } = titled();
  saveOwnerEdit(id, text.replace('Build the dispatch console.', 'Build the dispatch console for schedulers.'));
  expect(sugs(id).find((x) => x.id === s.id)!.status).toBe('open');
  expect(shownSuggestions(row(id)).map((x) => x.id)).toEqual([s.id]);
  setResume(id, row(id).resume, null, 'written', 'Written again.', { set: { edited: 0 } });
  expect(sugs(id).map((x) => x.status)).toEqual(['stale']);
  expect(shownSuggestions(row(id))).toEqual([]);
});

test('a rejected suggestion is never made again', () => {
  const { id, s, text } = titled();
  decide(s.id, 'reject', 30);
  saveOwnerEdit(id, text.replace('Build the dispatch console.', 'Build the dispatch console again.'));
  suggestAfterSave(id, 31);
  expect(sugs(id).map((x) => [x.id, x.status])).toEqual([[s.id, 'rejected']]);
});

test('a suggestion the record no longer asks for is not shown, and the next pass marks it stale', () => {
  const { id, s } = titled();
  // The owner changes the record to the resume's title.
  patchRole(1, { title: 'Head of Engineering' });
  expect(shownSuggestions(row(id))).toEqual([]);
  suggestAfterRoles(40);
  expect(sugs(id).find((x) => x.id === s.id)!.status).toBe('stale');
});

// ---------- The screen ----------

test('the screen: the line struck and added word by word, the reason as a Suggestion note, and a read writes nothing', () => {
  const { id, s } = titled();
  notConfident('Kafka');
  suggestSkills(10);
  const at = changes();
  const v = resumeView(id)!;
  expect(changes() - at).toBe(0);
  const h = v.rows.find((r) => r.kind === 'role' && r.text.startsWith('Head'))!;
  expect(h.sugs.map((x) => [x.id, x.status, x.parts.map((p) => [p.kind, p.text])])).toEqual([[String(s.id), 'open', [['gone', 'Head'], ['new', 'Director'], ['same', ' of Engineering, Harborlight Systems']]]]);
  expect(h.notes.map((n) => [n.kind, n.lead, n.text])).toContainEqual(['suggestion', 'Suggestion', 'Your record gives the title as “Director of Engineering”.']);
  // The suggestion's reason comes first on its row, so the cap of 2 never hides it.
  expect(h.notes[0].kind).toBe('suggestion');
  const skills = v.rows.find((r) => r.text === 'Go, Python, Kafka')!;
  expect(skills.sugs[0].parts.map((p) => [p.kind, p.text])).toEqual([['same', 'Go, Python'], ['gone', ', Kafka']]);
  expect(skills.notes.map((n) => [n.kind, n.text])).toEqual([['suggestion', 'You marked Kafka as not confident.']]);
  // Kept: the new words stand, the suggestion is kept, and its reason is no longer a note.
  decide(s.id, 'keep', 30);
  const k = resumeView(id)!.rows.find((r) => r.kind === 'role' && r.text.startsWith('Director'))!;
  expect([k.sugs.map((x) => x.status), k.notes.filter((n) => n.kind === 'suggestion')]).toEqual([['kept'], []]);
});

test('the word difference strikes only what goes', () => {
  expect(wordDiff('Go, Python, Kafka', 'Go, Python')).toEqual([{ kind: 'same', text: 'Go, Python' }, { kind: 'gone', text: ', Kafka' }]);
  expect(wordDiff('Mar 2020 – Present', 'Mar 2021 – Present')).toEqual([{ kind: 'same', text: 'Mar ' }, { kind: 'gone', text: '2020' }, { kind: 'new', text: '2021' }, { kind: 'same', text: ' – Present' }]);
  expect(wordDiff('Go', 'Go')).toEqual([{ kind: 'same', text: 'Go' }]);
  expect(wordDiff('Go, Python, Kotlin, Kubernetes', 'Go, Kubernetes, PostgreSQL')).toEqual([{ kind: 'same', text: 'Go, ' }, { kind: 'gone', text: 'Python, Kotlin, ' },
    { kind: 'same', text: 'Kubernetes' }, { kind: 'new', text: ', PostgreSQL' }]);
});

test('candidates come from the record and the list alone: the same state gives the same suggestions', () => {
  const { id } = titled();
  expect(candidates(row(id), { skills: true, entries: true })).toEqual(candidates(row(id), { skills: true, entries: true }));
});

test('the skills pass that writes the Skills lines of resumes a model wrote makes the suggestion for an edited one', async () => {
  const edited = job(), written = job(RESUME, { edited: 0 });
  notConfident('Kafka');
  skillsChanged(100);
  expect(await refreshDueSkills(100 + SKILLS_QUIET_MS, async () => {})).toEqual([written]);
  expect([row(edited).resume, sugs(edited).map((s) => s.kind), sugs(written)]).toEqual([RESUME, ['skills'], []]);
});

// ---------- Finding 4: the check a suggestion answers is not said twice ----------
test('while a suggestion is open, its row and the heading do not repeat the check it answers; after Reject or stale it is back', () => {
  const id = job();
  const t = swap(swap(RESUME, '### Director of Engineering, Harborlight Systems', '### Head of Engineering, Harborlight Systems'), 'Mar 2021 – Present · Remote', 'Mar 2020 – Present · Remote');
  saveOwnerEdit(id, t);
  const notes = () => { const v = resumeView(id)!; const at = (start: string) => v.rows.find((r) => r.text.startsWith(start))!.notes.map((n) => [n.kind, n.text]); return { head: at('Head of'), dates: at('Mar 2020') }; };
  const open = notes();
  expect(open.head[0]).toEqual(['suggestion', 'Your record gives the title as “Director of Engineering”.']);
  expect(open.dates[0]).toEqual(['suggestion', 'Your record gives the dates as Mar 2021 – Present.']);
  // Neither the title check nor the dates check stands while their suggestions are open, and no sentence is said twice.
  expect(open.head.map((n) => n[1]).filter((x) => x.startsWith('This resume gives the title') || x.startsWith('Your record gives the dates'))).toEqual([]);
  const all = [...open.head, ...open.dates].map((n) => n[1]);
  expect(new Set(all).size).toBe(all.length);
  // Rejected: the title check is back on the heading.
  const title = sugs(id).find((x) => x.kind === 'title')!, dates = sugs(id).find((x) => x.kind === 'dates')!;
  decide(title.id, 'reject', 30);
  expect(notes().head.map((n) => n[1])).toContain('This resume gives the title “Head of Engineering” here. Your record has “Director of Engineering” at this employer.');
  // Stale: the dates check is back on the heading.
  db.run("UPDATE resume_suggestions SET status = 'stale' WHERE id = ?", [dates.id]);
  expect(notes().head.map((n) => n[1])).toContain('Your record gives the dates as Mar 2021 – Present.');
});

// ---------- Finding 5: Keep runs the guards again on the text as it is now ----------
test('Keep refuses, and marks stale, a suggestion whose swap would now raise a new flag', () => {
  const id = job();
  saveOwnerEdit(id, swap(RESUME, 'Jan 2016 – Feb 2021 · Duluth, MN', 'Jan 2016 – Present · Duluth, MN'));
  const s = sugs(id).find((x) => x.kind === 'dates')!;
  expect([s.old, s.new]).toEqual(['Jan 2016 – Present · Duluth, MN', 'Jan 2016 – Feb 2021 · Duluth, MN']);
  // The owner rewrites the bullet in the present tense: right for a job held now, wrong once the dates end in 2021.
  saveOwnerEdit(id, row(id).resume.replace('- Rebuilt the quoting API.', '- Lead the quoting API rebuild.'));
  expect(sugs(id).find((x) => x.id === s.id)!.status).toBe('open');
  const text = row(id).resume;
  expect(decide(s.id, 'keep', 40)).toEqual({ ok: false, status: 409, error: 'This line changed since the suggestion was made. Your words stay as they are.' });
  expect([row(id).resume, sugs(id).find((x) => x.id === s.id)!.status]).toEqual([text, 'stale']);
});

// ---------- Finding 6: a role change is not lost when the pass fails ----------
test('a role change the pass could not finish is taken again on the next pass', () => {
  const id = job();
  patchRole(1, { start: '2021-04' });
  db.run('ALTER TABLE resume_suggestions RENAME TO resume_suggestions_away');
  expect(() => suggestAfterRoles(20)).toThrow();
  db.run('ALTER TABLE resume_suggestions_away RENAME TO resume_suggestions');
  suggestAfterRoles(21);
  expect(sugs(id).map((s) => [s.kind, s.new])).toEqual([['dates', 'Apr 2021 – Present · Remote']]);
});

// ---------- Finding 7: a sent job, and a job being read ----------
test('Keep or Reject on a sent job says it was sent; a job being read is busy as for an edit', () => {
  const { id, s } = titled();
  db.run("UPDATE jobs SET status = 'running' WHERE id = ?", [id]);
  expect(decide(s.id, 'keep', 1)).toEqual({ ok: false, status: 409, error: 'This job’s resume is being written now. Wait for it to finish, then decide.' });
  db.run("UPDATE jobs SET status = 'done', outcome = 'applied' WHERE id = ?", [id]);
  for (const act of ['keep', 'reject', 'undo'] as const) expect(decide(s.id, act, 2)).toEqual({ ok: false, status: 409, error: 'This resume was sent, and is kept as it was sent. Nothing was changed.' });
  expect(sugs(id)[0].status).toBe('open');
});

// ---------- Two Keeps on one entry, and Undo of the first ----------
test('Keep of a heading and then of its dates line; Undo of the first puts back only the heading', () => {
  const id = job();
  const t = swap(swap(RESUME, '### Director of Engineering, Harborlight Systems', '### Head of Engineering, Harborlight Systems'), 'Mar 2021 – Present · Remote', 'Mar 2020 – Present · Remote');
  saveOwnerEdit(id, t);
  const title = sugs(id).find((x) => x.kind === 'title')!, dates = sugs(id).find((x) => x.kind === 'dates')!;
  expect(decide(title.id, 'keep', 10).ok).toBe(true);
  expect(decide(dates.id, 'keep', 11).ok).toBe(true);
  const both = swap(swap(t, title.old, title.new), dates.old, dates.new);
  expect(row(id).resume).toBe(both);
  expect(decide(title.id, 'undo', 12)).toEqual({ ok: true, jobId: id, wrote: true });
  expect(row(id).resume).toBe(swap(both, title.new, title.old));
  expect(sugs(id).map((x) => [x.kind, x.status])).toEqual([['title', 'open'], ['dates', 'kept']]);
});

// ---------- Finding 11: a PDF never older than the text ----------
test('a PDF printed for a text that changed meanwhile is not stored; the next request prints again', () => {
  const id = job();
  const printed = row(id).resume;
  saveOwnerEdit(id, printed.replace('Build the dispatch console.', 'Build the dispatch console again.'));
  db.run("UPDATE jobs SET pdf = '/invented/newer.pdf' WHERE id = ?", [id]);
  expect(storePrinted(id, printed, { analysis: '{}', ats: '{"ok":true}', pdf: '/invented/older.pdf' })).toBe(false);
  expect(row(id).pdf).toBe('');
  const now = row(id).resume;
  expect(storePrinted(id, now, { analysis: '{}', ats: '{"ok":true}', pdf: '/invented/now.pdf' })).toBe(true);
  expect(row(id).pdf).toBe('/invented/now.pdf');
  void publish;
});

// ---------- Leftovers of 3a ----------
test('a Skills line that is not a plain list gets no suggestion', () => {
  db.run("INSERT INTO skills (key, name, kind, added_at, facts, in_bank) VALUES ('kotlin', 'Kotlin', 'language', 1, 1, 1), ('rust', 'Rust', 'language', 1, 1, 1), ('google cloud', 'Google Cloud', 'platform', 1, 1, 1)");
  const sentence = job(RESUME.replace('Go, Python, Kafka', 'Experienced in Go, Kotlin, and Rust.'));
  const or = job(RESUME.replace('Go, Python, Kafka', 'Go, Kotlin, or Rust'));
  const multi = job(RESUME.replace('Go, Python, Kafka', 'Go, Kotlin, Google Cloud'));
  notConfident('Kotlin');
  suggestSkills(10);
  expect([sugs(sentence), sugs(or)]).toEqual([[], []]);
  // A skill of several words that the list has as one skill is a plain item.
  expect(sugs(multi).map((s) => s.new)).toEqual(['Go, Google Cloud']);
});

test('a skill named twice on the line is named once in the reason, as the list spells it', () => {
  db.run("INSERT INTO skills (key, name, kind, added_at, facts, in_bank) VALUES ('kotlin', 'Kotlin', 'language', 1, 1, 1)");
  const id = job(RESUME.replace('Go, Python, Kafka', 'Go, kotlin, Python, KOTLIN'));
  notConfident('Kotlin');
  suggestSkills(10);
  expect(sugs(id).map((s) => [s.new, s.why])).toEqual([['Go, Python', 'You marked Kotlin as not confident.']]);
});

test('a print of an older text neither replaces nor clears the PDF stored for the text as it is', async () => {
  const id = job();
  const older = row(id).resume, newer = older.replace('Build the dispatch console.', 'Build the dispatch console again.');
  db.run('UPDATE jobs SET resume = ? WHERE id = ?', [newer, id]);
  const j = { id, company: 'Nimbus Yard', title: 'Staff Engineer' };
  // The newer text is printed and stored first.
  const fresh = pdfPath(j, newer);
  await Bun.write(fresh, 'newer');
  expect(storePrinted(id, newer, { analysis: '{}', ats: '{}', pdf: fresh })).toBe(true);
  // A late print of the older text arrives: it is not stored, its own file goes, and the newer PDF stays.
  const late = pdfPath(j, older);
  await Bun.write(late, 'older');
  expect(late).not.toBe(fresh);
  expect(storePrinted(id, older, { analysis: '{}', ats: '{}', pdf: late })).toBe(false);
  expect(row(id).pdf).toBe(fresh);
  expect([existsSync(fresh), existsSync(late), await Bun.file(fresh).text()]).toEqual([true, false, 'newer']);
  // The next print of a newer text replaces the stored one, and the older file goes.
  const third = older.replace('Build the dispatch console.', 'Build the dispatch console a third time.');
  db.run('UPDATE jobs SET resume = ? WHERE id = ?', [third, id]);
  const next = pdfPath(j, third);
  await Bun.write(next, 'third');
  expect(storePrinted(id, third, { analysis: '{}', ats: '{}', pdf: next })).toBe(true);
  expect([row(id).pdf, existsSync(fresh), existsSync(next)]).toEqual([next, false, true]);
});

test('the printed PDF folders survive the resume being kept as a text file, and a late print of an older text keeps no file of its own', async () => {
  const id = job(), j = { id, company: 'Nimbus Yard', title: 'Staff Engineer' }, text = row(id).resume;
  const printed = pdfPath(j, text);
  await Bun.write(printed, 'printed');
  expect(storePrinted(id, text, { analysis: '{}', ats: '{}', pdf: printed })).toBe(true);
  // Kept as a text file after a save: the earlier text file goes, the PDF folder of the text as it stands does not.
  const md = saveResume(j, text);
  expect([existsSync(md), existsSync(printed), row(id).pdf]).toEqual([true, true, printed]);
  // A print of a text the job no longer has, with no newer PDF stored: not stored, its file gone, the stored PDF kept
  // since it is the one of the text as it stands.
  const late = pdfPath(j, `${text}\nAn older line.`);
  await Bun.write(late, 'late');
  expect(storePrinted(id, `${text}\nAn older line.`, { analysis: '{}', ats: '{}', pdf: late })).toBe(false);
  expect([existsSync(late), row(id).pdf]).toEqual([false, printed]);
});

test('a print that failed keeps the PDF of the same text and removes no file', async () => {
  const id = job(), j = { id, company: 'Nimbus Yard', title: 'Staff Engineer' }, text = row(id).resume;
  const printed = pdfPath(j, text);
  await Bun.write(printed, 'printed');
  expect(storePrinted(id, text, { analysis: '{}', ats: '{}', pdf: printed })).toBe(true);
  // The next print of the same text fails: its check is stored, the PDF and its file stay.
  expect(storePrinted(id, text, { analysis: '{"failed":1}', ats: '{"ok":false}', pdf: '' })).toBe(true);
  expect([row(id).pdf, existsSync(printed), row(id).ats]).toEqual([printed, true, '{"ok":false}']);
});

test('the prints of job 1 are never those of jobs 10 and 100, and an old single PDF goes at the first new print', async () => {
  const dir = inData('resumes');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  db.run("INSERT INTO jobs (id, posting, title, company, status, analysis, resume, created_at, edited) VALUES (1, 'A posting.', 'Staff Engineer', 'Nimbus Yard', 'done', '{}', ?, 1, 1)", [RESUME]);
  // The layout before: one PDF file for each job; and the folders of jobs 10 and 100, and a folder of other things.
  for (const f of ['1-Avery Lindqvist - Nimbus Yard.pdf', '10-Avery Lindqvist - Other.pdf', '100-Avery Lindqvist.pdf', '1-nimbus-yard-staff-engineer.md']) writeFileSync(join(dir, f), 'x');
  for (const d of ['10-0123456789abcdef', '100-0123456789abcdef', '1-notes']) { mkdirSync(join(dir, d), { recursive: true }); writeFileSync(join(dir, d, 'a.pdf'), 'x'); }
  const p = pdfPath({ id: 1, company: 'Nimbus Yard', title: 'Staff Engineer' }, RESUME);
  await Bun.write(p, 'pdf');
  expect(storePrinted(1, RESUME, { analysis: '{}', ats: '{}', pdf: p })).toBe(true);
  const folder = p.slice(dir.length + 1).split('/')[0];
  expect(readdirSync(dir).sort()).toEqual(['1-nimbus-yard-staff-engineer.md', '1-notes', folder, '10-0123456789abcdef', '10-Avery Lindqvist - Other.pdf', '100-0123456789abcdef', '100-Avery Lindqvist.pdf'].sort());
  // The name the owner downloads is the person's, the employer's and the title's.
  expect(p.split('/').pop()).toBe('Avery Lindqvist - Nimbus Yard - Staff Engineer.pdf');
});
