// `bun test lib`: the agenda (lib/agenda.ts): what the saved postings say to ask next. A term counts only when two or
// more unsent jobs ask for it and have nothing for it; it matches as a whole word; at most three are open; answered ones
// stay closed; and one project the last resumes lean on is asked about with numbers counted from the stored links. On a
// scratch database; every person, employer and posting is invented.
import { beforeEach, expect, test } from 'bun:test';
import { db, fact, seed } from './scratch.ts';
import { agendaFindings, agendaInput, hasTerm, leanFinding, MIN_RESUMES, syncAgenda, TERMS_OPEN, termFindings, unmetIn, type AgendaJob } from './agenda.ts';
import { openRaised, settle } from './raised.ts';

const now = 1_800_000_000_000;
beforeEach(() => seed());

// An unsent job whose reading found nothing for these requirements, with these posting terms as first read.
const reading = (reqs: { text: string; need?: string; coverage?: string }[]) =>
  JSON.stringify({ verdict: '', requirements: reqs.map((r) => ({ need: 'must', coverage: 'none', evidence: '', ...r })), strengths: [], risks: [], changes: [], gaps: [] });
const job = (terms: string[], reqs: { text: string; need?: string; coverage?: string }[], outcome = '') =>
  (db.query("INSERT INTO jobs (posting, title, company, status, analysis, terms_raw, created_at, outcome) VALUES ('A posting.', 'Engineer', 'Initech', 'done', ?, ?, 1, ?) RETURNING id")
    .get(reading(reqs), JSON.stringify(terms), outcome) as { id: number }).id;
const open = () => openRaised().filter((q) => q.kind === 'agenda');

test('a term one posting asks for raises nothing; two postings raise one question that counts them', () => {
  const a = job(['Kubernetes', 'Go'], [{ text: 'Runs Kubernetes clusters in production' }]);
  syncAgenda(now);
  expect(open()).toEqual([]);
  const b = job(['kubernetes'], [{ text: 'Experience with kubernetes', need: 'implied' }]);
  syncAgenda(now + 1);
  expect(open().map((q) => ({ key: q.key, text: q.text, data: q.data }))).toEqual([{ key: 'agenda:term:kubernetes',
    text: '2 postings you saved ask for Kubernetes, and your record has no story that shows it. Tell one time you worked with it, or say you have not.',
    data: { kind: 'term', term: 'Kubernetes', jobs: [a, b], count: 2 } }]);
  // A third posting changes the count in the words of the open question.
  job(['Kubernetes'], [{ text: 'Kubernetes' }]);
  syncAgenda(now + 2);
  expect(open()[0].text.startsWith('3 postings you saved ask for Kubernetes')).toBe(true);
});

test('only must and implied requirements with nothing for them count, and only in jobs not yet sent', () => {
  job(['Rust'], [{ text: 'Rust services', need: 'nice' }]);
  job(['Rust'], [{ text: 'Rust services', coverage: 'partial' }]);
  job(['Rust'], [{ text: 'Rust services' }], 'applied');
  job(['Rust'], [{ text: 'Rust services' }]);
  syncAgenda(now);
  expect(open()).toEqual([]);
});

test('a term matches as a whole word only', () => {
  expect(hasTerm('Experience with Go services', 'Go')).toBe(true);
  expect(hasTerm('Experience with Google Cloud', 'Go')).toBe(false);
  expect(hasTerm('Modern C++ and C#', 'C++')).toBe(true);
  expect(hasTerm('Modern C++ and C#', 'C#')).toBe(true);
  expect(hasTerm('Node.js backends', 'Node.js')).toBe(true);
  expect(hasTerm('Kubernetesish things', 'Kubernetes')).toBe(false);
  const jobs: AgendaJob[] = [1, 2].map((id) => ({ id, analysis: reading([{ text: 'Google Cloud at scale' }]), termsRaw: JSON.stringify(['Go']) }));
  expect(termFindings(jobs, new Set())).toEqual([]);
});

test('at most three are open, the most postings first; an answered or skipped one stays closed and the next comes up', () => {
  const ask = (terms: string[], n: number) => { for (let i = 0; i < n; i++) job(terms, terms.map((t) => ({ text: `Hands-on ${t}` }))); };
  ask(['Terraform'], 4); ask(['Erlang'], 3); ask(['Elixir'], 2); ask(['Haskell'], 2);
  syncAgenda(now);
  expect(agendaFindings(agendaInput()).map((q) => q.key)).toEqual(['agenda:term:terraform', 'agenda:term:erlang', 'agenda:term:elixir']);
  expect(open().length).toBe(TERMS_OPEN);
  expect(settle('agenda:term:erlang', 'Skipped', now + 1)).toBe('');
  syncAgenda(now + 2);
  expect(open().map((q) => q.key).sort()).toEqual(['agenda:term:elixir', 'agenda:term:haskell', 'agenda:term:terraform']);
  // Found again, the skipped one is not asked again.
  syncAgenda(now + 3);
  expect(open().map((q) => q.key)).not.toContain('agenda:term:erlang');
  expect(db.query("SELECT answered_at FROM raised_questions WHERE key = 'agenda:term:erlang'").get()).toEqual({ answered_at: now + 1 });
});

test('a reading kept before the raw list of terms uses the lists of its reading', () => {
  for (let i = 0; i < 2; i++) {
    db.query("INSERT INTO jobs (posting, title, company, status, analysis, created_at, outcome) VALUES ('A posting.', 'Engineer', 'Initech', 'done', ?, 1, '')")
      .run(JSON.stringify({ requirements: [{ text: 'GraphQL APIs', need: 'must', coverage: 'none', evidence: '' }], terms: { inResume: [], inBankOnly: [], missing: ['GraphQL'] } }));
  }
  expect(agendaFindings(agendaInput()).map((f) => f.key)).toEqual(['agenda:term:graphql']);
});

test('a short term matches only in its own spelling, and never joined to another word by - & + # . or /', () => {
  const yes: [string, string][] = [['Experience with Go.', 'Go'], ['Go services in production', 'Go'], ['Modern C++ and C# code', 'C++'], ['Modern C++ and C# code', 'C#'],
    ['Experience with .NET', '.NET'], ['Run A/B testing at scale', 'A/B testing'], ['Swift and SwiftUI apps', 'Swift'], ['Statistics in R, daily', 'R'], ['Kubernetes on bare metal', 'kubernetes']];
  const no: [string, string][] = [['Own the go-to-market plan', 'Go'], ['Be the go-to person for incidents', 'Go'], ['Lead R&D teams', 'R'], ['Brief C-level stakeholders', 'C'],
    ['Ship Objective-C apps', 'C'], ['Value swift delivery of features', 'Swift'], ['Strong in Go/Rust', 'Go'], ['Build on ASP.NET Core', '.NET'], ['Experience with GO', 'Go'], ['Experience with Google Cloud', 'Go']];
  for (const [text, term] of yes) expect([text, term, hasTerm(text, term)]).toEqual([text, term, true]);
  for (const [text, term] of no) expect([text, term, hasTerm(text, term)]).toEqual([text, term, false]);
  // Two postings that ask for "go-to-market" and a "go-to person" raise nothing about Go.
  const reading1 = (text: string) => ({ id: 0, analysis: JSON.stringify({ requirements: [{ text, need: 'must', coverage: 'none', evidence: '' }] }), termsRaw: '["Go"]' });
  expect(termFindings([{ ...reading1('Partner with go-to-market teams'), id: 1 }, { ...reading1('Be the go-to person for incident response'), id: 2 }], new Set())).toEqual([]);
});

test('a term counts for a job only when the reading found nothing for it and the record does not name it', () => {
  const r = (reqs: { text: string; need?: string; coverage?: string }[], terms?: Record<string, string[]>) => ({ requirements: reqs.map((x) => ({ need: 'must', coverage: 'none', ...x })), ...(terms ? { terms } : {}) });
  expect(unmetIn(r([{ text: 'Terraform modules' }]), 'Terraform')).toBe(true);
  // Only in a nice-to-have, or not in the requirements at all.
  expect(unmetIn(r([{ text: 'Terraform modules', need: 'nice' }]), 'Terraform')).toBe(false);
  expect(unmetIn(r([{ text: 'Cloud modules' }]), 'Terraform')).toBe(false);
  // Another requirement of the same job that names it has some coverage.
  expect(unmetIn(r([{ text: 'Terraform modules', coverage: 'strong' }, { text: 'Ten years of Terraform' }]), 'Terraform')).toBe(false);
  expect(unmetIn(r([{ text: 'Terraform modules', coverage: 'partial' }, { text: 'Ten years of Terraform' }]), 'Terraform')).toBe(false);
  // The reading's own term lists: only a term among the missing counts.
  expect(unmetIn(r([{ text: 'Terraform modules' }], { inResume: [], inBankOnly: [], missing: ['terraform'] }), 'Terraform')).toBe(true);
  expect(unmetIn(r([{ text: 'Terraform modules' }], { inResume: ['Terraform'], inBankOnly: [], missing: [] }), 'Terraform')).toBe(false);
  expect(unmetIn(r([{ text: 'Terraform modules' }], { inResume: [], inBankOnly: ['Terraform'], missing: ['Terraform'] }), 'Terraform')).toBe(false);
  expect(unmetIn(r([{ text: 'Terraform modules' }], { inResume: [], inBankOnly: [], missing: [] }), 'Terraform')).toBe(false);
  // The record names it (the seed's facts list Go and Kafka among their skills): no question, whatever the readings say.
  for (let i = 0; i < 2; i++) job(['Go'], [{ text: 'Go services at a regulated bank' }]);
  for (let i = 0; i < 2; i++) job(['Kafka'], [{ text: 'Kafka pipelines' }]);
  syncAgenda(now);
  expect(open()).toEqual([]);
  // A term the record names only in a fact's story counts as named too.
  for (let i = 0; i < 2; i++) job(['Terraform'], [{ text: 'Terraform modules' }]);
  syncAgenda(now + 1);
  expect(open().map((q) => q.key)).toEqual(['agenda:term:terraform']);
  const f = fact(1, 'Moved the depots to new servers.');
  db.query("UPDATE facts SET detail = 'We wrote the Terraform for every depot.' WHERE id = ?").run(f);
  syncAgenda(now + 2);
  expect(open()).toEqual([]);
});

test('the reviewer’s case: the reading lists the term as in the resume, or covers it in another requirement: nothing is raised', () => {
  db.run('DELETE FROM facts');
  for (let i = 0; i < 2; i++) job(['Go'], [{ text: 'Go services at a regulated bank' }]);
  db.run(`UPDATE jobs SET analysis = json_set(analysis, '$.terms', json('{"inResume":["Go"],"inBankOnly":[],"missing":[]}'))`);
  syncAgenda(now);
  expect(open()).toEqual([]);
  db.run('DELETE FROM jobs');
  for (let i = 0; i < 2; i++) job(['Kafka'], [{ text: 'Kafka pipelines', coverage: 'strong' }, { text: 'Ten years of Kafka in a bank' }]);
  syncAgenda(now + 1);
  expect(open()).toEqual([]);
});

// ---------- One story the resumes lean on ----------

const bullets = (...facts: number[][]) => JSON.stringify({ v: 1, lines: [{ where: 'summary', entry: '', text: 'A summary.', facts: [1, 2, 3, 4], edited: 0 },
  ...facts.map((f, i) => ({ where: 'bullet', entry: 'harborlight systems', text: `Line ${i}.`, facts: f, edited: 0 }))] });
const resume = (links: string) => (db.query("INSERT INTO jobs (posting, title, company, status, analysis, resume, links, created_at, outcome) VALUES ('A posting.', 'Engineer', 'Initech', 'done', '', '# A resume', ?, 1, 'applied') RETURNING id").get(links) as { id: number }).id;

test('one project carrying half the linked bullets of three or more resumes raises one question, with counted numbers', () => {
  const p = (db.query("INSERT INTO projects (role_id, title, created_at) VALUES (1, 'Dispatch console', 1) RETURNING id").get() as { id: number }).id;
  const q = (db.query("INSERT INTO projects (role_id, title, created_at) VALUES (1, 'Billing run', 1) RETURNING id").get() as { id: number }).id;
  db.query('UPDATE facts SET project_id = ? WHERE id IN (1, 3)').run(p);
  db.query('UPDATE facts SET project_id = ? WHERE id = 2').run(q);
  // Two resumes only: not enough.
  const first = resume(bullets([1], [3], [2]));
  const second = resume(bullets([1], [4]));
  syncAgenda(now);
  expect(open()).toEqual([]);
  // A third: 5 of the 8 linked bullets name the console. A bullet naming a fact no longer in the record is not counted.
  const third = resume(bullets([1, 3], [5], [9999]));
  syncAgenda(now + 1);
  expect(open().map((x) => ({ key: x.key, text: x.text, data: x.data }))).toEqual([{ key: `agenda:lean:${p}`,
    text: 'Your last 3 resumes take 4 of their 7 linked lines from “Dispatch console”. What other work would you put beside it? Tell one piece.',
    data: { kind: 'lean', project: p, count: 4, total: 7, resumes: 3, jobs: [first, second, third] } }]);
  expect(MIN_RESUMES).toBe(3);
});

test('no project at half the linked bullets raises nothing, and only the last six resumes count', () => {
  const p = (db.query("INSERT INTO projects (role_id, title, created_at) VALUES (1, 'Dispatch console', 1) RETURNING id").get() as { id: number }).id;
  db.query('UPDATE facts SET project_id = ? WHERE id = 1').run(p);
  const projectOf = new Map([[1, p], [2, null], [3, null], [4, null]]), titles = new Map([[p, 'Dispatch console']]);
  const lean = (links: string[]) => leanFinding({ resumes: links.map((l, i) => ({ id: 100 - i, links: l })), projectOf, titles, answered: new Set() });
  expect(lean([bullets([1], [2], [3]), bullets([1], [2], [3]), bullets([1], [2], [3])])).toEqual([]);
  // Three old resumes all on the console, behind six newer ones that never name it: only the six newest are read.
  expect(lean([...Array(6).fill(bullets([2])), ...Array(3).fill(bullets([1]))])).toEqual([]);
  expect(lean([bullets([1]), bullets([1], [2]), bullets([1]), ''])[0].text).toBe('Your last 3 resumes take 3 of their 4 linked lines from “Dispatch console”. What other work would you put beside it? Tell one piece.');
});
