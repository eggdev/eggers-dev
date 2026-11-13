// Reading one source into proposed facts. The rules every prompt shares are in RULES: nothing
// here may invent, round up or infer a number, because a resume is built only from these facts.
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { db, deletedFacts, KINDS, type Extraction, type RoleRow, type SourceRow } from './db.ts';
import { authors, clone, hub } from './github.ts';
import { inData } from './paths.ts';
import { ask } from './llm.ts';

// The inbox sits beside the database, so a test's scratch database gets a scratch inbox too.
export const INBOX = resolve(process.env.EGG_INBOX ?? inData('inbox'));
mkdirSync(INBOX, { recursive: true });

const SCHEMA = {
  type: 'object', required: ['roles', 'facts'], additionalProperties: false,
  properties: {
    roles: { type: 'array', items: { type: 'object', required: ['key', 'company', 'title', 'start', 'end', 'location', 'summary'], additionalProperties: false,
      properties: { key: { type: 'string' }, company: { type: 'string' }, title: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' }, location: { type: 'string' }, summary: { type: 'string' } } } },
    facts: { type: 'array', items: { type: 'object', required: ['roleKey', 'kind', 'text', 'detail', 'metric', 'skills', 'evidence', 'replaces'], additionalProperties: false,
      properties: { roleKey: { type: 'string' }, kind: { type: 'string', enum: [...KINDS] }, replaces: { type: 'string' }, text: { type: 'string' }, detail: { type: 'string' }, metric: { type: 'string' }, skills: { type: 'array', items: { type: 'string' } }, evidence: { type: 'string' } } } },
  },
};

import { WRITING } from './writing.ts';
const FACT_WORDING = WRITING.split('\n').slice(1).map((l) => l.replace(/^- /, '  - ')).join('\n');
const RULES = `You are building a knowledge bank of one person's professional history. Later, resumes are assembled only from this bank, so every fact must be true and traceable.

Rules:
- Record only what the material states or directly shows. Never invent, embellish, round up or infer a number.
- One fact is one discrete thing: an accomplishment, a project, a responsibility, a skill, or an education or certification entry. Split compound bullets into separate facts.
- "text" is one plain sentence in the past tense, with no leading pronoun: what was done and, when the material says so, the result.
${FACT_WORDING}
- "detail" is the story behind the fact, in two to five plain sentences, as far as the material tells it: the situation, what the person themselves did, the decisions they made and why, what was hard, and what came of it. Outcomes that are not numbers count (a team unblocked, a customer kept, a practice others adopted). Write "" when the material says no more than "text" does.
- "metric" is the measurable result exactly as the material gives it (for example "p95 latency 900 ms to 210 ms"), or "" when it gives none.
- "skills" lists the technologies, tools and methods that the fact itself demonstrates.
- "evidence" is what supports the fact: a short verbatim quote, or commit hashes and file paths. Never leave it empty.
- A bare list of skills becomes one fact per skill, of kind "skill", whose "text" is only the skill's name ("Go", "Kubernetes"). Do not wrap it in a sentence.
- "kind" is one of: ${KINDS.join(', ')}.
- A role is one job title at one company. "start" and "end" are YYYY-MM, with "" for unknown, and an "end" of "" for a current role.
- Roles already in the bank are listed below with keys like "role:12". Use that key as a fact's "roleKey" when it is the same role, and do not repeat it under "roles".
- For a role that is not listed, add it under "roles" with a key of your own (such as "new:1") and use that key.
- A fact that belongs to no role (a general skill, education) takes a "roleKey" of "".
- The bank's facts are listed below with keys like "fact:57". Do not return a fact the bank already has, however differently it is worded. When the material adds something to one (a number, a detail, the outcome, a clearer wording), return the fuller fact with that key in "replaces"; it then takes that fact's place. A fact that is new takes a "replaces" of "".`;

const known = () => {
  const roles = db.query('SELECT * FROM roles ORDER BY start DESC').all() as RoleRow[];
  return roles.length === 0 ? 'Roles already in the bank: none.'
    : `Roles already in the bank:\n${roles.map((r) => `- role:${r.id}: ${r.title} at ${r.company} (${r.start || '?'} to ${r.end || 'present'})`).join('\n')}`;
};

// What the bank already holds, so a source adds only what is new. A source being read again does not
// see its own earlier facts: they are replaced by this reading.
const held = (sourceId: number) => {
  const facts = db.query("SELECT f.id, f.role_id, f.text, f.metric FROM facts f WHERE NOT (f.source_id IS ? AND f.status = 'proposed') ORDER BY f.role_id, f.id").all(sourceId) as { id: number; role_id: number | null; text: string; metric: string }[];
  return facts.length === 0 ? 'Facts already in the bank: none.'
    : `Facts already in the bank:\n${facts.map((f) => `- fact:${f.id} (${f.role_id === null ? 'general' : `role:${f.role_id}`}): ${f.text}${f.metric ? ` [${f.metric}]` : ''}`).join('\n')}`;
};

// What the person deleted from the bank. A reading words things afresh, so the model is told too: an exact match is also dropped on the way in (lib/db.ts).
const removed = () => {
  const gone = deletedFacts();
  return gone.length === 0 ? '' : `\n\nFacts the person deleted from the bank. Do not record these again, in these words or others:\n${gone.map((t) => `- ${t}`).join('\n')}`;
};

const GIT = ['log', 'show', 'shortlog', 'diff', 'ls-files', 'rev-list', 'blame'].map((c) => `Bash(git ${c}:*)`);

// Answers the extraction for a source, or throws with a reason a person can act on.
export async function read(source: SourceRow): Promise<Extraction> {
  if (source.kind === 'text') {
    return ask<Extraction>({ cwd: INBOX, schema: SCHEMA, timeoutMs: 10 * 60_000,
      prompt: `${RULES}\n\n${known()}\n\n${held(source.id)}${removed()}\n\nThe material is titled "${source.title}". Extract every role and fact from it:\n\n<material>\n${source.body}\n</material>` });
  }
  if (source.kind === 'file') {
    const file = join(INBOX, source.body);
    if (!resolve(file).startsWith(INBOX + '/') || !existsSync(file)) throw new Error(`${source.body} is not in the inbox folder any more. Put it back in ${INBOX} and read it again.`);
    let name = source.body;
    // Claude Code reads PDFs and text itself; a Word file is turned into text first (macOS's textutil).
    if (['.docx', '.doc', '.rtf'].includes(extname(file).toLowerCase())) {
      const out = join(INBOX, `.${source.body}.txt`);
      const done = Bun.spawnSync(['textutil', '-convert', 'txt', '-output', out, file]);
      if (done.exitCode !== 0) throw new Error(`Couldn't convert ${source.body} to text on this machine. Save it as a PDF and add that instead.`);
      name = `.${source.body}.txt`;
    }
    return ask<Extraction>({ cwd: INBOX, schema: SCHEMA, tools: ['Read'], allow: ['Read'], timeoutMs: 15 * 60_000,
      prompt: `${RULES}\n\n${known()}\n\n${held(source.id)}${removed()}\n\nRead the file "./${name}" in the current directory, all of it (a long PDF takes several reads by page range). It may be a resume, a LinkedIn export or a review. Extract every role and fact from it. Read nothing else.` });
  }
  if (source.kind === 'github') {
    const me = await hub();
    if (!me.connected) throw new Error(me.error);
    const mine = await authors(source.body, me.login);
    const dir = await clone(source.body);
    return readRepo(dir, source.body, mine.join(', '), source.id);
  }
  const repo = resolve(source.body);
  if (!existsSync(join(repo, '.git')) || !statSync(repo).isDirectory()) throw new Error(`${repo} is not a git repository on this machine. Check the path and read it again.`);
  return readRepo(repo, source.title, source.author, source.id);
}

function readRepo(repo: string, title: string, author: string, sourceId: number): Promise<Extraction> {
  return ask<Extraction>({ cwd: repo, schema: SCHEMA, tools: ['Read', 'Grep', 'Glob', 'Bash'], allow: ['Read', 'Grep', 'Glob', ...GIT], timeoutMs: 45 * 60_000,
    prompt: `${RULES}\n\n${known()}\n\n${held(sourceId)}${removed()}\n\nThe material is the git repository in the current directory ("${title}"). The person's commits are the ones whose author name or email is any of: ${author}.

Find out what this person built here, from their commits only:
1. Run \`git shortlog -sne --all\` to see the authors, then \`git log --author=<pattern> --date=short --stat\` (in pages, with --skip and -n) to walk the person's whole history. Note the first and last commit dates.
2. Group the commits into the features, systems and fixes they add up to. Open the diffs and the code (\`git show\`, Read) for the substantial ones until you can say concretely what each feature does and what the person's part in it was.
3. Write one fact per feature, system, migration, or notable fix. Prefer "Built X, which does Y, using Z" over a list of commits. Say what share was theirs when others also worked on it.
4. A number goes in "metric" only when the repository itself shows it (a benchmark in a commit message, a test count, a measured before and after). Commit counts and line counts are not accomplishments.
5. "detail" says how the feature works and what the person decided: the approach taken, trade-offs visible in the code or commit messages, and how it changed over time.
6. "evidence" is the commit hashes (short) and the main paths.
7. Attach the facts to the listed role whose company and dates fit this repository. When none fits, add one role with the organisation the repository belongs to as "company" (the repository's name when nothing says), a "title" of "", and the first and last commit months as "start" and "end".

Commands that change the repository are refused; only read it.` });
}
