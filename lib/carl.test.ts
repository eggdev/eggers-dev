// `bun test lib`: CARL in the code that reads a resume (RESUME-RULES.md, rules 13 and 14). A bullet's opening context
// clause is no duty and no verb: the action verb after it is scored and tense-checked, and a clause past ten words is
// flagged. Each entry's Technologies line is written by code from the skills list: only the skills of that employer's
// facts, none marked not confident, the posting's first, at most ten, and none for an entry whose facts name none. Every
// reader takes the line as a plain line of its entry: no bullet, no line to measure, cite or score. On a scratch
// database; the person, the employers and the numbers are invented.
import { beforeEach, expect, test } from 'bun:test';
import { db, fact, seed } from './scratch.ts';
import { actionVerb, bullets, contextClause, wrongTense } from './ats.ts';
import { codeFlags } from './checks.ts';
import { parseResume } from './resume.ts';
import { resumeHtml } from './pdf.ts';
import { check } from './rules.ts';
import { places } from './links.ts';
import { markSkills, syncSkills, withSkillLines, withTechnologies } from './skills.ts';
import type { RoleRow } from './db.ts';
import type { Links } from './links.ts';

beforeEach(() => { seed(); syncSkills(1); });
const roles = () => db.query('SELECT * FROM roles').all() as RoleRow[];
const POSTING = 'Staff Engineer. You will build Go services on Kafka with PostgreSQL.';
const RESUME = '# Avery Lindqvist\nline\n\n## Summary\nEngineer.\n\n## Experience\n### Director of Engineering, Harborlight Systems\nMar 2021 – Present\n- Build the dispatch console for 640 users.\n- Cut the nightly billing run.\n\n### Senior Engineer, Quillfeather Labs\nJan 2016 – Feb 2021\n- Rebuilt the quoting API.\n\n### Support Lead, Tessellate Freight\nMay 2010 – Aug 2012\n- Led the support desk.\n\n## Skills\nGo\n';
const entry = (md: string, company: string) => parseResume(md).experience.find((e) => e.company === company)!;

// ---------- The context clause ----------

const past = (b: string) => `## Experience\n### Senior Engineer, Quillfeather Labs\nJan 2016 – Feb 2021\n- ${b}\n`;
const now = (b: string) => `## Experience\n### Director of Engineering, Harborlight Systems\nMar 2021 – Present\n- ${b}\n`;

test('a context clause ends at the first comma and a space, and only after a context word', () => {
  expect(contextClause('Facing a 20% order backlog across 3 warehouses, redesigned picking.')).toBe('Facing a 20% order backlog across 3 warehouses');
  expect(contextClause('Facing 4,000 open tickets, cut the queue by half.')).toBe('Facing 4,000 open tickets');
  expect(contextClause('With a team of 6, rebuilt the quoting API.')).toBe('With a team of 6');
  expect(contextClause('Rebuilt the quoting API, cutting latency.')).toBe('');
  expect(contextClause('Facing a backlog with no comma at all.')).toBe('');
});

test('the verb after a context clause is scored and tense-checked; the clause is no duty', () => {
  // Right tense after the clause: no flag, and the verb scores as an action.
  expect(bullets(past('Facing a 20% order backlog, redesigned picking workflows, cutting fulfillment times by 18%.')).flags).toEqual([]);
  expect(bullets(now('With a team of 6, build the dispatch console for 640 users.')).flags).toEqual([]);
  // The wrong tense after the clause is flagged, on the verb that follows it.
  expect(bullets(past('Facing a 20% order backlog, build new picking workflows.')).flags.map((f) => f.why)).toEqual(['It opens in the present tense, and this role has ended.']);
  expect(wrongTense(now('During the move, rebuilt the quoting API.')).length).toBe(1);
  // A clause is not a duty; a duty after a clause still is.
  expect(bullets(past('Under a hiring freeze, led the support desk.')).flags).toEqual([]);
  expect(bullets(past('Under a hiring freeze, responsible for the support desk.')).flags.map((f) => f.why)).toEqual(['It opens as a duty, not as something done.']);
  // The same score with and without a short clause: the clause costs nothing.
  expect(bullets(past('After the merger, rebuilt the quoting API in Go.'), ['Go']).score).toBe(bullets(past('Rebuilt the quoting API in Go.'), ['Go']).score);
});

test('a context clause past ten words is flagged; ten words is not', () => {
  const ten = 'Facing a backlog of orders across three warehouses in two states';
  expect(ten.split(' ').length).toBe(11);
  expect(bullets(past(`${ten}, redesigned picking workflows.`)).flags.map((f) => f.why)).toEqual(['Its opening context runs to 11 words, more than 10.']);
  expect(bullets(past('Facing a backlog of orders across three warehouses in two, redesigned picking workflows.')).flags).toEqual([]);
});

test('three bullets in a row on one action verb are caught after their context clauses', () => {
  const md = `## Experience\n### Senior Engineer, Quillfeather Labs\nJan 2016 – Feb 2021\n- With Go, rebuilt the quoting API.\n- Rebuilt the billing run.\n- After the merger, rebuilt the rota.\n`;
  expect(bullets(md).flags.map((f) => f.why)).toEqual(['It is the third bullet in a row to open with “rebuilt”.']);
});

// ---------- The Technologies line ----------

test('each entry gets one Technologies line under its bullets, from its own facts, the posting’s terms first', () => {
  const out = withTechnologies(RESUME, POSTING, roles());
  expect(entry(out, 'Harborlight Systems').technologies).toEqual(['Go', 'PostgreSQL', 'TypeScript']);
  expect(entry(out, 'Quillfeather Labs').technologies).toEqual(['Go', 'Kafka']);
  // The support desk's fact names no skill: no line.
  expect(entry(out, 'Tessellate Freight').technologies).toEqual([]);
  expect(out).toContain('- Cut the nightly billing run.\n\nTechnologies: Go, PostgreSQL, TypeScript\n\n### Senior Engineer');
  // Not bullets, and a second pass changes nothing.
  expect(entry(out, 'Harborlight Systems').bullets).toEqual(entry(RESUME, 'Harborlight Systems').bullets);
  expect(withTechnologies(out, POSTING, roles())).toBe(out);
});

test('a model’s Technologies line, anywhere in its entry and with a bullet mark, is replaced by code’s', () => {
  const written = RESUME.replace('- Rebuilt the quoting API.\n', 'Technologies: Python, Kubernetes\n- Rebuilt the quoting API.\n- Technologies: Rust\n');
  expect(withTechnologies(written, POSTING, roles())).toBe(withTechnologies(RESUME, POSTING, roles()));
});

test('a skill marked not confident is left out, and only confident skills appear once the list is reviewed', () => {
  markSkills([{ name: 'Kafka', mark: 'not-confident' }], false, 2);
  expect(entry(withTechnologies(RESUME, POSTING, roles()), 'Quillfeather Labs').technologies).toEqual(['Go']);
  markSkills([{ name: 'TypeScript', mark: 'confident' }], true, 3);
  const out = withTechnologies(RESUME, POSTING, roles());
  expect(entry(out, 'Harborlight Systems').technologies).toEqual(['TypeScript']);
  expect(entry(out, 'Quillfeather Labs').technologies).toEqual([]);
});

test('a line holds at most ten items, and facts filed in a project of the role count', () => {
  const names = Array.from({ length: 12 }, (_, i) => `Tool${String.fromCharCode(65 + i)}`);
  const id = fact(2, 'Built the rating engine.', '', names.join(', '));
  const p = (db.query("INSERT INTO projects (role_id, title, created_at) VALUES (2, 'Rating', 1) RETURNING id").get() as { id: number }).id;
  db.query('UPDATE facts SET project_id = ? WHERE id = ?').run(p, id);
  syncSkills(2);
  const items = entry(withTechnologies(RESUME, POSTING, roles()), 'Quillfeather Labs').technologies;
  expect(items.length).toBe(10);
  expect(items.slice(0, 2)).toEqual(['Go', 'Kafka']);
});

test('with EGG_CARL=off no Technologies line is written', () => {
  const was = process.env.EGG_CARL;
  process.env.EGG_CARL = 'off';
  try { expect(withSkillLines(RESUME, POSTING, 2)).not.toContain('Technologies:'); } finally { if (was === undefined) delete process.env.EGG_CARL; else process.env.EGG_CARL = was; }
  expect(withSkillLines(RESUME, POSTING, 2)).toContain('Technologies:');
});

test('every reader takes the Technologies line as a plain line of its entry', () => {
  const md = withTechnologies(RESUME, POSTING, roles());
  // The PDF: one plain paragraph under the bullets, not a list item and not a dates line.
  expect(resumeHtml(md)).toContain('</ul>\n<p>Technologies: Go, PostgreSQL, TypeScript</p>');
  // The links: it is no place a line cites from.
  expect(places(md).places.some((p) => p.text.startsWith('Technologies'))).toBe(false);
  // The score: not a bullet.
  expect(bullets(md).count).toBe(bullets(RESUME).count);
  // The rules: not measured for length or for a stack of tools, and not a role entry's prose.
  const long = md.replace('Technologies: Go, Kafka', `Technologies: ${Array.from({ length: 40 }, (_, i) => `Tool${i}`).join(', ')}`);
  const c = check('resume', long, { technologies: ['Go', 'Kafka', 'PostgreSQL', 'TypeScript', ...Array.from({ length: 40 }, (_, i) => `Tool${i}`)] });
  for (const rule of ['line-length', 'technologies-per-line']) expect([rule, c.exact.find((r) => r.rule === rule)?.state]).toEqual([rule, 'pass']);
});

test('the resume screen shows the Technologies line as a plain line, also with a bullet’s mark', async () => {
  const { resumeView } = await import('./resumeview.ts');
  const md = withTechnologies(RESUME, POSTING, roles()).replace('Technologies: Go, Kafka', '- Technologies: Go, Kafka');
  const id = (db.query("INSERT INTO jobs (posting, title, company, status, analysis, resume, created_at, edited, outcome) VALUES (?, 'Engineer', 'Nimbus Yard', 'done', '{}', ?, 1, 1, '') RETURNING id").get(POSTING, md) as { id: number }).id;
  const rows = resumeView(id)!.rows.filter((r) => r.text.startsWith('Technologies:'));
  expect(rows.map((r) => [r.kind, r.text])).toEqual([['plain', 'Technologies: Go, PostgreSQL, TypeScript'], ['plain', 'Technologies: Go, Kafka']]);
});

// ---------- Review fixes ----------

const off = <T>(f: () => T): T => { process.env.EGG_CARL = 'off'; try { return f(); } finally { delete process.env.EGG_CARL; } };

test('a list of names before the clause’s comma, a verb in the clause, and no comma at all are read without a guess', () => {
  expect(contextClause('With Go, Kafka and Redis, built the quoting queue.')).toBe('With Go, Kafka and Redis');
  expect(actionVerb('With Go, Kafka and Redis, built the quoting queue.')).toBe('built');
  expect(bullets(past('With Go, Kafka and Redis, built the quoting queue.')).flags).toEqual([]);
  expect(contextClause('Built, tested and shipped the console.')).toBe('');
  expect(actionVerb('Built, tested and shipped the console.')).toBe('built');
  expect(actionVerb('In 2023 led the support desk.')).toBe('led');
  expect(bullets(past('In 2023 led the support desk.')).flags).toEqual([]);
  // A verb inside what would be the clause: it is the action, and the clause ends before it.
  expect(actionVerb('For 12 hospitals built a scheduler, cutting waits by 20%.')).toBe('built');
  expect(contextClause('For 12 hospitals built a scheduler, cutting waits by 20%.')).toBe('For 12 hospitals');
  // A comma that no verb follows ends no clause: read as before, with nothing flagged falsely.
  expect(contextClause('With a team of 6, the console went live.')).toBe('');
});

test('the length fix names the words for the resume’s pages', () => {
  const long = past(`Rebuilt ${Array.from({ length: 36 }, (_, i) => `word${i}`).join(' ')}.`);
  const fix = (pages?: number) => bullets(long, [], pages).flags.find((f) => /words, past what a skim/.test(f.why))!.fix;
  expect([fix(1), fix(2), fix()]).toEqual(['Cut it to at most 30 words, or split it if it says two things.', 'Cut it to at most 34 words, or split it if it says two things.', 'Cut it to at most 30 words on one page, or 34 on two, or split it if it says two things.']);
});

test('with EGG_CARL=off the code reads a resume as before CARL', () => {
  const ten = 'Facing a backlog of orders across three warehouses in two states, redesigned picking workflows.';
  off(() => {
    expect(contextClause('Facing a 20% order backlog, redesigned picking.')).toBe('');
    expect(bullets(past(ten)).flags.some((f) => /opening context/.test(f.why))).toBe(false);
    const long = past(`Rebuilt ${Array.from({ length: 36 }, (_, i) => `word${i}`).join(' ')}.`);
    expect(bullets(long, [], 2).flags.find((f) => /past what a skim/.test(f.why))!.fix).toBe('Cut it to under 30 words, or split it if it says two things.');
    // The checklist counts a bullet's first word as its opener.
    const alike = check('resume', past('With Go, rebuilt the quoting API.')).checklist.find((c) => c.rule === 'bullets-alike');
    expect(alike && alike.state === 'measured' ? alike.roles[0].opener.word : '').toBe('with');
    // A Technologies line an earlier pass wrote is taken out of a resume a model wrote.
    const written = withTechnologies(RESUME, POSTING, roles(), true);
    expect(written).toContain('Technologies:');
    expect(withSkillLines(written, POSTING, 2)).toBe(withSkillLines(RESUME, POSTING, 2));
    expect(withSkillLines(written, POSTING, 2)).not.toContain('Technologies:');
  });
  const alike = check('resume', past('With Go, rebuilt the quoting API.')).checklist.find((c) => c.rule === 'bullets-alike');
  expect(alike && alike.state === 'measured' ? alike.roles[0].opener.word : '').toBe('rebuilt');
});

test('the PDF prints a Technologies line written as a bullet as the plain line, as every other reader takes it', () => {
  const html = resumeHtml(RESUME.replace('- Rebuilt the quoting API.\n', '- Rebuilt the quoting API.\n- Technologies: Go, Kafka\n'));
  expect(html).toContain('</ul>\n<p>Technologies: Go, Kafka</p>');
  expect(html).not.toContain('<li>Technologies');
});

test('a Technologies line that names a skill no fact of its job names, or one not confident, is flagged', () => {
  markSkills([{ name: 'Kafka', mark: 'not-confident' }], false, 2);
  // An edit of the owner's: Rust is named by no fact; Kafka is marked not confident; Go is fine.
  const md = withTechnologies(RESUME, POSTING, roles()).replace('Technologies: Go\n', 'Technologies: Go, Kafka, Rust\n');
  const f = codeFlags(md, 2, Date.now(), undefined, null, true).filter((x) => x.kind === 'technologies-other');
  expect(f.map((x) => [x.items, x.at?.[0]?.where])).toEqual([[['Kafka', 'Rust'], 'role']]);
  expect(codeFlags(withTechnologies(RESUME, POSTING, roles()), 2).filter((x) => x.kind === 'technologies-other')).toEqual([]);
});

test('with links: a context clause in words its cited facts and their project do not hold, and a Learning on another project’s bullet, are flagged', () => {
  const id = (text: string) => (db.query('SELECT id FROM facts WHERE text = ?').get(text) as { id: number }).id;
  const quoting = id('Rebuilt the quoting API.'), consoleFact = id('Built the dispatch console that schedulers use every day.');
  const p = (role: number, title: string, context: string, learning: string, fact: number) => {
    const pid = (db.query('INSERT INTO projects (role_id, title, context, learning, created_at) VALUES (?, ?, ?, ?, 1) RETURNING id').get(role, title, context, learning) as { id: number }).id;
    db.query('UPDATE facts SET project_id = ? WHERE id = ?').run(pid, fact);
  };
  p(2, 'Quoting', 'Quotes went out by fax.', '', quoting);
  p(1, 'Console', '', 'I learned to ship in small steps every week.', consoleFact);
  const md = (q: string, h: string) => RESUME.replace('- Rebuilt the quoting API.', `- ${q}`).replace('- Build the dispatch console for 640 users.', `- ${h}`);
  const links = (q: string, h: string): Links => ({ v: 1, lines: [{ where: 'bullet', entry: 'quillfeather labs', text: q, facts: [quoting], edited: 0 }, { where: 'bullet', entry: 'harborlight systems', text: h, facts: [consoleFact], edited: 0 }] });
  const carl = (q: string, h: string) => codeFlags(md(q, h), 2, Date.now(), undefined, links(q, h)).filter((f) => ['context-words', 'learning-elsewhere'].includes(f.kind)).map((f) => [f.kind, f.items ?? null, f.at?.[0]?.text]);
  // In the words of the project's context: quiet. In words of its own: flagged, word by word.
  expect(carl('With quotes by fax, rebuilt the quoting API.', 'Build the dispatch console for 640 users.')).toEqual([]);
  expect(carl('Facing a merger with Globex, rebuilt the quoting API.', 'Build the dispatch console for 640 users.')).toEqual([['context-words', ['merger', 'globex'], 'Facing a merger with Globex, rebuilt the quoting API.']]);
  // The console's Learning on the console's bullet: quiet. On the quoting API's bullet: flagged.
  expect(carl('Rebuilt the quoting API.', 'Build the dispatch console for 640 users, shipping in small steps every week.')).toEqual([]);
  expect(carl('Rebuilt the quoting API, shipping in small steps every week.', 'Build the dispatch console for 640 users.')).toEqual([['learning-elsewhere', null, 'Rebuilt the quoting API, shipping in small steps every week.']]);
  // Not with EGG_CARL=off, and not on the owner's own edit.
  const q = 'Facing a merger with Globex, rebuilt the quoting API.', h = 'Build the dispatch console for 640 users.';
  expect(off(() => codeFlags(md(q, h), 2, Date.now(), undefined, links(q, h)).filter((f) => f.kind === 'context-words'))).toEqual([]);
  expect(codeFlags(md(q, h), 2, Date.now(), undefined, links(q, h), true).filter((f) => f.kind === 'context-words')).toEqual([]);
});
