// Home's list: the things that need the person, as one ordered list (DESIGN.md rules 6 and 9).
// Nothing here decides anything. It gathers what other parts already know needs the person:
// 1. the questions code raised from their own data (lib/raised.ts), answered in place with POST /questions;
// 2. the questions a model wrote that are open in Talk (lib/talk.ts), which are answered in Talk;
// 3. applications with no reply 14 days after they were sent, which are settled on the job's page.
// A job read but not yet opened is not here: the jobs table does not record whether the person opened one.
//
// A snooze hides one item until a time. It is kept by the item's key, so an item that comes back
// with the same key stays hidden until then, and one whose time has passed is shown again.
import { createHash } from 'node:crypto';
import { db } from './db.ts';
import { normCompany } from './entries.ts';
import { HOME_RECORD } from './gaps.ts';
import { openProposalRoles } from './propose.ts';
import { inputsOf, openRaised, routeOf, type Raised } from './raised.ts';
import { parseResume } from './resume.ts';
import { openQuestions } from './talk.ts';

db.run('CREATE TABLE IF NOT EXISTS queue_snoozes (key TEXT PRIMARY KEY, until INTEGER NOT NULL)');

const DAY = 86_400_000;
// How long a snooze lasts when the person gives no time.
export const SNOOZE_MS = DAY;
// After this many days with no reply, an application has gone quiet (DESIGN.md, the rotting mark).
export const QUIET_DAYS = 14;

// kind: timeline | linkedin | skill | record (a raised question), proposals (projects suggested for a role), talk (a
// question open in Talk), quiet (an application).
// choices and inputs are a raised question's: inputs[i] is what choice i needs beside the tap ("month", "line" or "").
// route is where the item is settled when it is not answered here ("" for a raised question).
// from says where the item came from; blocks says what it holds up, when that is known ("" when not).
export type Item = { key: string; kind: string; text: string; from: string; blocks: string; choices: string[]; inputs: string[]; route: string };
export type Queue = { items: Item[]; snoozed: number };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
// A short, stable key for a question known only by its words.
const keyOf = (text: string) => createHash('sha256').update(text.trim().toLowerCase().replace(/\s+/g, ' ')).digest('hex').slice(0, 12);

// The resumes not yet sent that show one of these roles: each has an entry whose company is the role's.
export function resumesShowing(roleIds: number[]): number {
  if (roleIds.length === 0) return 0;
  const all = db.query('SELECT id, company FROM roles').all() as { id: number; company: string }[];
  const wanted = new Set(all.filter((r) => roleIds.includes(r.id)).map((r) => normCompany(r.company)).filter(Boolean));
  if (wanted.size === 0) return 0;
  const companies = [...new Set(all.map((r) => r.company))];
  const unsent = db.query("SELECT resume FROM jobs WHERE resume != '' AND outcome = ''").all() as { resume: string }[];
  return unsent.filter((j) => {
    const r = parseResume(j.resume, companies);
    return [...r.experience, ...r.projects, ...r.elsewhere, ...r.earlier].some((e) => wanted.has(normCompany(e.company)));
  }).length;
}

const rolesIn = (about: string) => about.split(',').map((s) => /^role:(\d+)$/.exec(s.trim())).filter((m) => m !== null).map((m) => Number(m![1]));
const FROM: Record<string, string> = { timeline: 'From the dates of your jobs', linkedin: 'From your LinkedIn export', skill: 'From your skills list', record: 'From what your record is missing' };

function raisedItem(q: Raised): Item {
  const n = q.kind === 'timeline' ? resumesShowing(rolesIn(q.about)) : 0;
  return { key: q.key, kind: q.kind, text: q.text, from: FROM[q.kind] ?? '', blocks: n > 0 ? `Blocks ${plural(n, 'resume')}` : '',
    // A question with no choices to tap is settled where its data is kept.
    choices: q.choices, inputs: inputsOf(q), route: routeOf(q) };
}

type JobLite = { id: number; title: string; company: string; applied_at: number };

// Every item that needs the person now, in Home's order. `hidden` are the items snoozed: they take none of the few
// places the record's questions have on Home. With `all`, every record question is given (to snooze or count one).
export function allItems(now: number, hidden: Set<string> = new Set(), all = false): Item[] {
  // The record's own questions are many on a large record: Home takes the first few, in their rows' order (lib/gaps.ts).
  const open = openRaised();
  const ranked = open.filter((q) => q.kind === 'record' && !hidden.has(q.key)).sort((a, b) => Number(a.data.rank ?? 0) - Number(b.data.rank ?? 0));
  const record = all ? open.filter((q) => q.kind === 'record') : ranked.slice(0, HOME_RECORD);
  const raised = [...open.filter((q) => q.kind !== 'record'), ...record].map(raisedItem);
  // One item for each role with projects proposed and not yet decided: they are decided on the role.
  const proposals = openProposalRoles().map((r): Item => ({ key: `proposals:${r.role}`, kind: 'proposals', text: `The studio suggests ${plural(r.n, 'project')} for ${r.name}.`,
    from: 'From your Day to day facts', blocks: '', choices: [], inputs: [], route: `/record/role/${r.role}` }));
  const talk = openQuestions().map((q): Item => ({ key: `talk:${keyOf(q.text)}`, kind: 'talk', text: q.text, from: q.from, blocks: '', choices: [], inputs: [], route: '/talk/questions' }));
  const quiet = (db.query("SELECT id, title, company, applied_at FROM jobs WHERE outcome = 'applied' AND applied_at > 0 AND applied_at <= ? ORDER BY applied_at, id").all(now - QUIET_DAYS * DAY) as JobLite[])
    .map((j): Item => {
      const days = Math.floor((now - j.applied_at) / DAY);
      const what = j.title && j.company ? `${j.title} at ${j.company}` : j.title || j.company || 'An application';
      return { key: `quiet:${j.id}`, kind: 'quiet', text: `${what}: no reply in ${days} days.`, from: 'From your applications', blocks: '', choices: [], inputs: [], route: `/job/${j.id}` };
    });
  return [...raised, ...proposals, ...talk, ...quiet];
}

// The keys of the items Home shows now, read with no write (the resume screen says "Answer it on Home" only for these).
export function homeKeys(now: number): Set<string> {
  const hidden = new Set((db.query('SELECT key FROM queue_snoozes WHERE until > ?').all(now) as { key: string }[]).map((r) => r.key));
  return new Set(allItems(now, hidden).filter((i) => !hidden.has(i.key)).map((i) => i.key));
}

// What Home shows: the items not snoozed, and how many are snoozed. Snoozes whose time has passed are dropped.
export function queue(now: number): Queue {
  db.query('DELETE FROM queue_snoozes WHERE until <= ?').run(now);
  const hidden = new Set((db.query('SELECT key FROM queue_snoozes').all() as { key: string }[]).map((r) => r.key));
  return { items: allItems(now, hidden).filter((i) => !hidden.has(i.key)), snoozed: allItems(now, new Set(), true).filter((i) => hidden.has(i.key)).length };
}

// Hides one item until `until` (default: a day from now). Returns '' when done, else why not, in a plain sentence.
export function snooze(key: string, until: number | undefined, now: number): string {
  if (!allItems(now, new Set(), true).some((i) => i.key === key)) return 'That item no longer needs you.';
  const at = until ?? now + SNOOZE_MS;
  if (!Number.isFinite(at) || at <= now) return 'Choose a time later than now.';
  if (at > now + 365 * DAY) return 'Choose a time within a year.';
  db.query('INSERT INTO queue_snoozes (key, until) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET until = excluded.until').run(key, at);
  return '';
}
