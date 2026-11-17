// Talk: one running conversation with the person about their work and career. They answer the
// open questions (what the profile, a job's reading or a resume's council wanted and the bank
// could not give) or raise anything themselves. What they say about their work is written into
// the bank as facts, in their name: said by them, so taken as true, with no review step.
// The server only stores messages. The worker writes each reply (lib/llm.ts), beside its other work.
import { answeredQuestions, db, KINDS, type RoleRow } from './db.ts';
import { direction } from './direction.ts';
import { ask } from './llm.ts';
import { SIGNAL, WRITING } from './writing.ts';

// who: you | claude. status: done | queued | running | failed (a reply being written). added is a
// JSON list of the facts a reply put in the bank, as their sentences.
db.run(`CREATE TABLE IF NOT EXISTS talk (
  id INTEGER PRIMARY KEY AUTOINCREMENT, who TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', added TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'done', note TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL)`);

export type TalkRow = { id: number; who: string; body: string; added: string; status: string; note: string; created_at: number };
export type Question = { text: string; from: string };

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

// The open questions, the most useful first: what a resume's writer, council and six-second skim could not get
// from the bank, then what the profile wants, then what each job not yet sent wants. Answered ones are left out.
// The questions code raises from the person's own data (lib/raised.ts: job dates, LinkedIn differences, skills)
// are not here. Each has set choices and an answer that changes the bank, so it is closed only by that answer
// (POST /questions), never by this conversation or by a model's judgment that it was answered.
export function openQuestions(limit = 30): Question[] {
  const done = new Set((db.query('SELECT question FROM answered').all() as { question: string }[]).map((r) => norm(r.question)));
  const out: Question[] = [], seen = new Set<string>();
  const add = (text: string, from: string) => { const k = norm(text); if (k === '' || done.has(k) || seen.has(k)) return; seen.add(k); out.push({ text: text.trim(), from }); };
  const jobs = db.query("SELECT company, title, analysis FROM jobs WHERE analysis != '' AND outcome = '' ORDER BY fit DESC").all() as { company: string; title: string; analysis: string }[];
  type Read = { gaps?: string[]; questions?: string[]; review?: { questions?: string[] }; skim?: { questions?: string[] } };
  const parsed = jobs.map((j) => { try { return { j, a: JSON.parse(j.analysis) as Read }; } catch { return { j, a: {} as Read }; } });
  for (const { j, a } of parsed) for (const q of a.questions ?? []) add(q, `From writing your ${j.company} resume`);
  for (const { j, a } of parsed) for (const q of a.review?.questions ?? []) add(q, `From the review of your ${j.company} resume`);
  for (const { j, a } of parsed) for (const q of a.skim?.questions ?? []) add(q, `From a six-second skim of your ${j.company} resume`);
  for (const g of ((db.query('SELECT gaps FROM profile WHERE id = 1').get() as { gaps: string } | null)?.gaps ?? '').split('\n')) add(g, 'From your profile');
  for (const { j, a } of parsed) for (const q of (a.gaps ?? []).slice(0, 3)) add(q, `For ${j.title} at ${j.company}`);
  return out.slice(0, limit);
}

export const messages = () => db.query('SELECT * FROM talk ORDER BY id').all() as TalkRow[];

// What the person said, and a reply for the worker to write. Refused while a reply is still being written.
export function say(body: string, now: number): string {
  if ((db.query("SELECT count(*) AS n FROM talk WHERE status IN ('queued', 'running')").get() as { n: number }).n > 0) return 'Claude is still answering. Wait for the reply, then send.';
  db.transaction(() => {
    db.query("INSERT INTO talk (who, body, created_at) VALUES ('you', ?, ?)").run(body.trim(), now);
    db.query("INSERT INTO talk (who, status, created_at) VALUES ('claude', 'queued', ?)").run(now + 1);
  })();
  return '';
}
// An open question, put to the person as Claude's turn: no model is needed to ask what is already written.
export function put(question: string, now: number): string {
  if ((db.query("SELECT count(*) AS n FROM talk WHERE status IN ('queued', 'running')").get() as { n: number }).n > 0) return 'Claude is still answering. Wait for the reply, then pick a question.';
  db.query("INSERT INTO talk (who, body, created_at) VALUES ('claude', ?, ?)").run(question.trim(), now);
  return '';
}
export const forget = () => db.run('DELETE FROM talk');

type Fact = { roleKey: string; kind: string; text: string; detail: string; metric: string; skills: string[]; replaces: string };
const SCHEMA = { type: 'object', additionalProperties: false, required: ['reply', 'facts', 'answered'], properties: {
  reply: { type: 'string' }, answered: { type: 'array', items: { type: 'string' } },
  facts: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['roleKey', 'kind', 'text', 'detail', 'metric', 'skills', 'replaces'],
    properties: { roleKey: { type: 'string' }, kind: { type: 'string', enum: [...KINDS] }, text: { type: 'string' }, detail: { type: 'string' }, metric: { type: 'string' }, skills: { type: 'array', items: { type: 'string' } }, replaces: { type: 'string' } } } } } };

// Writes the reply to the person's last message and puts what they said about their work in the bank.
export async function reply(row: TalkRow, cwd: string): Promise<void> {
  const thread = (db.query("SELECT * FROM talk WHERE id < ? AND status = 'done' ORDER BY id DESC LIMIT 30").all(row.id) as TalkRow[]).reverse();
  const roles = db.query('SELECT * FROM roles ORDER BY id').all() as RoleRow[];
  const facts = db.query('SELECT id, role_id, text, metric FROM facts ORDER BY role_id, id').all() as { id: number; role_id: number | null; text: string; metric: string }[];
  const profile = ((db.query('SELECT body FROM profile WHERE id = 1').get() as { body: string } | null)?.body ?? '').slice(0, 9000);
  // Every open question is shown, so one answer can settle all the wordings of the same thing.
  const open = openQuestions(60);
  const r = await ask<{ reply: string; facts: Fact[]; answered: string[] }>({ cwd, schema: SCHEMA, timeoutMs: 5 * 60_000, model: process.env.EGG_TALK_MODEL ?? process.env.EGG_MODEL ?? 'sonnet',
    prompt: `You are talking with one person about their own work and career, inside a tool that keeps a bank of facts about their work and writes their resumes from it. You have two jobs in this conversation, and the person decides which one a message is for.

1. When they tell you about work they did, draw out the detail a hiring manager would want and record it.
   - Ask one question at a time, the single most useful one: who used it, what changed because of it, how big it was, what was hard, what they decided themselves. Prefer a question that would turn a vague line into a specific one. Stop asking about a piece of work once you have its result or they say they do not know.
   - "facts" holds what this last message added about their work, each as one fact for the bank. Record only what they said. Never invent, round up or infer a number, a title, a date or an outcome. If they are unsure of a number, record their words ("about 40 people") and no more.
   - "text" is one plain sentence in the past tense with no leading pronoun. "detail" is the story as they told it, in two to five plain sentences. "metric" is the measured result exactly as they gave it, or "". "skills" lists technologies and methods the fact shows.
   - "roleKey" is the key of the role or project it belongs to from the list below ("role:3"), or "" if it belongs to none.
   - When their message fills in or corrects a fact the bank already has, set "replaces" to that fact's key ("fact:120") and write the whole fact as it should now stand: every field you give takes the old one's place, so an empty "metric" means the fact now has no measured result, and "roleKey" is where it now belongs. Otherwise "replaces" is "".
   - A message that adds nothing about their work (a question to you, a thought about their direction, small talk) gives "facts": [].
2. When they want to think about their career, roles to aim for, or how to tell their story, talk it through as an honest, experienced peer. Use what the bank and their notes show. Say what you actually think, including when it is not what they hope to hear. Do not flatter. Do not make decisions for them.

"reply" is what you say back: plain, direct, at most about 90 words, no lists unless they ask for one, no headings. If you recorded facts, do not recite them: the tool shows what was added. Then ask the next question, or answer theirs.

"answered" lists, word for word, every one of the open questions below that the conversation or the bank has now answered as far as the person can. The list holds the same question in several wordings, from different parts of the tool: include all of them, and include any the person said they do not know or cannot answer.

${WRITING}

${SIGNAL}

${direction() ? `The person's own notes on their direction. Part of them may be a personal lens they use to think about fit. Do not raise that lens yourself and do not comment on it. If they bring it up, take it as their way of thinking about motivation.\n<direction>\n${direction()}\n</direction>\n` : ''}
Open questions the tool has for them (they may pick one, or ignore them):
${open.length ? open.map((q) => `- ${q.text}`).join('\n') : 'None.'}

Their roles and projects, with the facts already in the bank under each:
${roles.map((x) => `role:${x.id} ${x.title ? `${x.title}, ` : ''}${x.company}${x.start ? ` (${x.start} to ${x.end || 'now'})` : ''}\n${facts.filter((f) => f.role_id === x.id).map((f) => `  fact:${f.id} ${f.text}${f.metric ? ` [${f.metric}]` : ''}`).join('\n')}`).join('\n')}
General (belonging to no role, roleKey ""):
${facts.filter((f) => f.role_id === null || !roles.some((x) => x.id === f.role_id)).map((f) => `  fact:${f.id} ${f.text}${f.metric ? ` [${f.metric}]` : ''}`).join('\n')}

Their profile, written from the bank:
<profile>
${profile}
</profile>

The conversation so far, oldest first:
${thread.map((m) => `${m.who === 'you' ? 'Person' : 'You'}: ${m.body}`).join('\n\n')}

Reply to the person's last message.` });
  const now = Date.now(), added: string[] = [];
  db.transaction(() => {
    for (const f of r.facts ?? []) {
      const text = (f.text ?? '').trim();
      if (text === '') continue;
      const roleId = /^role:\d+$/.test(f.roleKey) && roles.some((x) => `role:${x.id}` === f.roleKey) ? Number(f.roleKey.slice(5)) : null;
      const kind = (KINDS as readonly string[]).includes(f.kind) ? f.kind : 'other';
      const old = /^fact:\d+$/.test(f.replaces) ? (db.query('SELECT id FROM facts WHERE id = ?').get(Number(f.replaces.slice(5))) as { id: number } | null) : null;
      const skills = (f.skills ?? []).map((x) => x.trim()).filter(Boolean).join(', ');
      const evidence = `Said by you in Talk on ${new Date(now).toISOString().slice(0, 10)}.`;
      // What the person says is their own account, so it is kept as theirs: a later re-read of a source will not replace it.
      // The story alone is kept when the correction gives none: the model is not shown the old story, so an empty one means "not retold", not "erase it".
      // A correction stands whole: its metric, filing, category and skills take the old ones' place, so nothing stale is left on the new sentence.
      if (old) db.query("UPDATE facts SET text = ?, detail = CASE WHEN ? != '' THEN ? ELSE detail END, metric = ?, role_id = coalesce(?, role_id), kind = ?, skills = ?, evidence = evidence || ' ' || ?, status = 'confirmed' WHERE id = ?")
        .run(text, f.detail.trim(), f.detail.trim(), f.metric.trim(), roleId, kind, skills, evidence, old.id);
      else db.query("INSERT INTO facts (role_id, kind, text, detail, metric, skills, evidence, source_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'confirmed', ?)")
        .run(roleId, kind, text, f.detail.trim(), f.metric.trim(), skills, evidence, now);
      // The person is shown which facts are new and which were rewritten.
      added.push(old ? `Updated: ${text}` : text);
    }
    const known = new Map(openQuestions(200).map((q) => [norm(q.text), q.text]));
    for (const q of r.answered ?? []) if (known.has(norm(q))) db.query('INSERT OR IGNORE INTO answered (question, at) VALUES (?, ?)').run(known.get(norm(q))!, now);
    db.query("UPDATE talk SET body = ?, added = ?, status = 'done', note = '' WHERE id = ?").run(r.reply.trim(), JSON.stringify(added), row.id);
  })();
}

// Clears open questions the bank or the conversation already answers, whatever their wording: run after a
// profile is written or a job is read, since each writes fresh questions without knowing what Talk settled.
export async function prune(cwd: string): Promise<number> {
  const open = openQuestions(200);
  if (open.length === 0) return 0;
  const facts = db.query('SELECT text, metric FROM facts ORDER BY role_id, id').all() as { text: string; metric: string }[];
  const said = (db.query("SELECT who, body FROM talk WHERE status = 'done' ORDER BY id DESC LIMIT 40").all() as { who: string; body: string }[]).reverse();
  const r = await ask<{ answered: string[]; repeats: string[] }>({ cwd, timeoutMs: 8 * 60_000, model: process.env.EGG_TALK_MODEL ?? process.env.EGG_MODEL ?? 'sonnet',
    schema: { type: 'object', additionalProperties: false, required: ['answered', 'repeats'], properties: { answered: { type: 'array', items: { type: 'string' } }, repeats: { type: 'array', items: { type: 'string' } } } },
    prompt: `A tool keeps a list of open questions for one person about their own work. Some are already answered: by a fact now in their record, or because they said in conversation that they do not know. Return, word for word, every question in the list that is already answered in substance, so it is not asked again. A question with several parts is answered only when its main part is. When in doubt, leave it open.

The list also repeats itself: different parts of the tool ask the same thing in different words. In "repeats", return word for word every open question that asks what another open question already asks, keeping one per subject: the clearest and most complete wording stays out of "repeats". Two questions about the same piece of work that seek different facts are not repeats.

Questions already closed, for reference (close any open one that asks the same thing):
${answeredQuestions().map((q) => `- ${q}`).join('\n') || 'None.'}

The open questions:
${open.map((q) => `- ${q.text}`).join('\n')}

The facts in their record:
${facts.map((f) => `- ${f.text}${f.metric ? ` [${f.metric}]` : ''}`).join('\n')}

Their recent conversation with the tool:
${said.map((m) => `${m.who === 'you' ? 'Person' : 'Tool'}: ${m.body}`).join('\n\n') || 'None.'}` });
  const known = new Map(open.map((q) => [norm(q.text), q.text]));
  let n = 0;
  for (const q of [...(r.answered ?? []), ...(r.repeats ?? [])]) if (known.has(norm(q))) { db.query('INSERT OR IGNORE INTO answered (question, at) VALUES (?, ?)').run(known.get(norm(q))!, Date.now()); n++; }
  return n;
}
