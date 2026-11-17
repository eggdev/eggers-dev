// `bun test lib`: projects proposed for a role (lib/propose.ts). The model is a stand-in (fakeAsk): no model is ever
// asked. What it proves: every check drops a proposal that fails it, never repairing it by a guess; Keep checks again,
// marks a proposal whose facts moved as stale and applies nothing of it; Keep files the facts and leaves their role,
// the record's signature and every resume as they were; a result is written only when the owner says so; rejected
// titles are sent with the next request. Everything is invented.
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { db, fact, role, seed } from './scratch.ts';
import { bankSignature } from './db.ts';
import { fakeAsk, type Ask } from './llm.ts';
import { askFor, checkProposals, decideResult, keepProposal, openProposalRoles, proposalsOf, proposeFor, rejectProposal, requestFor, runQueued, suggestedResults, type SentFact } from './propose.ts';
import { addProject, addRole, deleteRole } from './record.ts';
import { activity } from './activity.ts';

const now = 1_800_000_000_000;
let ids: number[] = [];
beforeEach(() => {
  seed();
  role({ id: 4, company: 'Fernway', title: 'Head of Platform', start: '2023-03' });
  ids = ['Moved 40 services to one cloud.', 'Cut the cloud bill by 31%.', 'Wrote the migration plan.', 'Ran the weekly platform review.',
    'Hired 3 platform engineers.', 'Set up on-call for the platform team.', 'Retired the old deploy system.'].map((t, i) => fact(4, t, i === 1 ? '31% cut, $1.4M a year' : ''));
});
afterEach(() => fakeAsk());
const k = (n: number) => `fact:${ids[n]}`;
const sent = (): SentFact[] => requestFor(4).facts;

test('what is sent: the role as context, its unfiled facts with their keys, its projects and the titles rejected before', () => {
  db.query("UPDATE facts SET detail = ? WHERE id = ?").run('x'.repeat(500), ids[0]);
  db.run("INSERT INTO projects (role_id, title, created_at) VALUES (4, 'Platform hiring', 1)");
  db.query("INSERT INTO project_proposals (role_id, title, status, created_at) VALUES (4, 'Weekly reviews', 'rejected', 1)").run();
  const r = requestFor(4);
  expect(r.role).toBe('Head of Platform at Fernway');
  expect(r.dates).toBe('2023-03 to now');
  expect(r.facts.length).toBe(7);
  expect(r.facts[1]).toEqual({ key: k(1), text: 'Cut the cloud bill by 31%.', metric: '31% cut, $1.4M a year', kind: 'accomplishment', detail: '' });
  expect(r.facts[0].detail.length).toBe(400);
  expect(r.projects).toEqual(['Platform hiring']);
  expect(r.rejected).toEqual(['Weekly reviews']);
});

test('every check drops a proposal that fails it, and only that one', () => {
  const titles = ['Platform hiring'];
  const got = checkProposals({ projects: [
    { title: 'Cloud move', facts: [k(0), k(1), k(2)], result: k(1) },
    { title: 'Invented id', facts: [k(3), 'fact:99999'], result: '' },
    { title: 'Another role’s fact', facts: [k(3), 'fact:1'], result: '' },
    { title: 'Shared fact one', facts: [k(4), k(5)], result: '' },
    { title: 'Shared fact two', facts: [k(5), k(6)], result: '' },
    { title: 'Cut cost by 45%', facts: [k(3), k(6)], result: '' },
    { title: 'Platform hiring', facts: [k(3), k(4)], result: '' },
    { title: 'Result outside', facts: [k(3), k(4)], result: k(0) },
    { title: 'A title that runs on far past the eighty characters a project title may take in the studio', facts: [k(3), k(4)], result: '' },
    { title: 'Two\nlines', facts: [k(3), k(4)], result: '' },
  ] }, sent(), titles);
  // Kept: the one that passes every check. A fact proposed for two projects left both with one fact: both dropped.
  expect(got).toEqual([{ title: 'Cloud move', facts: [ids[0], ids[1], ids[2]], result: ids[1] }]);
  // A number in a title passes when one of the project's own facts has it.
  expect(checkProposals({ projects: [{ title: 'Cut cloud cost by 31%', facts: [k(1), k(2)], result: '' }] }, sent(), []).length).toBe(1);
  // A second proposal with the same title in one answer is a duplicate too.
  expect(checkProposals({ projects: [{ title: 'Cloud move', facts: [k(0), k(1)], result: '' }, { title: 'cloud  move', facts: [k(2), k(3)], result: '' }] }, sent(), []).map((c) => c.title)).toEqual(['Cloud move']);
  // An answer that is not in the shape asked for gives nothing.
  expect(checkProposals({} as never, sent(), [])).toEqual([]);
});

test('asking: refused in words below 6 facts in Day to day, for a missing role, and while a request is in hand', () => {
  expect(askFor(1)).toBe('Suggestions need at least 6 facts in this role’s Day to day.');
  expect(askFor(99)).toBe('That role is no longer in your record.');
  expect(askFor(4)).toBe('');
  expect(askFor(4)).toBe('Projects are being suggested for this role now.');
  // It is a row in Activity, waiting, with what it is about.
  const row = activity(now).items.find((i) => i.kind === 'propose-projects')!;
  expect(row).toMatchObject({ subject: '4', what: 'Suggesting projects for R-04, Head of Platform at Fernway', status: 'waiting', link: '/record/role/4' });
});

test('one request: the stand-in model is asked once, what passes is stored, and Home gets one item for the role', async () => {
  const asked: Ask[] = [];
  fakeAsk((call) => { asked.push(call); return { projects: [{ title: 'Cloud move', facts: [k(0), k(1), k(2)], result: k(1) }, { title: 'Invented', facts: ['fact:12345', k(3)], result: '' }] }; });
  expect(await proposeFor(4, '.', () => now)).toBe(1);
  expect(asked.length).toBe(1);
  expect(asked[0].prompt).toContain('"key":"' + k(0) + '"');
  expect(proposalsOf(4).map((p) => [p.title, p.facts.map((f) => f.ref), p.status])).toEqual([['Cloud move', [ids[0], ids[1], ids[2]].map((i) => `F-${String(i).padStart(4, '0')}`), 'open']]);
  expect(openProposalRoles()).toEqual([{ role: 4, n: 1, name: 'Head of Platform at Fernway' }]);
});

test('Keep files the facts in a new project and leaves their role, the signature and every resume as they were; the result waits for the owner', async () => {
  db.run("INSERT INTO jobs (id, posting, title, company, status, resume, created_at, bank_sig, edited, outcome) VALUES (1, 'A posting.', 'Engineer', 'Initech', 'done', '# A resume', 1, 'x', 0, '')");
  fakeAsk(() => ({ projects: [{ title: 'Cloud move', facts: [k(0), k(1), k(2)], result: k(1) }] }));
  await proposeFor(4, '.', () => now);
  const sig = bankSignature(), roles = db.query('SELECT role_id FROM facts ORDER BY id').all(), resume = db.query('SELECT resume, resume_status FROM jobs').all();
  const p = Number(proposalsOf(4)[0].id);
  const kept = keepProposal(p, {}, now);
  expect(kept.ok).toBe(true);
  const project = (kept as { project: number }).project;
  expect(db.query('SELECT role_id, title, origin, result FROM projects WHERE id = ?').get(project)).toEqual({ role_id: 4, title: 'Cloud move', origin: `proposal:${p}`, result: '' });
  expect((db.query('SELECT id FROM facts WHERE project_id = ? ORDER BY id').all(project) as { id: number }[]).map((f) => f.id)).toEqual([ids[0], ids[1], ids[2]]);
  expect(db.query('SELECT role_id FROM facts ORDER BY id').all()).toEqual(roles);
  expect(bankSignature()).toBe(sig);
  expect(db.query('SELECT resume, resume_status FROM jobs').all()).toEqual(resume);
  // The result is the owner's to confirm.
  expect(decideResult(p, true, now)).toEqual({ ok: true, project });
  expect(db.query('SELECT result FROM projects WHERE id = ?').get(project)).toEqual({ result: 'Cut the cloud bill by 31%.' });
  expect(decideResult(p, true, now).ok).toBe(false);
  expect(keepProposal(p, {}, now)).toEqual({ ok: false, error: 'That suggestion was already decided.', status: 409 });
  expect(openProposalRoles()).toEqual([]);
});

test('a proposal whose facts moved is stale on Keep: nothing is applied, and an edit keeps the rest', async () => {
  fakeAsk(() => ({ projects: [{ title: 'Cloud move', facts: [k(0), k(1), k(2)], result: k(1) }] }));
  await proposeFor(4, '.', () => now);
  const p = Number(proposalsOf(4)[0].id);
  db.query('UPDATE facts SET role_id = 1 WHERE id = ?').run(ids[1]);
  expect(proposalsOf(4)[0]).toMatchObject({ status: 'stale', staleNote: 'This suggestion is out of date: 1 of its facts has moved or been deleted since. Edit it to keep the rest, or say it is not a project.' });
  expect(keepProposal(p, {}, now)).toEqual({ ok: false, error: 'Some of its facts have moved since it was suggested, so it was not kept. Edit it to keep the rest.', status: 409 });
  expect(db.query("SELECT count(*) AS n FROM projects WHERE role_id = 4").get()).toEqual({ n: 0 });
  expect(db.query('SELECT status FROM project_proposals WHERE id = ?').get(p)).toEqual({ status: 'stale' });
  // Edited: the owner's title and the facts that are still there.
  expect(keepProposal(p, { title: 'Moved to one cloud', facts: [ids[1], ids[0]] }, now)).toEqual({ ok: false, error: 'A fact you chose is no longer in this role’s Day to day. Choose again.', status: 409 });
  const kept = keepProposal(p, { title: 'Moved to one cloud', facts: [ids[0], ids[2]] }, now);
  expect(kept.ok).toBe(true);
  expect(db.query('SELECT title FROM projects WHERE id = ?').get((kept as { project: number }).project)).toEqual({ title: 'Moved to one cloud' });
  // The result fact was not kept with it, so there is no result to confirm.
  expect(decideResult(p, true, now).ok).toBe(false);
});

test('a rejected title is sent with the next request, and a new request replaces the undecided ones', async () => {
  fakeAsk(() => ({ projects: [{ title: 'Weekly reviews', facts: [k(3), k(5)], result: '' }, { title: 'Cloud move', facts: [k(0), k(1)], result: '' }] }));
  await proposeFor(4, '.', () => now);
  const [a, b] = proposalsOf(4);
  expect(rejectProposal(Number(a.id), now)).toEqual({ ok: true });
  const asked: Ask[] = [];
  fakeAsk((call) => { asked.push(call); return { projects: [{ title: 'Weekly reviews', facts: [k(3), k(5)], result: '' }, { title: 'Platform hiring', facts: [k(4), k(6)], result: '' }] }; });
  await proposeFor(4, '.', () => now + 1);
  expect(asked[0].prompt).toContain('- Weekly reviews');
  // The rejected title is dropped even when proposed again; the undecided one from the first request is gone.
  expect(proposalsOf(4).map((p) => p.title)).toEqual(['Platform hiring']);
  expect(db.query('SELECT id FROM project_proposals WHERE id = ?').get(Number(b.id))).toBeNull();
  expect(db.query("SELECT title FROM project_proposals WHERE status = 'rejected'").all()).toEqual([{ title: 'Weekly reviews' }]);
});

test('deleting a role deletes its proposals', async () => {
  fakeAsk(() => ({ projects: [{ title: 'Cloud move', facts: [k(0), k(1)], result: '' }] }));
  await proposeFor(4, '.', () => now);
  deleteRole(4, now);
  expect(db.query('SELECT count(*) AS n FROM project_proposals').get()).toEqual({ n: 0 });
});

test('a suggested result is offered and used only while its fact is still in the kept project', async () => {
  fakeAsk(() => ({ projects: [{ title: 'Cloud move', facts: [k(0), k(1), k(2)], result: k(1) }] }));
  await proposeFor(4, '.', () => now);
  const p = Number(proposalsOf(4)[0].id);
  const project = (keepProposal(p, {}, now) as { project: number }).project;
  expect(suggestedResults().get(project)).toMatchObject({ fact: ids[1], text: 'Cut the cloud bill by 31%.' });
  // The result's fact is moved out of the project: it is no longer offered, and using it is refused.
  db.query('UPDATE facts SET project_id = NULL WHERE id = ?').run(ids[1]);
  expect(suggestedResults().has(project)).toBe(false);
  expect(decideResult(p, true, now)).toEqual({ ok: false, error: 'That fact is no longer in this project, so it cannot be its result.', status: 409 });
  expect(db.query('SELECT result FROM projects WHERE id = ?').get(project)).toEqual({ result: '' });
});

test('a title or name with a line break, a tab or an invisible character is refused everywhere a line is asked for', async () => {
  for (const bad of ['Cloud\u2028move', 'Cloud\tmove', 'Cloud\u200Bmove']) {
    expect(checkProposals({ projects: [{ title: bad, facts: [k(0), k(1)], result: '' }] }, sent(), [])).toEqual([]);
    expect(addRole({ title: bad, company: 'Corbel Yard' }, now).ok).toBe(false);
    expect(addRole({ title: 'Analyst', company: bad }, now).ok).toBe(false);
    expect(addProject({ title: bad, roleId: 4 }, now).ok).toBe(false);
  }
  fakeAsk(() => ({ projects: [{ title: 'Cloud move', facts: [k(0), k(1)], result: '' }] }));
  await proposeFor(4, '.', () => now);
  const p = Number(proposalsOf(4)[0].id);
  for (const bad of ['Cloud\u2028move', 'Cloud\tmove', 'Cloud\u200Bmove']) expect(keepProposal(p, { title: bad }, now).ok).toBe(false);
  expect(db.query('SELECT count(*) AS n FROM projects WHERE role_id = 4').get()).toEqual({ n: 0 });
  expect(keepProposal(p, { title: 'Moved to one cloud' }, now).ok).toBe(true);
});

test('the worker’s step: queued, then running, then done with the suggestions stored and a note of how many', async () => {
  const stages: string[] = [];
  fakeAsk(() => { stages.push((db.query('SELECT propose_status FROM roles WHERE id = 4').get() as { propose_status: string }).propose_status); return { projects: [{ title: 'Cloud move', facts: [k(0), k(1), k(2)], result: '' }] }; });
  expect(await runQueued('.', () => now)).toBe(false);
  expect(askFor(4)).toBe('');
  expect(await runQueued('.', () => now)).toBe(true);
  expect(stages).toEqual(['running']);
  expect(db.query('SELECT propose_status, propose_note FROM roles WHERE id = 4').get()).toEqual({ propose_status: 'done', propose_note: '1 project suggested' });
  expect(proposalsOf(4).map((p) => p.title)).toEqual(['Cloud move']);
  expect(await runQueued('.', () => now)).toBe(false);
});

test('the worker’s step that fails: Failed with the reason, and the record untouched', async () => {
  const before = { facts: db.query('SELECT * FROM facts ORDER BY id').all(), projects: db.query('SELECT * FROM projects ORDER BY id').all(), sig: bankSignature() };
  fakeAsk(() => { throw new Error('The model did not answer in time.'); });
  expect(askFor(4)).toBe('');
  expect(await runQueued('.', () => now)).toBe(true);
  expect(db.query('SELECT propose_status, propose_note FROM roles WHERE id = 4').get()).toEqual({ propose_status: 'failed', propose_note: 'The model did not answer in time.' });
  expect(proposalsOf(4)).toEqual([]);
  expect({ facts: db.query('SELECT * FROM facts ORDER BY id').all(), projects: db.query('SELECT * FROM projects ORDER BY id').all(), sig: bankSignature() }).toEqual(before);
  expect(activity(Date.now()).items.find((i) => i.kind === 'propose-projects')).toMatchObject({ status: 'failed', reason: 'The model did not answer in time.' });
});

test('a role with no title is named by its employer alone, and the digest line reads as part of a sentence', async () => {
  role({ id: 5, company: 'Corbel Yard', title: '', start: '2015-01', end: '2015-12', standing: 'contract' });
  for (let i = 0; i < 6; i++) fact(5, `Wrote the invented report number ${i}.`);
  fakeAsk(() => ({ projects: [] }));
  expect(askFor(5)).toBe('');
  expect(activity(Date.now()).items.find((i) => i.kind === 'propose-projects')).toMatchObject({ what: 'Suggesting projects for R-05, Corbel Yard' });
  await runQueued('.', () => now);
  const line = activity(Date.now()).digest.find((d) => d.link === '/record/role/5')?.line;
  expect(line).toBe('no project stood out in these facts for R-05');
  // Home's item for its suggestions names it the same way.
  const f5 = (db.query('SELECT id FROM facts WHERE role_id = 5 ORDER BY id').all() as { id: number }[]).map((f) => `fact:${f.id}`);
  fakeAsk(() => ({ projects: [{ title: 'Weekly reports', facts: [f5[0], f5[1]], result: '' }] }));
  expect(askFor(5)).toBe('');
  await runQueued('.', () => now);
  expect(openProposalRoles().find((r) => r.role === 5)?.name).toBe('Corbel Yard');
});
