// `bun test lib`: the record's writes by hand (lib/record.ts) on a scratch database (lib/scratch.ts). What they prove:
// filing a fact into a project of its own role moves the signature (a resume's writer is given it), and taking it out
// puts it back; a fact the owner filed survives a
// re-read of its source; a side project made by hand reads as a personal project on a resume; a role is stored as the
// owner gave it, with no mark of where a value came from; a partial edit of a fact keeps its story; a reference is
// never handed out twice.
// Every name, employer and number is invented.
import { beforeEach, expect, test } from 'bun:test';
import { db, fact, role, seed } from './scratch.ts';
import { applyExtraction, bankSignature } from './db.ts';
import { canonical, employers } from './entries.ts';
import { addFact, addProject, addRole, deleteProject, deleteRole, fullFact, parseWhen, patchFact, patchProject, patchRole, readTree } from './record.ts';
import type { RoleRow } from './db.ts';

beforeEach(() => seed());
const ok = <T extends { ok: boolean }>(d: T) => { if (!d.ok) throw new Error(JSON.stringify(d)); return d as Extract<T, { ok: true }>; };
const official = (id: number) => (db.query('SELECT official FROM roles WHERE id = ?').get(id) as { official: string }).official;
const placed = (id: number) => db.query('SELECT role_id, project_id, status FROM facts WHERE id = ?').get(id);

test('filing a fact into a project of its own role moves the signature, and back to Day to day it is as it was', () => {
  const before = bankSignature();
  // A project with no fact is not given to a resume's writer: no change.
  const p = ok(addProject({ title: 'Rebuilt dispatch', roleId: 1, when: '2022–2023', result: 'Schedulers stopped using paper.' }));
  expect(bankSignature()).toBe(before);
  // Filed, the fact reaches the writer under its project, with the project's result as context (stage 3): it moves.
  ok(patchFact(1, { projectId: String(p.id) }));
  expect(placed(1)).toEqual({ role_id: 1, project_id: p.id, status: 'confirmed' });
  expect(bankSignature()).not.toBe(before);
  expect(readTree().facts.find((f) => f.id === '1')).toMatchObject({ roleId: '1', projectId: String(p.id) });
  ok(patchFact(1, { projectId: '' }));
  expect(placed(1)).toEqual({ role_id: 1, project_id: null, status: 'confirmed' });
  expect(bankSignature()).toBe(before);
  // Deleting a project keeps its facts, in Day to day, and the signature is as it was before the project.
  ok(patchFact(2, { projectId: String(p.id) }));
  expect(bankSignature()).not.toBe(before);
  ok(deleteProject(p.id));
  expect(placed(2)).toMatchObject({ role_id: 1, project_id: null });
  expect(bankSignature()).toBe(before);
});

test('a fact the owner filed is kept where it was put when its source is read again', () => {
  db.run("INSERT INTO sources (id, kind, title, body, status, created_at) VALUES (1, 'text', 'Review 2024', 'x', 'done', 1)");
  const x = { roles: [], facts: [{ roleKey: 'role:1', kind: 'accomplishment', text: 'Moved billing to one queue.', detail: '', metric: '', skills: [], evidence: '' }] };
  applyExtraction(1, x, 1);
  const id = (db.query("SELECT id FROM facts WHERE text = 'Moved billing to one queue.'").get() as { id: number }).id;
  const p = ok(addProject({ title: 'Billing', roleId: 1 }));
  ok(patchFact(id, { projectId: String(p.id) }));
  applyExtraction(1, x, 2);
  expect(db.query("SELECT id, project_id FROM facts WHERE text = 'Moved billing to one queue.'").all()).toEqual([{ id, project_id: p.id }]);
});

test('a side project made by hand is one personal row the resume pipeline reads as a personal project', () => {
  const p = ok(addProject({ title: 'Lantern Notes', side: true, when: 'Jan 2022 – Jun 2023', lives: 'A code repository' }));
  const row = db.query("SELECT * FROM roles WHERE company = 'Lantern Notes'").get() as RoleRow;
  expect(row).toMatchObject({ title: '', standing: 'personal', start: '2022-01', end: '2023-06' });
  expect(canonical(employers([row])[0])).toMatchObject({ heading: 'Lantern Notes', dates: 'Jan 2022 – Jun 2023 · Personal project' });
  const t = readTree();
  expect(t.projects.find((x) => x.id === String(p.id))).toMatchObject({ place: 'side', carried: true, title: 'Lantern Notes', lives: 'A code repository' });
  // A fact added to it is filed under its row, so a resume can show it.
  const f = ok(addFact({ text: 'Wrote the sync engine.', projectId: String(p.id) }));
  expect(placed(f.id)).toMatchObject({ role_id: row.id, project_id: null });
  expect(readTree().facts.find((x) => x.id === String(f.id))).toMatchObject({ roleId: '', projectId: String(p.id) });
  // Deleting it keeps its facts, in General.
  ok(deleteProject(p.id));
  expect(placed(f.id)).toMatchObject({ role_id: null, project_id: null });
  expect(db.query("SELECT id FROM roles WHERE company = 'Lantern Notes'").get()).toBeNull();
});

test('a role is stored as the owner gave it: no mark of where a value came from is read or written', () => {
  // The marks the last version stored stay in their column; nothing reads them, and no change writes or clears them.
  db.run(`UPDATE roles SET official = '{"title":"hr","start":"memory"}' WHERE id = 1`);
  ok(patchRole(1, { title: 'Director of Platform', start: 'Apr 2021' }));
  expect(db.query('SELECT title, start, official FROM roles WHERE id = 1').get()).toEqual({ title: 'Director of Platform', start: '2021-04', official: '{"title":"hr","start":"memory"}' });
  db.run("UPDATE roles SET company = 'Harborlight' WHERE id = 1");
  expect(official(1)).toBe('{"title":"hr","start":"memory"}');
  // An old open tab may still send marks: they are ignored, with no error, and change nothing.
  const row = db.query('SELECT * FROM roles WHERE id = 2').get();
  expect(ok(patchRole(2, { official: { title: 'hr', location: 'memory' } })).wrote).toBe(false);
  expect(ok(patchRole(2, { official: 'not an object' })).wrote).toBe(false);
  expect(db.query('SELECT * FROM roles WHERE id = 2').get()).toEqual(row);
  expect(ok(patchRole(2, { location: 'Remote', official: { location: 'hr' } })).wrote).toBe(true);
  expect(db.query('SELECT location, official FROM roles WHERE id = 2').get()).toEqual({ location: 'Remote', official: '{}' });
  // A new role writes no mark either.
  const r = ok(addRole({ line: 'Head of Platform at Fernway', when: 'Mar 2023 – now', employment: 'employee', official: { title: 'hr' } }));
  expect(db.query('SELECT title, company, start, end, standing, official FROM roles WHERE id = ?').get(r.id)).toEqual({ title: 'Head of Platform', company: 'Fernway', start: '2023-03', end: '', standing: 'employer', official: '{}' });
  // The tree gives no marks.
  expect(Object.keys(readTree().roles[0])).not.toContain('marks');
});

test('a partial edit of a fact keeps its story and its result', () => {
  db.run("UPDATE facts SET detail = 'The story.', metric = '640 users' WHERE id = 1");
  ok(patchFact(1, { text: 'Built the dispatch console.' }));
  expect(db.query('SELECT text, detail, metric FROM facts WHERE id = 1').get()).toEqual({ text: 'Built the dispatch console.', detail: 'The story.', metric: '640 users' });
  ok(patchFact(1, { detail: 'A new story.' }));
  expect(db.query('SELECT text, detail, metric FROM facts WHERE id = 1').get()).toEqual({ text: 'Built the dispatch console.', detail: 'A new story.', metric: '640 users' });
  expect(patchFact(1, { text: '  ' })).toEqual({ ok: false, error: 'Enter the fact.', status: 400 });
  expect(fullFact(1)).toMatchObject({ ref: 'F-0001', detail: 'A new story.', metric: '640 users' });
  expect(Object.keys(fullFact(1)!)).not.toContain('source');
});

test('a reference is never handed out twice, even by a writer that sets no id', () => {
  const r = ok(addRole({ title: 'Engineer', company: 'Initech' }));
  const f = ok(addFact({ text: 'Shipped the TPS report tool.', roleId: r.id }));
  ok(deleteRole(r.id));
  expect(ok(addRole({ title: 'Engineer', company: 'Globex' })).id).toBe(r.id + 1);
  expect(ok(addFact({ text: 'A newer fact.' })).id).toBe(f.id + 1);
  // As the LinkedIn answer inserts a role: with no id. It lands above every id ever used.
  ok(deleteRole(r.id + 1));
  db.run("INSERT INTO roles (company, title, start, end, location, standing) VALUES ('Hooli', 'Engineer', '2020-01', '', '', 'employer')");
  expect((db.query("SELECT id FROM roles WHERE company = 'Hooli'").get() as { id: number }).id).toBe(r.id + 2);
});

test('a project or fact can go to a role made on the spot, which must read title at employer', () => {
  expect(addProject({ title: 'Platform rewrite', newRole: 'Fernway' })).toEqual({ ok: false, error: 'Name the new role as title at employer, or pick one from the list.', status: 400 });
  expect(db.query("SELECT count(*) AS n FROM roles WHERE company = 'Fernway'").get()).toEqual({ n: 0 });
  const p = ok(addProject({ title: 'Platform rewrite', newRole: 'Head of Platform at Fernway' }));
  const made = db.query("SELECT id, title FROM roles WHERE company = 'Fernway'").get() as { id: number; title: string };
  expect(p.madeRole).toBe(made.id);
  expect(made.title).toBe('Head of Platform');
  expect(readTree().projects.find((x) => x.id === String(p.id))).toMatchObject({ place: 'role', roleId: String(made.id), carried: false });
  expect(addRole({ line: 'Head of Platform' })).toEqual({ ok: false, error: 'Write the role as title at employer, such as Director of Engineering at Harborlight Systems.', status: 400 });
  expect(addProject({ title: '' , roleId: 1 })).toEqual({ ok: false, error: 'Write the first line. Everything else can wait.', status: 400 });
  expect(addProject({ title: 'X', roleId: 1, when: 'sometime' })).toEqual({ ok: false, error: 'Write the dates like Mar 2023 – now, or 2019–2021.', status: 400 });
});

test('a repository nobody placed is shown as not placed, and is placed only by the owner', () => {
  role({ id: 9, company: 'avery/sketchbook', title: '', standing: '' });
  fact(9, 'Drew a sketch a day.');
  const t = readTree();
  const p = t.projects.find((x) => x.title === 'avery/sketchbook')!;
  expect(p).toMatchObject({ place: 'unplaced', carried: true, roleId: '' });
  ok(patchProject(Number(p.id), { roleId: 2 }));
  expect(db.query('SELECT part_of FROM roles WHERE id = 9').get()).toEqual({ part_of: 2 });
  expect(readTree().projects.find((x) => x.id === p.id)).toMatchObject({ place: 'role', roleId: '2' });
  ok(patchProject(Number(p.id), { side: true }));
  expect(readTree().projects.find((x) => x.id === p.id)).toMatchObject({ place: 'side', roleId: '' });
  // A project of a role does not move between roles; its facts do.
  const q = ok(addProject({ title: 'Quoting', roleId: 2 }));
  expect(patchProject(q.id, { roleId: 1 }).ok).toBe(false);
});

test('dates are read as the owner writes them', () => {
  expect(parseWhen('Mar 2023 – now', 'role')).toEqual({ start: '2023-03', end: '' });
  expect(parseWhen('2019–2021', 'project')).toEqual({ start: '2019', end: '2021' });
  expect(parseWhen('2019-2021', 'project')).toEqual({ start: '2019', end: '2021' });
  expect(parseWhen('since 2020', 'role')).toEqual({ start: '2020', end: '' });
  expect(parseWhen('2024', 'project')).toEqual({ start: '2024', end: '2024' });
  expect(parseWhen('2024', 'role')).toEqual({ start: '2024', end: '' });
  expect(parseWhen('06/2018 to 11/2019', 'role')).toEqual({ start: '2018-06', end: '2019-11' });
  expect(parseWhen('', 'role')).toEqual({ start: '', end: '' });
  expect(parseWhen('2021 – 2019', 'role')).toBeNull();
  expect(parseWhen('last spring', 'role')).toBeNull();
});

test('the tree of a full record (19 roles, 40 projects, 350 facts) stays small enough to read at once', () => {
  db.run('DELETE FROM facts'); db.run('DELETE FROM roles'); db.run('DELETE FROM projects');
  const words = 'Cut the nightly claims export from six hours to forty minutes by moving it to a streaming job';
  let first = 0;
  for (let r = 1; r <= 19; r++) {
    const made = ok(addRole({ line: `Senior Platform Engineer ${r} at Invented Company ${r}`, when: `${2000 + r}-01 – ${2001 + r}-06`, employment: 'employee', location: 'Duluth, MN' }));
    first ||= made.id;
    for (let p = 0; p < 2; p++) {
      const part = `${words}, which the finance team had asked for since the spring.`;
      const proj = ok(addProject({ title: `Moved billing to one pipeline ${r}.${p}`, roleId: made.id, when: `${2000 + r}`, context: part, action: part, result: part, learning: part }));
      for (let f = 0; f < 9; f++) ok(addFact({ text: `${words} (${r}.${p}.${f}).`, metric: '6 hours to 40 minutes', projectId: String(proj.id) }));
    }
  }
  while ((db.query('SELECT count(*) AS n FROM facts').get() as { n: number }).n < 350) ok(addFact({ text: `${words}.`, metric: '9 hours a week', roleId: first }));
  const t = readTree(), size = JSON.stringify(t).length;
  console.log(`GET /tree for ${t.roles.length} roles, ${t.projects.length} projects and ${t.facts.length} facts: ${Math.round(size / 1024)} KB`);
  expect([t.roles.length, t.facts.length]).toEqual([19, 350]);
  expect(size).toBeLessThan(250 * 1024);
});

test('a fact moves from a project of its role back to Day to day, and to another role, as the screen sends it', () => {
  const p = ok(addProject({ title: 'Billing', roleId: 1 }));
  ok(patchFact(1, { projectId: String(p.id) }));
  ok(patchFact(1, { roleId: '1', projectId: '' }));
  expect(placed(1)).toMatchObject({ role_id: 1, project_id: null });
  ok(patchFact(1, { projectId: String(p.id) }));
  // An older screen sends the same role back with an edit: the fact keeps its project.
  ok(patchFact(1, { roleId: '1', text: 'Built the dispatch console.' }));
  expect(placed(1)).toMatchObject({ role_id: 1, project_id: p.id });
  ok(patchFact(1, { roleId: '2', projectId: '' }));
  expect(placed(1)).toMatchObject({ role_id: 2, project_id: null });
  ok(patchFact(1, { roleId: '', projectId: '' }));
  expect(placed(1)).toMatchObject({ role_id: null, project_id: null });
});

// ---------- After the review of stage 1 ----------
const written = () => (db.query('SELECT at FROM record_written WHERE id = 1').get() as { at: number }).at;
const roleNow = (id: number) => db.query('SELECT * FROM roles WHERE id = ?').get(id);
// What the role's edit form sends when the owner presses Save and changed nothing: every field as it shows it.
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shown = (ym: string) => (ym.length === 7 ? `${months[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}` : ym);
const asTheFormSends = (id: number) => {
  const t = readTree().roles.find((r) => r.id === String(id))!;
  return { title: t.title, company: t.company, start: shown(t.start), end: shown(t.end), employment: t.employment, location: t.location, reach: t.reach };
};

test('a role saved with no change writes nothing, in each stored form of its employment type', () => {
  for (const [standing, label] of [['employer', 'Contract'], ['', 'Part-time'], ['own', ''], ['contract', '']]) {
    seed();
    db.query('UPDATE roles SET standing = ?, label = ?, official = ? WHERE id = 2').run(standing, label, '{"title":"hr","start":"memory"}');
    const row = roleNow(2), sig = bankSignature();
    expect(ok(patchRole(2, asTheFormSends(2))).wrote).toBe(false);
    expect(roleNow(2)).toEqual(row);
    expect(bankSignature()).toBe(sig);
    expect(written()).toBe(0);
  }
  // A real change is written, and its time kept.
  expect(ok(patchRole(2, { ...asTheFormSends(2), location: 'Remote' }, 5000)).wrote).toBe(true);
  expect(written()).toBe(5000);
});

test('a project saved with no change writes nothing, one carried by a roles row too, and a fact the same', () => {
  role({ id: 9, company: 'lantern-notes', title: '', standing: 'personal', start: '2022-05', end: '2023-01' });
  role({ id: 10, company: 'tidewater', title: '', start: '2015', end: '2019', part_of: 1 });
  const native = ok(addProject({ title: 'Billing', roleId: 1, when: '2024', result: 'One queue.' }));
  readTree();
  const before = { roles: db.query('SELECT * FROM roles ORDER BY id').all(), projects: db.query('SELECT * FROM projects ORDER BY id').all() }, sig = bankSignature();
  db.run('UPDATE record_written SET at = 0');
  const typed = (p: { start: string; end: string }) => (p.start === '' ? '' : p.end === '' ? `${shown(p.start)} – now` : p.start === p.end ? shown(p.start) : `${shown(p.start)} – ${shown(p.end)}`);
  for (const p of readTree().projects) {
    const place = p.place === 'side' ? { side: true } : p.carried ? { roleId: Number(p.roleId) } : {};
    const d = ok(patchProject(Number(p.id), { title: p.title, when: typed(p), lives: p.lives, result: p.result, context: p.context, action: p.action, learning: p.learning, ...place }));
    expect([p.title, d.wrote]).toEqual([p.title, false]);
  }
  expect({ roles: db.query('SELECT * FROM roles ORDER BY id').all(), projects: db.query('SELECT * FROM projects ORDER BY id').all() }).toEqual(before);
  expect(bankSignature()).toBe(sig);
  db.run("UPDATE facts SET status = 'proposed' WHERE id = 1");
  const fact = db.query('SELECT * FROM facts WHERE id = 1').get() as { text: string; detail: string; metric: string; kind: string };
  expect(ok(patchFact(1, { text: fact.text, detail: fact.detail, metric: fact.metric, kind: fact.kind })).wrote).toBe(false);
  expect(db.query('SELECT * FROM facts WHERE id = 1').get()).toEqual(fact);
  expect(written()).toBe(0);
  void native;
});

test('a field sent as null or as a number is left as it is, never blanked', () => {
  db.run("UPDATE facts SET detail = 'The story.', metric = '640 users' WHERE id = 1");
  const before = db.query('SELECT text, detail, metric, baseline, team, own_part FROM facts WHERE id = 1').get();
  ok(patchFact(1, { text: null, detail: 5, metric: { x: 1 }, baseline: null, team: false, ownPart: [] }));
  expect(db.query('SELECT text, detail, metric, baseline, team, own_part FROM facts WHERE id = 1').get()).toEqual(before);
  ok(patchRole(1, { title: null, company: 7, location: 'Remote' }));
  expect(db.query('SELECT title, company, location FROM roles WHERE id = 1').get()).toEqual({ title: 'Director of Engineering', company: 'Harborlight Systems', location: 'Remote' });
  const p = ok(addProject({ title: 'Billing', roleId: 1, result: 'One queue.' }));
  ok(patchProject(p.id, { title: null, result: 3, action: 'Moved the queue.' }));
  expect(db.query('SELECT title, result, action FROM projects WHERE id = ?').get(p.id)).toEqual({ title: 'Billing', result: 'One queue.', action: 'Moved the queue.' });
});

test('a role line that says "at" more than once is refused, not split by a guess; a role needs a title', () => {
  expect(addRole({ line: 'Head of Data at Scale at Acme' })).toEqual({ ok: false, error: 'This says “at” more than once, so the studio cannot tell the title from the employer. Write them in their own fields.', status: 400, split: true });
  expect(ok(addRole({ title: 'Head of Data at Scale', company: 'Acme' })).ok).toBe(true);
  expect(addProject({ title: 'Data platform', newRole: 'Head of Data at Scale at Acme' })).toMatchObject({ ok: false, status: 400 });
  expect(db.query("SELECT count(*) AS n FROM roles WHERE company LIKE '%Acme%'").get()).toEqual({ n: 1 });
  expect(addRole({ company: 'avery/sketchbook' })).toEqual({ ok: false, error: 'Enter the official title.', status: 400 });
});

test('a title, an employer and a project name are one line of at most 200 characters, and are never cut', () => {
  const long = 'x'.repeat(201);
  expect(addRole({ title: long, company: 'Acme' })).toEqual({ ok: false, error: 'Keep the title to one line of at most 200 characters.', status: 400 });
  expect(addRole({ title: 'Engineer', company: 'Acme\nInc' })).toEqual({ ok: false, error: 'Keep the employer to one line of at most 200 characters.', status: 400 });
  expect(addProject({ title: 'Two\nlines', roleId: 1 })).toEqual({ ok: false, error: 'Keep the name to one line of at most 200 characters.', status: 400 });
  expect(patchRole(1, { title: long }).ok).toBe(false);
  const p = ok(addProject({ title: 'Billing', roleId: 1 }));
  expect(patchProject(p.id, { title: long }).ok).toBe(false);
  expect(ok(addRole({ title: 'x'.repeat(200), company: 'Acme' })).ok).toBe(true);
});

test('a fact that changes role leaves its project, and deleting a project never deletes a fact of another role', async () => {
  const p = ok(addProject({ title: 'Billing', roleId: 1 }));
  ok(patchFact(1, { projectId: String(p.id) }));
  ok(patchFact(2, { projectId: String(p.id) }));
  // A Talk correction files fact 1 under role 2: it leaves the project of role 1.
  const { fakeAsk } = await import('./llm.ts');
  const { reply } = await import('./talk.ts');
  fakeAsk(() => ({ reply: 'Noted.', answered: [], facts: [{ roleKey: 'role:2', kind: 'accomplishment', text: 'Built the dispatch console.', detail: '', metric: '', skills: [], replaces: 'fact:1' }] }));
  db.run("INSERT INTO talk (id, who, status, created_at) VALUES (1, 'claude', 'queued', 1)");
  await reply({ id: 1 } as never, '.');
  fakeAsk();
  expect(placed(1)).toMatchObject({ role_id: 2, project_id: null });
  // A stray name, as an older writer could leave it: fact 4 of role 2 still names role 1's project.
  db.query('UPDATE facts SET project_id = ? WHERE id = 4').run(p.id);
  ok(deleteProject(p.id, 'delete'));
  expect(db.query('SELECT id FROM facts WHERE id = 2').get()).toBeNull();
  expect(placed(4)).toMatchObject({ role_id: 2, project_id: null });
  // Moving a fact to another role by hand clears its project too.
  const q = ok(addProject({ title: 'Quoting', roleId: 2 }));
  ok(patchFact(4, { projectId: String(q.id) }));
  ok(patchFact(4, { roleId: '3' }));
  expect(placed(4)).toMatchObject({ role_id: 3, project_id: null });
});

test('deleting a role deletes its facts (kept out of later readings) and its own projects; a repository filed under it is no longer placed', () => {
  role({ id: 9, company: 'harborlight/dispatch', title: '', part_of: 1 });
  const repoFact = fact(9, 'Wrote the dispatch queue.');
  const p = ok(addProject({ title: 'Billing', roleId: 1 }));
  ok(deleteRole(1));
  expect(db.query('SELECT count(*) AS n FROM facts WHERE role_id = 1').get()).toEqual({ n: 0 });
  expect((db.query('SELECT text FROM deleted_facts ORDER BY text').all() as { text: string }[]).map((r) => r.text)).toEqual(['built the dispatch console that schedulers use every day.', 'cut the nightly billing run.', 'wrote the test suite for the console.']);
  expect(db.query('SELECT id FROM projects WHERE id = ?').get(p.id)).toBeNull();
  expect(db.query('SELECT part_of FROM roles WHERE id = 9').get()).toEqual({ part_of: null });
  expect(readTree().projects.find((x) => x.title === 'harborlight/dispatch')).toMatchObject({ place: 'unplaced' });
  expect(placed(repoFact)).toMatchObject({ role_id: 9 });
});

test('deleting a carried project moves its facts to its role, or to General, and deletes its row; facts=delete deletes them', () => {
  role({ id: 9, company: 'harborlight/dispatch', title: '', part_of: 1 });
  role({ id: 10, company: 'lantern-notes', title: '', standing: 'personal' });
  role({ id: 11, company: 'avery/sketchbook', title: '' });
  const a = fact(9, 'Wrote the dispatch queue.'), b = fact(10, 'Built a notes app.'), c = fact(11, 'Drew a sketch a day.');
  const byTitle = (t: string) => Number(readTree().projects.find((x) => x.title === t)!.id);
  ok(deleteProject(byTitle('harborlight/dispatch')));
  expect(placed(a)).toEqual({ role_id: 1, project_id: null, status: 'confirmed' });
  ok(deleteProject(byTitle('lantern-notes')));
  expect(placed(b)).toEqual({ role_id: null, project_id: null, status: 'confirmed' });
  expect(db.query('SELECT id FROM roles WHERE id IN (9, 10)').all()).toEqual([]);
  ok(deleteProject(byTitle('avery/sketchbook'), 'delete'));
  expect(db.query('SELECT id FROM facts WHERE id = ?').get(c)).toBeNull();
  expect(db.query("SELECT text FROM deleted_facts WHERE text = 'drew a sketch a day.'").get()).toEqual({ text: 'drew a sketch a day.' });
  expect(db.query('SELECT id FROM roles WHERE id = 11').get()).toBeNull();
});

test('a hand write holds the rewrite of unsent resumes for 15 minutes, as an answer does, and Activity says when', async () => {
  const { holdSince, rewriteDue, ANSWER_HOLD_MS } = await import('./raised.ts');
  const { dueIn } = await import('./activity.ts');
  const T = Date.UTC(2026, 10, 17, 12);
  expect(holdSince()).toBe(0);
  ok(patchRole(2, { location: 'Remote' }, T));
  expect(holdSince()).toBe(T);
  // The bank has been still for an hour: only the hand write holds it.
  expect(rewriteDue(T + ANSWER_HOLD_MS - 1, T - 3_600_000, 180_000, holdSince())).toBe(false);
  expect(rewriteDue(T + ANSWER_HOLD_MS, T - 3_600_000, 180_000, holdSince())).toBe(true);
  // An unsent resume written from an older record: Activity says the studio starts on it when the hold ends.
  db.run("INSERT INTO jobs (id, posting, title, company, status, resume, created_at, bank_sig, edited, outcome, resume_status) VALUES (1, 'A posting.', 'Engineer', 'Initech', 'done', '# A resume', 1, 'older', 0, '', 'done')");
  expect(dueIn(T + 1000, () => 'newer')).toBe(ANSWER_HOLD_MS - 1000);
  // An unchanged Save keeps no time.
  ok(patchRole(2, { location: 'Remote' }, T + 60_000));
  expect(holdSince()).toBe(T);
});

test('every insert into roles or facts takes its id from nextId (only lib/linkedin.ts cannot)', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const root = join(import.meta.dir, '..');
  // Test support makes its rows with fixed ids on scratch databases; the server and the worker never load it.
  const support = ['lib/scratch.ts', 'lib/oldschema.ts'], known = ['lib/linkedin.ts'];
  const files = [...readdirSync(join(root, 'lib')).map((f) => `lib/${f}`), 'server.ts', 'worker.ts', ...readdirSync(join(root, 'tools')).map((f) => `tools/${f}`)]
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !support.includes(f));
  const bad: string[] = [];
  for (const f of files) {
    const src = readFileSync(join(root, f), 'utf8');
    for (const m of src.matchAll(/INSERT\s+(?:OR\s+\w+\s+)?INTO\s+(roles|facts)\b[^;`'"]*?VALUES\s*\(([^)]*)/gi)) {
      if (!m[2].includes('nextId')) bad.push(`${f}: ${m[0].slice(0, 60)}`);
    }
  }
  expect(bad.filter((b) => !known.some((k) => b.startsWith(`${k}:`)))).toEqual([]);
  // The one known exception is still there, so this test would see a second one.
  expect(bad.filter((b) => b.startsWith('lib/linkedin.ts:')).length).toBe(1);
});
