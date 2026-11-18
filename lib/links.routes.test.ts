// `bun test lib`: rule 7 over HTTP, on a real `server.ts` (--stub-github: no PDF, no model) and a throw-away database
// made with the old schema. The owner's edit carries the links (lib/links.ts, carry) and makes one version letter; a
// Save that changes nothing makes none; no route's answer, the editor's text included, holds a fact's key. The server
// is stopped by its own process id. Everything is invented.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from './testserver.ts';
import { oldDatabase } from './oldschema.ts';

const dir = mkdtempSync(join(tmpdir(), 'egg-links-routes-')), file = join(dir, 'egg.db');
let server: ReturnType<typeof Bun.spawn> | undefined, base = '';
setDefaultTimeout(60_000);

const RESUME = '# Avery Lindqvist\nDuluth, MN · avery@lindqvist.example · 218-555-0142\n\n## Summary\nEngineer.\n\n## Experience\n### Director of Engineering, Harborlight Systems\nMar 2021 – Present\n- Built the dispatch console for 640 users.\n\n### Senior Engineer, Quillfeather Labs\nJan 2016 – Feb 2021\n- Rebuilt the quoting API.\n\n## Skills\nGo';
const LINKS = { v: 1, lines: [{ where: 'summary', entry: '', text: 'Engineer.', facts: [1], edited: 0 }, { where: 'bullet', entry: 'harborlight systems', text: 'Built the dispatch console for 640 users.', facts: [1], edited: 0 },
  { where: 'bullet', entry: 'quillfeather labs', text: 'Rebuilt the quoting API.', facts: [2], edited: 0 }] };

beforeAll(async () => {
  oldDatabase(file);
  ({ base, server } = await startServer({ DB: file, EGG_INBOX: join(dir, 'inbox') }));
  // The server has added the links column: a resume a model wrote with links, as the worker would store it.
  const d = new Database(file);
  d.query("UPDATE jobs SET resume = ?, links = ?, edited = 0, analysis = ? WHERE id = 1").run(RESUME, JSON.stringify(LINKS), JSON.stringify({ verdict: '', requirements: [], strengths: [], risks: [], changes: [], gaps: [] }));
  d.close();
}, 90_000);
afterAll(async () => { server?.kill(); await server?.exited; rmSync(dir, { recursive: true, force: true }); });

const call = async (method: string, path: string, body?: unknown) => { const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, text: await r.text() }; };
const read = <T>(sql: string) => { const d = new Database(file, { readonly: true }); try { return d.query(sql).all() as T[]; } finally { d.close(); } };
const KEY = /(?:fact|project|role)\s*:\s*\d/i;

test('the owner’s edit keeps a line replaced in place linked, as edited, makes one letter, and its number is still checked', async () => {
  const edited = RESUME.replace('for 640 users.', 'for 900 users.');
  expect((await call('PATCH', '/jobs/1', { resume: edited })).status).toBe(200);
  const [job] = read<{ resume: string; links: string; edited: number }>('SELECT resume, links, edited FROM jobs WHERE id = 1');
  expect(job.edited).toBe(1);
  const lines = JSON.parse(job.links).lines as { text: string; facts: number[]; edited: number }[];
  expect(lines.map((l) => [l.text, l.facts, l.edited > 0])).toEqual([['Engineer.', [1], false], ['Built the dispatch console for 900 users.', [1], true], ['Rebuilt the quoting API.', [2], false]]);
  expect(read('SELECT n, why, reason FROM resume_versions WHERE job_id = 1 ORDER BY n')).toEqual([
    { n: 1, why: 'written', reason: 'As it stood before versions were kept.' }, { n: 2, why: 'edited', reason: 'You edited 1 line.' }]);
  const page = await call('GET', '/jobs/1');
  const flags = JSON.parse(page.text).flags as { kind: string; text: string }[];
  expect(flags.filter((f) => f.kind === 'link-number').map((f) => f.text)).toEqual(['“Built the dispatch console for 900 users.” uses 900, which is in none of the facts it cites. F-0001 says “Built the dispatch console. (640 users)”. Those facts were linked before you edited the line. Take it out, or cite the fact that states it.']);
  // A Save that changes nothing makes no letter.
  expect((await call('PATCH', '/jobs/1', { resume: edited })).status).toBe(200);
  expect(read('SELECT n FROM resume_versions WHERE job_id = 1').length).toBe(2);
});

test('no route’s answer holds a fact’s key: the job, the list, the editor’s text', async () => {
  for (const path of ['/jobs/1', '/jobs', '/jobs/2']) {
    const r = await call('GET', path);
    expect([path, KEY.test(r.text)]).toEqual([path, false]);
  }
  expect(JSON.parse((await call('GET', '/jobs/1')).text).resume).toContain('for 900 users.');
});

test('a new length keeps the text as it stood before the next writing', async () => {
  const d = new Database(file);
  d.run("INSERT INTO jobs (id, posting, title, company, status, resume, created_at) VALUES (3, 'A posting.', 'Engineer', 'Globex', 'done', '# A resume', 1)");
  d.close();
  expect((await call('PATCH', '/jobs/3', { pages: 1 })).status).toBe(200);
  expect(read('SELECT n, why, pages FROM resume_versions WHERE job_id = 3')).toEqual([{ n: 1, why: 'written', pages: 2 }]);
  expect(read("SELECT pages, resume_status FROM jobs WHERE id = 3")).toEqual([{ pages: 1, resume_status: 'queued' }]);
});

test('a line the owner added is not listed in What to look at; a Save with no change writes nothing', async () => {
  const now = read<{ resume: string }>('SELECT resume FROM jobs WHERE id = 1')[0].resume;
  const added = now.replace('- Rebuilt the quoting API.', '- Rebuilt the quoting API.\n- Mentored two engineers.');
  expect((await call('PATCH', '/jobs/1', { resume: added })).status).toBe(200);
  const lines = JSON.parse(read<{ links: string }>('SELECT links FROM jobs WHERE id = 1')[0].links).lines as { text: string; facts: number[] }[];
  expect(lines.find((l) => l.text === 'Mentored two engineers.')!.facts).toEqual([]);
  const flags = JSON.parse((await call('GET', '/jobs/1')).text).flags as { kind: string }[];
  expect(flags.filter((f) => f.kind === 'unlinked')).toEqual([]);
  // The stored flag is still there, for the line itself (stage 2).
  const stored = JSON.parse(read<{ analysis: string }>('SELECT analysis FROM jobs WHERE id = 1')[0].analysis).flags as { kind: string; severity: string }[];
  expect(stored.filter((f) => f.kind === 'unlinked').map((f) => f.severity)).toEqual(['info']);
  // The same text saved again: no letter, no new analysis.
  const before = read<{ analysis: string; updated_at: number }>('SELECT analysis, updated_at FROM jobs WHERE id = 1')[0], versions = read('SELECT n FROM resume_versions WHERE job_id = 1').length;
  expect((await call('PATCH', '/jobs/1', { resume: added })).status).toBe(200);
  expect(read('SELECT analysis, updated_at FROM jobs WHERE id = 1')[0]).toEqual(before);
  expect(read('SELECT n FROM resume_versions WHERE job_id = 1').length).toBe(versions);
});

test('a save made over a text that changed since the editor opened it is refused in words, and writes nothing', async () => {
  const stored = read<{ resume: string; analysis: string }>('SELECT resume, analysis FROM jobs WHERE id = 1')[0];
  const versions = read('SELECT n FROM resume_versions WHERE job_id = 1').length;
  const r = await call('PATCH', '/jobs/1', { resume: `${stored.resume}\n- Mine.`, base: `${stored.resume}\n- What the editor opened.` });
  expect(r.status).toBe(409);
  expect(JSON.parse(r.text)).toEqual({ error: 'This resume changed while you were editing. Your text is still here: look at the new version, then save again.' });
  expect(read('SELECT resume, analysis FROM jobs WHERE id = 1')[0]).toEqual(stored);
  expect(read('SELECT n FROM resume_versions WHERE job_id = 1').length).toBe(versions);
  // With the text it opened as its base, the same save is written.
  expect((await call('PATCH', '/jobs/1', { resume: `${stored.resume}\n- Mine.`, base: stored.resume })).status).toBe(200);
  expect(read<{ resume: string }>('SELECT resume FROM jobs WHERE id = 1')[0].resume).toBe(`${stored.resume}\n- Mine.`);
});
