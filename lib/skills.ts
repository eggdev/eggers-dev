// Rule 7, the skills list: one row for each skill the bank's facts name, with what kind of thing it is and
// whether the person would defend it in an interview. A resume's Skills section is written here, by code,
// from this list alone, so nothing can reach it that is not a real tool, language or platform the person stands behind.
//
// - kind: tool | language | platform | other. Only the first three go on a resume. It is guessed here by
//   rule (known names, then the words of the name, then how it is written) and the person can correct it.
// - mark: confident | not-confident | '' (not yet marked). A skill marked not confident never appears.
// - Until the person has reviewed the list once, skills not yet marked may appear, and each resume says its
//   skills are not confirmed. After that review only skills marked confident appear, and a skill the bank
//   gains later raises a question (lib/raised.ts). Marking a few skills is not a review: the person says
//   when the list is reviewed, and it must then hold at least one skill they are confident in.
import { db, type RoleRow } from './db.ts';
import { employers, groupOf } from './entries.ts';
import { onAnswer, raise, type Raised } from './raised.ts';
import { lf, parseResume } from './resume.ts';
import { carlOn } from './carl.ts';

db.run(`CREATE TABLE IF NOT EXISTS skills (
  key TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'tool', mark TEXT NOT NULL DEFAULT '',
  facts INTEGER NOT NULL DEFAULT 0, in_bank INTEGER NOT NULL DEFAULT 1, kind_set INTEGER NOT NULL DEFAULT 0, added_at INTEGER NOT NULL)`);
db.run('CREATE TABLE IF NOT EXISTS skills_review (id INTEGER PRIMARY KEY CHECK (id = 1), reviewed_at INTEGER NOT NULL DEFAULT 0)');
db.run('INSERT OR IGNORE INTO skills_review (id) VALUES (1)');
// When a mark or a review last changed what a reviewed list puts on a resume (marked_at), and up to which such change the
// worker has written the Skills lines of unsent resumes again (done_at): lib/jobs.ts, skillsChanged and refreshDueSkills.
// Kept here, not in memory, so a worker that was stopped does the work when it next runs.
db.run('CREATE TABLE IF NOT EXISTS skills_due (id INTEGER PRIMARY KEY CHECK (id = 1), marked_at INTEGER NOT NULL DEFAULT 0, done_at INTEGER NOT NULL DEFAULT 0)');
db.run('INSERT OR IGNORE INTO skills_due (id) VALUES (1)');
// A job whose Skills line could not be written: how many tries for which change (marked_at), when it was last tried
// (last_at), whether its empty PDF was already printed once for that change (printed), and the note on it once left out.
// Its row goes with the job.
db.run("CREATE TABLE IF NOT EXISTS skills_due_jobs (job_id INTEGER PRIMARY KEY, tries INTEGER NOT NULL DEFAULT 0, marked_at INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '', last_at INTEGER NOT NULL DEFAULT 0, printed INTEGER NOT NULL DEFAULT 0)");
for (const column of ['last_at INTEGER NOT NULL DEFAULT 0', 'printed INTEGER NOT NULL DEFAULT 0']) { try { db.run(`ALTER TABLE skills_due_jobs ADD COLUMN ${column}`); } catch { /* already there */ } }
db.run('CREATE TRIGGER IF NOT EXISTS skills_due_jobs_gone AFTER DELETE ON jobs BEGIN DELETE FROM skills_due_jobs WHERE job_id = OLD.id; END');

export const KINDS = ['tool', 'language', 'platform', 'other'] as const;
export const MARKS = ['confident', 'not-confident', ''] as const;
export type Skill = { key: string; name: string; kind: string; mark: string; facts: number; in_bank: number; kind_set: number; added_at: number };
// The most a Skills section holds: 25 on two pages (the rule's cap), 14 on one page (what one line takes).
export const CAP = 25;
export const capFor = (pages: number) => (pages === 1 ? 14 : CAP);

const LANGUAGES = new Set(['python', 'javascript', 'typescript', 'go', 'golang', 'rust', 'java', 'kotlin', 'swift', 'c', 'c++', 'c#', 'ruby', 'php', 'sql', 'html', 'css', 'bash', 'shell', 'scala', 'r', 'elixir', 'erlang', 'dart', 'lua', 'perl', 'objective-c', 'haskell', 'clojure', 'solidity', 'matlab', 'powershell', 'zig', 'sass', 'scss', 'hcl', 'graphql', 'pl/sql', 't-sql', 'vba', 'groovy', 'f#', 'ocaml', 'julia', 'cobol', 'fortran', 'assembly', 'visual basic', 'apex']);
const PLATFORMS = new Set(['aws', 'amazon web services', 'gcp', 'google cloud', 'google cloud platform', 'azure', 'microsoft azure', 'cloudflare', 'cloudflare workers', 'vercel', 'netlify', 'heroku', 'fly.io', 'render', 'digitalocean', 'kubernetes', 'linux', 'macos', 'ios', 'android', 'windows', 'salesforce', 'shopify', 'stripe', 'twilio', 'firebase', 'supabase', 'snowflake', 'databricks', 'github', 'gitlab', 'bitbucket', 'openai', 'anthropic', 'slack', 'hubspot', 'netsuite', 'wordpress', 'sharepoint', 'servicenow', 'workday', 'sap', 'oracle cloud', 'microsoft 365', 'google workspace', 'tailscale', 'expo', 'app store', 'google play']);
// Tools whose names are written in lower case, or often are. Matched in lower case.
const TOOLS = new Set(['git', 'npm', 'pnpm', 'yarn', 'bun', 'deno', 'node', 'node.js', 'nginx', 'apache', 'jq', 'curl', 'vim', 'neovim', 'emacs', 'make', 'cmake', 'gradle', 'maven', 'webpack', 'vite', 'rollup', 'esbuild', 'babel', 'eslint', 'prettier',
  'jest', 'vitest', 'mocha', 'pytest', 'junit', 'cypress', 'playwright', 'selenium', 'terraform', 'ansible', 'pulumi', 'helm', 'docker', 'podman', 'redis', 'postgres', 'postgresql', 'mysql', 'mariadb', 'sqlite', 'mongodb', 'dynamodb',
  'elasticsearch', 'kafka', 'rabbitmq', 'grpc', 'graphql', 'prometheus', 'grafana', 'datadog', 'sentry', 'jenkins', 'circleci', 'github actions', 'jira', 'figma', 'postman', 'react', 'vue', 'svelte', 'angular', 'next.js', 'express', 'fastapi', 'django',
  'flask', 'rails', 'spring', 'laravel', 'pandas', 'numpy', 'pytorch', 'tensorflow', 'spark', 'airflow', 'dbt', 'tailwind', 'htmx', 'wrangler', 'zod', 'prisma', 'sqlalchemy', 'celery', 'tmux', 'ffmpeg', 'unpdf']);
// Whole skills that are a method or an idea, however they are written. Matched in lower case.
const CONCEPTS = new Set(['ci/cd', 'ci', 'cd', 'rest', 'restful', 'api', 'apis', 'rest api', 'rest apis', 'etl', 'elt', 'rag', 'tdd', 'bdd', 'ddd', 'oop', 'saas', 'paas', 'iaas', 'llm', 'llms', 'ai', 'ml', 'nlp', 'mvc', 'mvp', 'sso', 'oauth', 'seo', 'ux', 'ui', 'ui/ux', 'devops', 'sre', 'qa', 'crud', 'microservices', 'serverless', 'websockets', 'b2b', 'b2c', 'sdlc', 'okrs', 'kpis', 'agile', 'scrum', 'kanban']);
// Words that practices, methods and soft skills are made of. A skill is one of those when every word of it is here
// ("Team Management", "Machine Learning", "code review"). A product name that only holds such a word is not
// ("React Testing Library", "AWS Systems Manager", "Spring Security"): its other words are names.
const SOFT = new Set(('management leadership communication mentoring coaching training planning strategy process processes collaboration stakeholder stakeholders architecture design review reviews testing debugging documentation hiring interviewing analysis reliability scalability security performance optimization optimisation migration migrations integration integrations automation development engineering operations support teaching writing research modeling modelling monitoring observability deployment delivery enterprise teamwork roadmap roadmaps budgeting negotiation presentation presentations services pipelines pipeline systems system learning patterns pattern principles methodology methodologies practices '
  + 'team teams project projects product public speaking people time change risk vendor client customer business technical software data machine deep cross functional strategic critical thinking problem solving code unit pair programming continuous improvement quality incident response release program agile lean user experience and of the in for').split(' '));

// What kind of thing a skill is, from its name alone, in this order:
// a known language, platform or tool; a known method or idea ("other"); a name made only of the words practices are
// made of ("other"); then a name written as a product name is (a capital, a digit, a dot: "PostgreSQL", "Next.js",
// "S3") is a tool, and one that reads as plain lower-case words is "other". The person can correct any of these.
export function kindOf(name: string): string {
  const low = name.trim().toLowerCase();
  if (LANGUAGES.has(low)) return 'language';
  if (PLATFORMS.has(low)) return 'platform';
  if (TOOLS.has(low)) return 'tool';
  if (CONCEPTS.has(low)) return 'other';
  const words = low.split(/[^a-z0-9+#.]+/).filter(Boolean);
  if (words.length > 0 && words.every((w) => SOFT.has(w))) return 'other';
  return /[A-Z0-9.+#]/.test(name.trim()) ? 'tool' : 'other';
}

const reviewedAt = () => (db.query('SELECT reviewed_at FROM skills_review WHERE id = 1').get() as { reviewed_at: number }).reviewed_at;
export const reviewed = () => reviewedAt() > 0;
export const reviewedOn = reviewedAt; // when the person last reviewed the list (ms), 0 before the first review
export const allSkills = () => db.query('SELECT * FROM skills WHERE in_bank = 1 ORDER BY facts DESC, name COLLATE NOCASE').all() as Skill[];

// Brings the list in step with the bank: a skill a fact names is added (not yet marked), one no fact names any
// more is kept with its mark but set aside, and each skill's count of facts is taken again. After the first
// review, each skill the bank gained since and that is still not marked is asked about.
export function syncSkills(now: number): void {
  const seen = new Map<string, { name: string; n: number; spellings: Map<string, number> }>();
  for (const f of db.query('SELECT skills FROM facts ORDER BY id').all() as { skills: string }[]) {
    for (const raw of f.skills.split(',').map((x) => x.trim()).filter(Boolean)) {
      const s = seen.get(raw.toLowerCase()) ?? { name: raw, n: 0, spellings: new Map() };
      s.n++; s.spellings.set(raw, (s.spellings.get(raw) ?? 0) + 1);
      seen.set(raw.toLowerCase(), s);
    }
  }
  // Only what differs is written, so a sync that finds the list as it is writes nothing (it runs each time Home or the
  // questions are read, and every write looks like a change to the backup). What is stored is the same as before.
  const stored = new Map((db.query('SELECT key, name, facts, in_bank FROM skills').all() as { key: string; name: string; facts: number; in_bank: number }[]).map((r) => [r.key, r]));
  const writes: (() => void)[] = [];
  for (const [key, s] of seen) {
    // The spelling most facts use is the one shown.
    const name = [...s.spellings].sort((a, b) => b[1] - a[1])[0][0], row = stored.get(key);
    // Two processes can list the same new skill at once: the second one's insert takes the row the first made.
    if (!row) writes.push(() => db.query('INSERT INTO skills (key, name, kind, added_at, facts, in_bank) VALUES (?, ?, ?, ?, ?, 1) ON CONFLICT (key) DO UPDATE SET name = excluded.name, facts = excluded.facts, in_bank = 1').run(key, name, kindOf(name), now, s.n));
    else if (row.name !== name || row.facts !== s.n || row.in_bank !== 1) writes.push(() => db.query('UPDATE skills SET name = ?, facts = ?, in_bank = 1 WHERE key = ?').run(name, s.n, key));
  }
  // A skill no fact names any more is kept with its mark, set aside.
  for (const row of stored.values()) if (!seen.has(row.key) && (row.facts !== 0 || row.in_bank !== 0)) writes.push(() => db.query('UPDATE skills SET in_bank = 0, facts = 0 WHERE key = ?').run(row.key));
  // The rows are read before the lock, so two processes can both find a skill new and both try to add it. The write
  // takes the lock first (immediate), so they write one after the other, and the second one's insert becomes an update
  // of the row the first made (the upsert above): that makes the early read harmless.
  if (writes.length > 0) db.transaction(() => { for (const w of writes) w(); }).immediate();
  const since = reviewedAt();
  raise('skill', since === 0 ? [] : allSkills().filter((s) => s.mark === '' && s.kind !== 'other' && s.added_at > since).map((s) => ({ key: `skill:${s.key}`, about: `skill:${s.key}`, data: { skill: s.key },
    text: `Your record now names ${s.name} as a skill. Could you defend it in an interview? It stays off your resumes until you say.`, choices: ['Yes, I am confident in it', 'No, leave it off my resumes'] })), now);
}
onAnswer('skill', (q: Raised, choice: number) => { db.query('UPDATE skills SET mark = ? WHERE key = ?').run(choice === 0 ? 'confident' : 'not-confident', String(q.data.skill ?? '')); return ''; });

export const NONE_CONFIDENT = 'Mark at least one tool, language or platform as one you are confident in before you confirm the list. Nothing was saved.';
// The person's marks for many skills at once, and, only when `review` is true, that they have now reviewed the list.
// Once the list is reviewed, only skills marked confident go on a resume. So a review is refused, and so is any
// change after one, that would leave no skill to show: a resume would then lose its whole Skills section.
// Returns how many marks were set, or `refused` with the reason, in which case nothing was saved.
// `changed` counts the marks and the kinds that changed.
export function markSkills(marks: { name: string; mark?: string; kind?: string }[], review: boolean, now: number): { marked: number; changed: number; refused?: string } {
  let marked = 0, kinds = 0;
  try {
    db.transaction(() => {
      for (const m of marks) {
        const key = String(m.name ?? '').trim().toLowerCase();
        if (key === '') continue;
        // A mark it already has writes nothing (the Skills screen sends one tap at a time).
        if (typeof m.mark === 'string' && (MARKS as readonly string[]).includes(m.mark)) marked += db.query('UPDATE skills SET mark = ? WHERE key = ? AND mark != ?').run(m.mark, key, m.mark).changes;
        if (typeof m.kind === 'string' && (KINDS as readonly string[]).includes(m.kind)) kinds += db.query('UPDATE skills SET kind = ?, kind_set = 1 WHERE key = ? AND (kind != ? OR kind_set = 0)').run(m.kind, key, m.kind).changes;
      }
      if ((review || reviewed()) && !allSkills().some((s) => allowed(s, true))) throw new Error(NONE_CONFIDENT);
      if (review) db.query('UPDATE skills_review SET reviewed_at = ? WHERE id = 1').run(now);
    })();
  } catch (e) { if ((e as Error).message === NONE_CONFIDENT) return { marked: 0, changed: 0, refused: NONE_CONFIDENT }; throw e; }
  return { marked, changed: marked + kinds };
}

const mentions = (text: string, name: string) => [...text.matchAll(new RegExp(`(?:^|[^a-z0-9+#])${name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^a-z0-9+#])`, 'g'))];
// Whether a skill may be on a resume now: a tool, language or platform, not marked "not confident", and marked
// confident once the list has been reviewed.
export const allowed = (s: Skill, isReviewed = reviewed()) => s.in_bank === 1 && s.kind !== 'other' && s.mark !== 'not-confident' && (!isReviewed || s.mark === 'confident');

// The skills for one resume, in order: first those the posting names (the most named first), then those the
// writer chose for this posting (`prefer`, in its order), then those the most facts show. Never more than the cap.
// Every item comes from the skills list, so a phrase lifted from the posting cannot get in.
export function resumeSkills(posting: string, pages: number, prefer: string[] = [], list = allSkills(), isReviewed = reviewed()): string[] {
  const low = posting.toLowerCase(), want = prefer.map((p) => p.trim().toLowerCase());
  const rank = (s: Skill) => { const hits = mentions(low, s.key); const at = want.indexOf(s.key); return { hits: hits.length, first: hits[0]?.index ?? Infinity, at: at < 0 ? Infinity : at }; };
  return list.filter((s) => allowed(s, isReviewed)).map((s) => ({ s, r: rank(s) }))
    .sort((a, b) => b.r.hits - a.r.hits || a.r.first - b.r.first || a.r.at - b.r.at || b.s.facts - a.s.facts || a.s.name.localeCompare(b.s.name))
    .slice(0, capFor(pages)).map((x) => x.s.name);
}

// Writes a resume's Skills section from the list: one line, in the order above. Used on a resume a model wrote, never on the person's own edit.
export function withSkills(resume: string, posting: string, pages: number): string {
  const lines = resume.split('\n'), at = lines.findIndex((l) => /^##\s+(?:technical\s+|core\s+)?skills\s*$/i.test(l.trim()));
  const skills = resumeSkills(posting, pages, at < 0 ? [] : parseResume(resume).skills);
  if (at < 0) {
    if (skills.length === 0) return resume;
    const before = lines.findIndex((l) => /^##\s+education\b/i.test(l.trim())), block = ['## Skills', '', skills.join(', '), ''];
    if (before < 0) return `${resume.trimEnd()}\n\n${block.join('\n')}`;
    lines.splice(before, 0, ...block);
    return lines.join('\n');
  }
  let end = lines.findIndex((l, i) => i > at && /^##\s/.test(l));
  if (end < 0) end = lines.length;
  // With no skill that may be shown, the section the writer made is taken out: nothing in it was confirmed.
  lines.splice(at, end - at, ...(skills.length ? ['## Skills', '', skills.join(', '), ...(end < lines.length ? [''] : [])] : []));
  return lines.join('\n').trimEnd();
}

// Rule 14: each Experience entry ends with one line "Technologies: A, B, C", written here from the skills list, never by a
// model, on a resume a model wrote. It names only the skills that the facts of the entry's employer name (its roles, the
// rows filed under it, and the facts filed in their projects), and only those that may be on a resume now (allowed, as
// for the Skills line, so a skill marked not confident never appears), the posting's terms first, at most TECH_CAP. An
// entry with no bullet, or whose facts name no such skill, gets no line. Any Technologies line already in an entry (the
// model's, or an earlier one) is taken out first, so the line is always code's, and a second pass changes nothing.
// `write` false only takes the lines out (EGG_CARL=off).
export const TECH_CAP = 10;
export function withTechnologies(resume: string, posting: string, roles: RoleRow[], write = true): string {
  const text = lf(resume), lines = text.split('\n'), parsed = parseResume(text, roles.map((r) => r.company)), groups = employers(roles);
  const facts = db.query("SELECT role_id, skills FROM facts WHERE role_id IS NOT NULL AND skills != ''").all() as { role_id: number; skills: string }[];
  const list = allSkills(), bullets = new Set(parsed.outline.filter((o) => o.kind === 'bullet').map((o) => o.line));
  const drop = new Set<number>(), after = new Map<number, string>();
  for (const e of [...parsed.experience, ...parsed.projects, ...parsed.elsewhere]) {
    // A Technologies line goes with the blank line above it, which code wrote with it.
    for (const i of e.at.technologies) { drop.add(i); if (i > 0 && lines[i - 1].trim() === '') drop.add(i - 1); }
    if (!write || e.section !== 'experience') continue;
    const last = Math.max(-1, ...e.at.lines.filter((i) => bullets.has(i)));
    const g = groupOf(e.title, e.company, [...e.ranges, ...e.previously.flatMap((p) => p.ranges)], groups).group;
    if (last < 0 || !g) continue;
    const ids = new Set([...g.rows, ...g.children].map((r) => r.id));
    const named = new Set(facts.filter((f) => ids.has(f.role_id)).flatMap((f) => f.skills.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)));
    const items = resumeSkills(posting, 2, [], list.filter((x) => named.has(x.key))).slice(0, TECH_CAP);
    if (items.length) after.set(last, `Technologies: ${items.join(', ')}`);
  }
  if (drop.size === 0 && after.size === 0) return resume;
  return lines.flatMap((l, i) => [...(drop.has(i) ? [] : [l]), ...(after.has(i) ? ['', after.get(i)!] : [])]).join('\n');
}
// The lines of a resume a model wrote that code writes from the skills list: the Skills line, and with CARL each
// entry's Technologies line. With EGG_CARL=off a Technologies line an earlier pass wrote is taken out. Used wherever the
// Skills line was written alone before, and never on a resume the owner edited by hand (its callers hold to that).
export function withSkillLines(resume: string, posting: string, pages: number, roles = db.query('SELECT * FROM roles').all() as RoleRow[]): string {
  return withTechnologies(withSkills(resume, posting, pages), posting, roles, carlOn());
}

// What is wrong with an entry's Technologies line as it stands (rule 14), for the flags on a job (lib/checks.ts): the
// items that may not be on a resume now (allowed, as for the Skills line) or that no fact of the entry's rows names.
export function technologyProblems(listed: string[], roleIds: Set<number>): string[] {
  const byKey = new Map((db.query('SELECT * FROM skills').all() as Skill[]).map((s) => [s.key, s])), isReviewed = reviewed();
  const named = new Set((db.query("SELECT role_id, skills FROM facts WHERE role_id IS NOT NULL AND skills != ''").all() as { role_id: number; skills: string }[])
    .filter((f) => roleIds.has(f.role_id)).flatMap((f) => f.skills.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)));
  return listed.filter((x) => { const k = x.trim().toLowerCase(), s = byKey.get(k); return !s || !allowed(s, isReviewed) || !named.has(k); });
}

// What is wrong with a resume's Skills section as it stands, in plain words: for the flags on a job (lib/checks.ts).
export function skillProblems(listed: string[], pages: number): { over: number; cap: number; unconfirmed: boolean; notAllowed: string[] } {
  const byKey = new Map((db.query('SELECT * FROM skills').all() as Skill[]).map((s) => [s.key, s])), isReviewed = reviewed();
  const notAllowed = listed.filter((x) => { const s = byKey.get(x.trim().toLowerCase()); return !s || !allowed(s, isReviewed); });
  return { over: Math.max(0, listed.length - capFor(pages)), cap: capFor(pages), unconfirmed: !isReviewed && listed.length > 0, notAllowed };
}
