// The app's server: `bun server.ts` (the API) beside `bun worker.ts` (ingestion). It listens on
// this machine's port 8787, or on HOST and PORT (a Tailscale address on the standing machine).
// It has no sign-in: reach it only over the tailnet. `test` and `verify` run it on an empty database.
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { extname, join } from 'node:path';
import { bankSignature, db, profileSignature, type RoleRow, type SourceRow } from './lib/db.ts';
import { direction, payFloor, saveDirection } from './lib/direction.ts';
import { FIELDS, person, savePerson, withHeader } from './lib/person.ts';
import { forget, messages, openQuestions, put, say } from './lib/talk.ts';
import { type Door } from './lib/outreach.ts';
import { hub } from './lib/github.ts';
import { fetchBoard, parseBoard, salaryIn, type CompanyRow, type LeadRow } from './lib/discover.ts';
import { INBOX } from './lib/ingest.ts';
import { CHANGED_WHILE_EDITING, fitOf, publish, refreshDueSkills, saveOwnerEdit, refreshOneSkillsLine, reflagOpen, saveResume, skillsChanged, skillsDue, skillsLineOf, SKILLS_QUIET_MS, termsOf, weigh, type Analysis, type JobRow } from './lib/jobs.ts';
import { syncQuestions } from './lib/checks.ts';
import { syncRecordQuestions } from './lib/gaps.ts';
import { answer, inputsOf, openRaised, raisedByKey } from './lib/raised.ts';
import { QUIET_DAYS, queue, snooze } from './lib/queue.ts';
import { lf } from './lib/resume.ts';
import { keepSent, keepStanding, setResume } from './lib/versions.ts';
import { allowed, allSkills, CAP, markSkills, reviewed, reviewedOn, syncSkills } from './lib/skills.ts';
import { markFromList, skillsView } from './lib/skillsview.ts';
import { type AtsCheck } from './lib/pdf.ts';
import { draftCollection, MAX_COLLECTION, readSaved, reviewNotes, saveCollection } from './lib/public.ts';
import { activity, dismiss, failedRow, markSeen, stubStep, type Kind } from './lib/activity.ts';
import { syncProjects } from './lib/projects.ts';
import { addFact, addProject, addRole, deleteProject, deleteRole, derivedNow, fullFact, patchFact, patchProject, patchRole, readTree, removeFact, type Done } from './lib/record.ts';
import { askFor, checkProposals, decideResult, keepProposal, proposalsOf, rejectProposal, requestFor, storeProposals, type Decided } from './lib/propose.ts';
import { judge } from './lib/derived.ts';

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, PATCH, DELETE' };
const send = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS });
const preflight = () => new Response(null, { status: 204, headers: CORS });
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
// A link's site name, '' for anything that is not a web address: a stored link must never break a list.
const hostOf = (url: string) => { try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.hostname.replace(/^www\./, '') : ''; } catch { return ''; } };
// Fourteen days after applying with nothing heard, a job is done: no response. The list and the job's own page both use this.
const outcomeNow = (j: { outcome: string; applied_at: number }) => (j.outcome === 'applied' && j.applied_at > 0 && Date.now() - j.applied_at > 14 * DAY ? 'no-response' : j.outcome);
// Started by a test run: no browser is launched to print PDFs, and GitHub is a fixed sample.
// Prose a model wrote is shown with real apostrophes and quotation marks. Only the named fields: a resume, a link or a
// drafted message is left exactly as written.
const pretty = (t: string) => t.replace(/(\w)'(\w)/g, '$1’$2').replace(/(^|[\s(])'([^']+)'(?=[\s.,;:)!?]|$)/g, '$1‘$2’').replace(/(^|[\s(])"([^"]+)"(?=[\s.,;:)!?]|$)/g, '$1“$2”');
const deep = (v: unknown): unknown => typeof v === 'string' ? pretty(v) : Array.isArray(v) ? v.map(deep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === 'id' ? x : deep(x)])) : v;
const curly = <T extends Record<string, unknown>>(o: T, keys: string[]): T => ({ ...o, ...Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, deep(o[k])])) });
const STUB = process.argv.includes('--stub-github');
// After a change to a role, a skill or an answer: the questions code raises and the flags that read them are taken
// again. A failure here is logged and never fails the request that made the change.
// Each step runs on its own: one that fails (the database busy) is logged and the next ones still run.
const step = (what: string, run: () => unknown) => { try { run(); } catch (e) { console.log(`${what} could not be checked: ${(e as Error).message}`); } };
const follow = () => {
  step('projects', () => syncProjects());
  step('questions', () => syncQuestions(Date.now()));
  step('the record’s questions', () => syncRecordQuestions(Date.now()));
  step('flags', () => reflagOpen());
};
// A request's JSON body, when it is an object; null for no body, bad JSON, null, a list or a value.
const objectBody = async (req: Request): Promise<Record<string, unknown> | null> => {
  const b = await req.json().catch(() => null);
  return b !== null && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
};
const NOT_OBJECT = 'Send the request as a JSON object.';
// A write by hand to the record (lib/record.ts) as the answer the app reads: what was made or changed, with its
// reference, or the refusal in words.
const done = (d: Done, made = 200) => (d.ok ? send({ ok: true, kind: d.kind, id: String(d.id), ref: d.ref, wrote: d.wrote, ...(d.madeRole ? { madeRole: String(d.madeRole) } : {}) }, made) : send({ error: d.error, ...(d.split ? { split: true } : {}) }, d.status));

const DAY = 86_400_000;
// What the job's record line needs beside its row: when it was sent, whether it has gone quiet (the same rule as
// Home's list, lib/queue.ts), where the posting came from, and the state of its resume and of the PDF's check.
const jobFacts = (j: JobRow) => {
  const ats = ((): { score?: number; required?: number } | null => { try { return j.ats ? JSON.parse(j.ats) : null; } catch { return null; } })();
  return { sent: j.applied_at > 0 ? ago(j.applied_at) : '', quiet: j.outcome === 'applied' && j.applied_at > 0 && j.applied_at <= Date.now() - QUIET_DAYS * DAY,
    from: hostOf(j.url), resumeStatus: (j as JobRow & { resume_status?: string }).resume_status ?? '', hasResume: j.resume !== '',
    atsScore: typeof ats?.score === 'number' ? ats.score : -1, atsRequired: typeof ats?.required === 'number' ? ats.required : 85 };
};
// How long ago, in the fewest words: "today", "3 days ago", "2 months ago"; '' when unknown.
const ago = (t: number) => {
  if (!t) return '';
  const d = Math.floor((Date.now() - t) / DAY);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 14 ? `${d} days ago` : d < 60 ? `${Math.floor(d / 7)} weeks ago` : d < 730 ? `${Math.floor(d / 30)} months ago` : `${Math.floor(d / 365)} years ago`;
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Non-breaking spaces keep "Mar 2021 – Present" on one line of a narrow section header.
const month = (ym: string) => { const [y, m] = ym.split('-'); return m && MONTHS[Number(m) - 1] ? `${MONTHS[Number(m) - 1]}\u00a0${y}` : y; };
const period = (r: RoleRow) => (r.start === '' ? '' : `${month(r.start)}\u00a0–\u2060\u00a0${r.end === '' ? 'Present' : month(r.end)}`);

type FactRow = { id: number; role_id: number | null; kind: string; text: string; detail: string; metric: string; skills: string; evidence: string; status: string; source_id: number | null; source: string | null; created_at: number };
// A day in words, as a record's provenance line says it: "3 Mar 2026"; '' when unknown.
const day = (t: number) => (t > 0 ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(t) : '');

// The bank as the app shows it: roles newest first, then the facts that belong to none ("General").
function bank() {
  const roles = db.query("SELECT * FROM roles ORDER BY CASE WHEN end = '' AND start != '' THEN 1 ELSE 0 END DESC, end DESC, start DESC, id").all() as RoleRow[];
  const facts = db.query(`SELECT f.id, f.role_id, f.kind, f.text, f.detail, f.metric, f.skills, f.evidence, f.status, f.source_id, s.title AS source, f.created_at
    FROM facts f LEFT JOIN sources s ON s.id = f.source_id ORDER BY f.id`).all() as FactRow[];
  const ids = new Set(roles.map((r) => r.id));
  const of = (f: FactRow) => (f.role_id !== null && ids.has(f.role_id) ? String(f.role_id) : '0');
  // start, end, note and label are what the person can say about a role's dates (PATCH /roles/:id): end is YYYY-MM, '' for a current job.
  const groups = [...roles.map((r) => ({ id: String(r.id), name: r.title ? `${r.title}, ${r.company}` : r.company, period: period(r), standing: r.standing, reach: r.reach,
    employer: r.title !== '', partOf: r.part_of === null ? '' : String(r.part_of), partOfName: roles.find((p) => p.id === r.part_of)?.company ?? '', start: r.start, end: r.end, note: r.note ?? '', label: r.label ?? '' })),
    { id: '0', name: 'General', period: '', standing: '', reach: '', employer: false, partOf: '', partOfName: '', start: '', end: '', note: '', label: '' }];
  return {
    roles: groups.filter((g) => facts.some((f) => of(f) === g.id)),
    // Every role, with or without facts, and "General": where a fact can be filed.
    places: groups.map((g) => ({ id: g.id, name: g.id === '0' ? 'General (no role)' : g.name })),
    facts: facts.map((f) => ({ id: String(f.id), roleId: of(f), kind: f.kind, text: f.text, detail: f.detail, metric: f.metric, skills: f.skills,
      evidence: f.evidence, source: f.source_id === null ? 'Added by hand' : f.source ?? 'A source since deleted',
      // Its provenance: the day it was added, and whether the person has since edited what a source said.
      added: day(f.created_at), edited: f.source_id !== null && f.status === 'confirmed' })),
  };
}

function sources() {
  const rows = db.query(`SELECT s.*, (SELECT count(*) FROM facts f WHERE f.source_id = s.id) AS facts FROM sources s ORDER BY s.id DESC`).all() as (SourceRow & { facts: number })[];
  return rows.map((s) => ({ id: String(s.id), kind: s.kind, title: s.title, status: s.status, note: s.note, facts: s.facts,
    detail: s.kind === 'github' ? `github.com/${s.body}` : s.kind === 'repo' ? (s.author ? `${s.body}, commits by ${s.author}` : s.body) : s.kind === 'file' ? `${s.body}, kept in the studio’s inbox` : `${s.body.length.toLocaleString('en-US')} characters of pasted text` }));
}

// Files waiting in the inbox folder that no source has taken yet.
function inbox() {
  const taken = new Set((db.query("SELECT body FROM sources WHERE kind = 'file'").all() as { body: string }[]).map((s) => s.body));
  return readdirSync(INBOX, { withFileTypes: true }).filter((f) => f.isFile() && !f.name.startsWith('.') && !taken.has(f.name)).map((f) => f.name).sort();
}

// A LinkedIn data export is a zip of CSVs. Only the files about the person's own career are
// read: never messages, connections or invitations, which are other people's information.
const LINKEDIN = ['Profile.csv', 'Profile Summary.csv', 'Positions.csv', 'Education.csv', 'Skills.csv', 'Projects.csv', 'Certifications.csv',
  'Honors.csv', 'Courses.csv', 'Languages.csv', 'Publications.csv', 'Patents.csv', 'Volunteering.csv', 'Recommendations_Received.csv'];
async function linkedinText(bytes: ArrayBuffer): Promise<string | undefined> {
  const zip = join(INBOX, `.upload-${Date.now()}.zip`);
  await Bun.write(zip, bytes);
  try {
    const listed = Bun.spawnSync(['unzip', '-Z1', zip], { stdout: 'pipe', stderr: 'ignore' });
    if (listed.exitCode !== 0) return undefined;
    const names = listed.stdout.toString().split('\n').filter((n) => LINKEDIN.includes(n.split('/').pop() ?? ''));
    if (!names.some((n) => n.endsWith('Positions.csv') || n.endsWith('Profile.csv'))) return undefined;
    return names.map((n) => `## ${n.split('/').pop()}\n${Bun.spawnSync(['unzip', '-p', zip, n], { stdout: 'pipe', stderr: 'ignore' }).stdout.toString().trim()}`).join('\n\n');
  } finally { rmSync(zip, { force: true }); }
}

// What the worker can read (lib/ingest.ts), and the largest upload taken.
const READABLE = ['.pdf', '.docx', '.doc', '.rtf', '.txt', '.md', '.csv', '.json', '.html'];
const MAX_UPLOAD = 25 * 1024 * 1024;
// A name safe to keep in the inbox, made unique beside what is already there.
function inboxName(wanted: string) {
  const clean = wanted.replace(/[/\\\0]/g, ' ').replace(/^\.+/, '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'upload';
  const ext = extname(clean), stem = clean.slice(0, clean.length - ext.length);
  let name = clean;
  for (let n = 2; existsSync(join(INBOX, name)); n++) name = `${stem} ${n}${ext}`;
  return name;
}

// Asking for slow work again. Each is the one way the screens ask for it (the routes below), and Activity's Try again
// (POST /activity/:id/retry) asks by the same function, so there is no second way to start work.
function readSourceAgain(id: number) {
  const s = db.query('SELECT status FROM sources WHERE id = ?').get(id) as { status: string } | null;
  if (!s) return send({ error: 'That source was deleted.' }, 404);
  if (s.status === 'running') return send({ error: 'It’s being read now. Wait for it to finish.' }, 409);
  db.query("UPDATE sources SET status = 'queued', note = '' WHERE id = ?").run(id);
  return send({ ok: true });
}
function readJobAgain(id: number) {
  const j = db.query('SELECT status FROM jobs WHERE id = ?').get(id) as { status: string } | null;
  if (!j) return send({ error: 'That job was deleted.' }, 404);
  if (j.status === 'running') return send({ error: 'It’s being read now. Wait for it to finish.' }, 409);
  db.query("UPDATE jobs SET status = 'queued', note = '' WHERE id = ?").run(id);
  return send({ ok: true });
}
// Asked for by the person: the resume is written again from the bank as it is now. The reading of the posting stays.
function writeResumeAgain(id: number) {
  const state = db.query('SELECT status, resume_status FROM jobs WHERE id = ?').get(id) as { status: string; resume_status: string } | null;
  if (!state) return send({ error: 'That job was deleted.' }, 404);
  // While the resume is being written, a change to it would be lost or would disagree with what comes back.
  if (['queued', 'running'].includes(state.status) || ['queued', 'running'].includes(state.resume_status)) return send({ error: 'This job’s resume is being written now. Wait for it to finish, then change it.' }, 409);
  const r = db.query("UPDATE jobs SET resume_status = 'queued', resume_note = '' WHERE id = ? AND status = 'done'").run(id);
  return r.changes ? send({ ok: true }) : send({ error: 'This job hasn’t been read yet.' }, 409);
}
function writeProfileAgain() {
  const facts = (db.query('SELECT count(*) AS n FROM facts').get() as { n: number }).n;
  if (facts === 0) return send({ error: 'Your record is empty. Add a source first.' }, 409);
  db.run("UPDATE profile SET status = 'queued', note = '' WHERE id = 1 AND status != 'running'");
  return send({ ok: true });
}
// Asks for a few short messages the person could send to reach someone at the company. The worker writes them.
function draftMessagesAgain(id: number) {
  const j = db.query('SELECT outreach_status, posting FROM jobs WHERE id = ?').get(id) as { outreach_status: string; posting: string } | null;
  if (!j) return send({ error: 'That job was deleted.' }, 404);
  if (j.posting.trim() === '') return send({ error: 'This job hasn’t been read yet. Draft messages once it has.' }, 409);
  if (j.outreach_status === 'queued' || j.outreach_status === 'running') return send({ error: 'They’re being written now.' }, 409);
  db.query("UPDATE jobs SET outreach_status = 'queued', outreach_note = '' WHERE id = ?").run(id);
  return send({ ok: true });
}
function checkWatchlistAgain() {
  if ((db.query('SELECT count(*) AS n FROM companies').get() as { n: number }).n === 0) return send({ error: 'The watchlist is empty. Add a company first.' }, 409);
  db.run("UPDATE discovery SET status = 'queued', note = '' WHERE id = 1 AND status != 'running'");
  return send({ ok: true });
}
// A reply in Talk is asked for only by sending a message, so a failed one is not tried again from Activity.
const AGAIN: Partial<Record<Kind, (subject: number) => Response>> = {
  'read-source': readSourceAgain, 'read-posting': readJobAgain, 'write-resume': writeResumeAgain, 'write-profile': () => writeProfileAgain(),
  'draft-messages': draftMessagesAgain, 'check-watchlist': () => checkWatchlistAgain(),
  'propose-projects': (role) => { const refused = askFor(role); return refused ? send({ error: refused }, 409) : send({ ok: true }); },
};

// Where it listens: HOST and PORT when set; else the app's API_BASE_URL when that is this machine
// (a test run on a spare port while a dev server holds the usual one); else LOCAL.
const LOCAL = 'http://127.0.0.1:8787'; // app.ts's default for API_BASE_URL
const built = process.env.API_BASE_URL ?? '';
const here = new URL(/^http:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(built) ? built : LOCAL);
const hostname = process.env.HOST ?? here.hostname, port = Number(process.env.PORT ?? here.port);
// PORT=0 asks the system for a free port (the tests do, so two runs never meet on one); the line below says which.
const served = Bun.serve({ hostname, port, routes: {
  '/health': () => new Response('ok'),
  '/bank': { OPTIONS: preflight, GET: () => send(bank()) },
  // The record as one tree (lib/record.ts): roles, projects and facts with their references, and no story or evidence.
  '/tree': { OPTIONS: preflight, GET: () => send(readTree()) },
  '/profile': {
    OPTIONS: preflight,
    GET: () => {
      const p = db.query('SELECT * FROM profile WHERE id = 1').get() as { body: string; gaps: string; status: string; note: string; signature: string; updated_at: number };
      const facts = (db.query('SELECT count(*) AS n FROM facts').get() as { n: number }).n;
      // The page has its own title, so the document's first heading is left to the file (data/profile.md).
      return send({ status: p.status, note: p.note, body: p.body.replace(/^# .*\n+/, ''), gaps: p.gaps === '' ? [] : p.gaps.split('\n'), facts,
        stale: p.body !== '' && p.signature !== profileSignature(),
        written: p.updated_at === 0 ? '' : new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(p.updated_at) });
    },
  },
  // Saves a profile written or edited outside the worker, as current for the bank as it is now.
  '/profile/save': {
    OPTIONS: preflight,
    POST: async (req) => {
      const b = await req.json().catch(() => ({}));
      if (!str(b.body)) return send({ error: 'Enter the profile.' }, 400);
      const gaps = Array.isArray(b.gaps) ? b.gaps.map(str).filter(Boolean).join('\n') : '';
      db.query("UPDATE profile SET status = 'done', note = '', body = ?, gaps = ?, signature = ?, updated_at = ? WHERE id = 1").run(str(b.body), gaps, profileSignature(), Date.now());
      return send({ ok: true });
    },
  },
  // The person's own direction notes, which steer the profile, how jobs are judged and how resumes are shaped.
  '/direction': {
    OPTIONS: preflight,
    GET: () => send({ body: direction() }),
    POST: async (req) => {
      const b = await req.json().catch(() => ({}));
      if (typeof b.body !== 'string') return send({ error: 'Nothing to save.' }, 400);
      saveDirection(b.body, Date.now());
      return send({ ok: true });
    },
  },
  // The public collection: the text a public assistant answers from. Only the person decides what is in it.
  // GET is the saved text, which the publishing step reads. A draft and notes are only aids, and save nothing.
  '/public': {
    OPTIONS: preflight,
    GET: () => { const saved = readSaved(); return send({ ...saved, notes: reviewNotes(saved.text) }); },
  },
  '/public/draft': {
    OPTIONS: preflight,
    POST: () => { const text = draftCollection(db); return send({ text, notes: reviewNotes(text) }); },
  },
  '/public/notes': {
    OPTIONS: preflight,
    POST: async (req) => {
      const b = await req.json().catch(() => ({}));
      if (typeof b.text !== 'string') return send({ error: 'Send the text to check.' }, 400);
      if (b.text.length > MAX_COLLECTION) return send({ error: `That is over ${MAX_COLLECTION.toLocaleString('en-US')} characters. Shorten it.` }, 400);
      return send({ notes: reviewNotes(b.text) });
    },
  },
  // Saves exactly the text the person sends as the collection.
  '/public/save': {
    OPTIONS: preflight,
    POST: async (req) => {
      const b = await req.json().catch(() => ({}));
      if (typeof b.text !== 'string') return send({ error: 'Send the collection to save.' }, 400);
      try {
        const saved = saveCollection(b.text);
        return send({ ok: true, ...saved, notes: reviewNotes(readSaved().text) });
      } catch (e) { return send({ error: (e as Error).message }, 400); }
    },
  },
  // Talk: the conversation, and the open questions the person can pick from. The worker writes replies.
  '/talk': {
    OPTIONS: preflight,
    GET: () => {
      const rows = messages();
      return send({ busy: rows.some((m) => m.status === 'queued' || m.status === 'running'),
        messages: rows.map((m) => ({ id: String(m.id), mine: m.who === 'you', body: m.body, status: m.status, note: m.note, added: JSON.parse(m.added || '[]') as string[] })),
        questions: openQuestions().map((q, i) => ({ id: String(i), text: q.text, from: q.from })) });
    },
    POST: async (req) => {
      const b = await req.json().catch(() => ({}));
      const refused = str(b.question) ? put(str(b.question), Date.now()) : str(b.body) ? say(str(b.body), Date.now()) : 'Write something to send.';
      return refused ? send({ error: refused }, 409) : send({ ok: true });
    },
    DELETE: () => { forget(); return send({ ok: true }); },
  },
  // The person's own details: the name and contact line every resume opens with.
  '/person': {
    OPTIONS: preflight,
    GET: () => send(person()),
    POST: async (req) => {
      const b = await req.json().catch(() => ({}));
      const next = Object.fromEntries(FIELDS.map((f) => [f, str(b[f])]));
      if (!next.name) return send({ error: 'Enter your name.' }, 400);
      if (next.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(next.email)) return send({ error: 'That email address doesn’t look right.' }, 400);
      savePerson(next, Date.now());
      // Resumes not yet sent take the new first lines. One already sent stays as it went out.
      const open = db.query("SELECT * FROM jobs WHERE resume != '' AND outcome = ''").all() as JobRow[];
      for (const j of open) {
        const resume = withHeader(j.resume);
        if (resume === j.resume) continue;
        setResume(j.id, resume, 'same', 'details', 'Your name and contact line changed.');
        saveResume(j, resume);
      }
      // Printing is slow, so it happens after the answer.
      void (async () => { for (const j of open) await publish(j.id, !STUB).catch(() => {}); })();
      return send({ ok: true, updated: open.length });
    },
  },
  '/profile/write': { OPTIONS: preflight, POST: () => writeProfileAgain() },
  // Who is signed in to GitHub on this machine and what they can reach, with what is already a source marked.
  '/github': {
    OPTIONS: preflight,
    GET: async (req) => {
      const h = await hub(new URL(req.url).searchParams.has('fresh'));
      const have = new Set((db.query("SELECT body FROM sources WHERE kind = 'github'").all() as { body: string }[]).map((s) => s.body));
      // Owners in the order the picker groups them: the person's own account, then the ones with most repositories.
      const count = new Map<string, number>();
      for (const r of h.repos) count.set(r.full.split('/')[0], (count.get(r.full.split('/')[0]) ?? 0) + 1);
      const owners = [...count.keys()].sort((a, b) => (a === h.login ? -1 : b === h.login ? 1 : count.get(b)! - count.get(a)! || a.localeCompare(b)));
      return send({ connected: h.connected, login: h.login, error: h.error, owners, repos: h.repos.map((r) => ({ full: r.full, owner: r.full.split('/')[0], name: r.full.split('/').slice(1).join('/'),
        added: have.has(r.full), extra: r.fork || r.archived,
        detail: [r.private ? 'Private' : 'Public', r.fork ? 'fork' : '', r.archived ? 'archived' : '', r.pushed ? `last pushed ${MONTHS[Number(r.pushed.slice(5, 7)) - 1]} ${r.pushed.slice(0, 4)}` : ''].filter(Boolean).join(', ') })) });
    },
  },
  '/sources/github': {
    OPTIONS: preflight,
    POST: async (req) => {
      const b = await req.json().catch(() => ({}));
      const wanted: string[] = Array.isArray(b.repos) ? [...new Set(b.repos.map(str).filter(Boolean))] : [];
      if (wanted.length === 0) return send({ error: 'Choose at least one repository.' }, 400);
      const known = new Set((await hub()).repos.map((r) => r.full));
      const stranger = wanted.find((w) => !known.has(w));
      if (stranger) return send({ error: `${stranger} isn’t a repository your GitHub sign-in can reach.` }, 409);
      const have = new Set((db.query("SELECT body FROM sources WHERE kind = 'github'").all() as { body: string }[]).map((s) => s.body));
      for (const full of wanted.filter((w) => !have.has(w))) db.query('INSERT INTO sources (kind, title, body, author, created_at) VALUES (?, ?, ?, ?, ?)').run('github', full, full, '', Date.now());
      return send({ ok: true }, 201);
    },
  },
  // Jobs, best fit first; ones not yet read come first so their state is seen.
  '/jobs': {
    OPTIONS: preflight,
    GET: () => send((db.query("SELECT * FROM jobs ORDER BY CASE WHEN status = 'done' THEN 1 ELSE 0 END, fit DESC, id DESC").all() as JobRow[]).map((j) => {
      const outcome = outcomeNow(j);
      return { id: String(j.id), title: j.title || (hostOf(j.url) ? `Posting from ${hostOf(j.url)}` : 'Pasted posting'), company: j.company, place: j.place, status: j.status, note: j.note,
        fit: j.fit, outcome, stage: outcome === '' ? 'saved' : outcome === 'applied' || outcome === 'interviewed' ? 'active' : 'done',
        salary: j.salary || salaryIn(j.posting), posted: ago(j.posted_at), added: ago(j.created_at), contact: j.contact, ...jobFacts(j) };
    })),
    POST: async (req) => {
      const b = await req.json().catch(() => ({})), url = str(b.url), posting = str(b.posting);
      if (!url && !posting) return send({ error: 'Paste the posting or its link.' }, 400);
      if (url && (!/^https?:\/\/\S+$/.test(url) || !hostOf(url))) return send({ error: 'That link doesn’t look like a web address. Paste the posting’s text instead.' }, 400);
      if (!url && posting.length < 200) return send({ error: 'That is too short to be a job posting. Paste the whole thing.' }, 400);
      const had = url ? (db.query('SELECT id, status FROM jobs WHERE url = ?').get(url) as { id: number; status: string } | null) : null;
      // A link that could not be read is given its posting's text here, and read from that.
      if (had && had.status === 'failed' && posting.length >= 200) { db.query("UPDATE jobs SET posting = ?, status = 'queued', note = '' WHERE id = ?").run(posting, had.id); return send({ ok: true }, 201); }
      if (had) return send({ error: had.status === 'failed' ? 'That link is already one of your jobs, and couldn’t be read. Paste the posting’s text below as well, and it will be read from that.' : 'That link is already one of your jobs.' }, 409);
      db.query('INSERT INTO jobs (url, posting, created_at) VALUES (?, ?, ?)').run(url, posting, Date.now());
      return send({ ok: true }, 201);
    },
  },
  '/jobs/:id': {
    OPTIONS: preflight,
    GET: (req) => {
      const j = db.query('SELECT * FROM jobs WHERE id = ?').get(Number(req.params.id)) as JobRow | null;
      if (!j) return send({ error: 'That job was deleted.' }, 404);
      const a: Analysis = j.analysis ? JSON.parse(j.analysis) : { verdict: '', requirements: [], strengths: [], risks: [], changes: [], gaps: [] };
      const covered = a.requirements.filter((r) => r.coverage !== 'none').length;
      const o = j;
      const ats: AtsCheck | null = j.ats ? JSON.parse(j.ats) : null;
      const host = hostOf(j.url);
      return send(curly({ ...jobFacts(j), skillsLine: skillsLineOf(j.id), posted: ago(j.posted_at), added: ago(j.created_at), posting: j.posting, id: String(j.id), url: j.url, title: j.title || (host ? `Posting from ${host}` : 'Pasted posting'), company: j.company, place: j.place, status: j.status, note: j.note, fit: j.fit, resume: j.resume, edited: (j as JobRow & { edited?: number }).edited === 1, outcome: outcomeNow(o), outcomeNote: o.outcome_note, contact: j.contact, pages: j.pages, pdf: j.resume ? `/jobs/${j.id}/resume.pdf` : '',
        atsOk: ats?.ok ?? false, atsScore: ats?.score ?? -1, atsRequired: ats?.required ?? 85, atsParts: (ats?.parts ?? []).map((x) => `${x.label} ${x.score} (counts ${x.weight}%)`).join(' · '), ats: (ats?.lines ?? []).map((l, i) => ({ id: String(i), label: l.label, ok: l.ok, note: l.note })),
        verdict: a.verdict, strengths: a.strengths, risks: a.risks, changes: a.changes, gaps: a.gaps, covered, asked: a.requirements.length,
        // weighed is false for a job read before evidence was weighed: its fit counts coverage alone.
        weighed: a.requirements.some((r) => r.weight !== undefined),
        doors: ((): { id: string; to: string; find: string; why: string; message: string }[] => { try { return (JSON.parse((j as JobRow & { outreach?: string }).outreach || '[]') as Door[]).map((d, i) => ({ id: String(i), ...d })); } catch { return []; } })(),
        resumeStale: j.resume !== '' && o.outcome === '' && (j as JobRow & { bank_sig?: string }).bank_sig !== bankSignature(),
        resumeStatus: (j as JobRow & { resume_status?: string }).resume_status ?? '', resumeNote: (j as JobRow & { resume_note?: string }).resume_note ?? '',
        doorsStatus: (j as JobRow & { outreach_status?: string }).outreach_status ?? '', doorsNote: (j as JobRow & { outreach_note?: string }).outreach_note ?? '',
        reviewScore: a.review ? String(a.review.score) : '', reviewPassed: a.review?.passed ?? false, reviewRounds: a.review?.rounds ?? 0,
        seats: (a.review?.seats ?? []).map((x, i) => ({ id: String(i), seat: x.seat, model: x.model ?? '', note: x.note,
          // Every round's score in order ("6 → 7 → 8"), so the person sees whether the rewrites moved this reader.
          score: (x.scores?.length ? x.scores : [x.score]).map((n) => (n < 0 ? 'no score' : String(n))).join(' → ') })), reviewChanges: a.review?.changes ?? [],
        termsIn: a.terms?.inResume ?? [], termsBank: a.terms?.inBankOnly ?? [], termsMissing: a.terms?.missing ?? [],
        checks: (a.checks ?? []).map((c, i) => ({ id: String(i), question: c.question, answer: c.answer, note: c.note })),
        knockouts: (a.knockouts ?? []).map((k, i) => ({ id: String(i), question: k.question, answer: k.answer, note: k.note })),
        // What to look at on this resume, in plain words (lib/checks.ts), taken again whenever it is written or edited.
        // A line the owner wrote has no fact linked to it (`unlinked`, info): that is said beside the line itself, not here.
        flags: (a.flags ?? []).filter((f) => !(f.kind === 'unlinked' && f.severity === 'info')).map((f, i) => ({ id: String(i), kind: f.kind, severity: f.severity, text: f.text, items: f.items ?? [] })),
        // The six-second skim (lib/skim.ts): null for a resume written before it existed.
        skim: a.skim ? { conclusion: a.skim.conclusion, revisions: a.skim.revisions, questions: a.skim.questions, open: a.skim.open, top: a.skim.top.map((t, i) => ({ id: String(i), requirement: t.requirement, answered: t.answered, note: t.note })) } : null,
        // The posting's top three requirements as the resume was written to answer them, each with its strongest evidence.
        top: (a.map?.top ?? []).map((t, i) => ({ id: String(i), text: t.text, need: t.need, best: t.best, evidence: t.evidence })),
        // need is must | nice | implied (an older reading has only the first two). best is the key of its strongest evidence, bestText that evidence in words.
        requirements: a.requirements.map((r, i) => ({ id: String(i), text: r.text, must: r.need === 'must', need: r.need, coverage: r.coverage, evidence: r.evidence, best: r.best ?? '', bestText: r.bestText ?? '',
          basis: r.basis ?? '', counted: r.weight === undefined ? -1 : Math.round(r.weight * 100) })) }, ['verdict', 'strengths', 'risks', 'changes', 'gaps', 'seats', 'reviewChanges', 'checks', 'knockouts', 'requirements', 'resumeNote']));
    },
    // What became of it, in the person's words: the record that later searches learn from.
    PATCH: async (req) => {
      const b = await req.json().catch(() => ({}));
      const id = Number(req.params.id);
      const state = db.query('SELECT status, resume_status FROM jobs WHERE id = ?').get(id) as { status: string; resume_status: string } | null;
      const busy = state && (state.status === 'queued' || state.status === 'running' || state.resume_status === 'queued' || state.resume_status === 'running') ? 'running' : '';
      // While the resume is being written, a change to it would be lost or would disagree with what comes back.
      if ((b.pages === 1 || b.pages === 2 || b.rewrite === true || typeof b.resume === 'string') && (busy === 'queued' || busy === 'running')) return send({ error: 'This job’s resume is being written now. Wait for it to finish, then change it.' }, 409);
      // The person's own edit of the resume: saved as written, then printed and checked again.
      if (typeof b.resume === 'string') {
        if (!b.resume.trim()) return send({ error: 'The resume can’t be empty.' }, 400);
        // Line endings are stored as plain ones: text pasted from Windows would otherwise read as having no bullets.
        const edited = lf(b.resume).trim();
        // A Save that holds the stored text writes nothing and prints nothing; one made over a text that changed meanwhile
        // is refused, and writes nothing (lib/jobs.ts, saveOwnerEdit). `base` is the text the editor opened.
        const saved = saveOwnerEdit(id, edited, typeof b.base === 'string' ? b.base : undefined);
        if (saved === 'changed') return send({ error: CHANGED_WHILE_EDITING }, 409);
        if (saved === 'saved') await publish(id, !STUB);
        return send({ ok: true });
      }
      if (b.rewrite === true) return writeResumeAgain(id);
      // One page or two: the resume is written again to that length.
      if (b.pages === 1 || b.pages === 2) {
        // Only the resume is written again: the reading of the posting does not depend on its length. The text as it
        // stands is kept as a version first, so the next one can say it was written at another length (lib/versions.ts).
        keepStanding(id);
        db.query("UPDATE jobs SET pages = ?, resume_status = 'queued', resume_note = '' WHERE id = ?").run(b.pages, id);
        return send({ ok: true });
      }
      if (typeof b.contact === 'string') { db.query('UPDATE jobs SET contact = ? WHERE id = ?').run(b.contact.trim(), id); return send({ ok: true }); }
      if (!['', 'applied', 'interviewed', 'rejected', 'no-response', 'offer'].includes(b.outcome)) return send({ error: 'Choose one of the listed outcomes.' }, 400);
      // The note is kept when only the outcome is sent (the list's picker). Marking it applied starts its fourteen days, and
      // picking Applied again restarts them. Saving a note alone (picked is not sent) leaves the clock as it is.
      if (typeof b.note === 'string') db.query('UPDATE jobs SET outcome_note = ? WHERE id = ?').run(b.note.trim(), id);
      // A resume that goes out takes the skills list as it is now: while its Skills line waits for the quiet after a
      // sitting of marks, this one job's line is written and printed first, with no model (lib/jobs.ts).
      // A job whose stored data cannot be read is recorded as before, and said once in the log.
      if (b.outcome !== '') { try { await refreshOneSkillsLine(id, (x) => publish(x, !STUB)); } catch (e) { console.log(`skills: the Skills line of job ${id} could not be written before it was sent: ${(e as Error).message}`); } }
      db.query("UPDATE jobs SET outcome = ?, applied_at = CASE WHEN ? = 'applied' AND (outcome != 'applied' OR ?) THEN ? WHEN ? = '' THEN 0 ELSE applied_at END WHERE id = ?").run(b.outcome, b.outcome, b.picked === true ? 1 : 0, Date.now(), b.outcome, id);
      // The version that went out is kept for good (lib/versions.ts).
      if (b.outcome !== '') keepSent(id);
      return send({ ok: true });
    },
    DELETE: (req) => { db.query('DELETE FROM jobs WHERE id = ?').run(Number(req.params.id)); return send({ ok: true }); },
  },
  // The resume as a PDF, printed when the job was read or its resume last edited; printed now if it is missing.
  '/jobs/:id/resume.pdf': {
    GET: async (req) => {
      const id = Number(req.params.id);
      let j = db.query('SELECT pdf, resume FROM jobs WHERE id = ?').get(id) as { pdf: string; resume: string } | null;
      if (!j || !j.resume) return send({ error: 'That job has no resume yet.' }, 404);
      // The PDF the owner can send takes the skills list as it is now, also while the lines wait for the quiet: this one
      // job's Skills line is written first (which drops its old PDF), with no model.
      // A job whose stored data cannot be read is served as before, and said once in the log.
      try { if (await refreshOneSkillsLine(id, async () => {})) j = db.query('SELECT pdf, resume FROM jobs WHERE id = ?').get(id) as { pdf: string; resume: string }; }
      catch (e) { console.log(`skills: the Skills line of job ${id} could not be written before its PDF: ${(e as Error).message}`); }
      if (!j.pdf || !existsSync(j.pdf)) { await publish(id); j = db.query('SELECT pdf, resume FROM jobs WHERE id = ?').get(id) as { pdf: string; resume: string }; }
      if (!j.pdf || !existsSync(j.pdf)) return send({ error: 'The PDF couldn’t be printed on the server.' }, 500);
      // Sent as a file to save, not a page to view: a phone's browser then puts it in Downloads under its own name,
      // ready to attach to an application. The name is given twice so one with accents still arrives whole.
      const name = j.pdf.split('/').pop()!.replace(/^\d+-/, '');
      const plain = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
      return new Response(Bun.file(j.pdf), { headers: { ...CORS, 'content-type': 'application/pdf', 'cache-control': 'no-store',
        'content-disposition': `attachment; filename="${plain}"; filename*=UTF-8''${encodeURIComponent(name)}` } });
    },
  },
  // Postings found on the watchlist's boards, best quick score first, and the state of the last check.
  '/leads': {
    OPTIONS: preflight,
    GET: () => {
      const d = db.query('SELECT * FROM discovery WHERE id = 1').get() as { status: string; note: string; checked_at: number };
      const names = new Map((db.query('SELECT id, name FROM companies').all() as { id: number; name: string }[]).map((c) => [c.id, c.name]));
      // One row per role: the same title at the same company in several places is shown once, with its places joined.
      const all = db.query("SELECT id, company_id, title, place, score, reason, posted_at, salary FROM leads WHERE status = 'new' AND score >= 0 ORDER BY score DESC, id DESC").all() as LeadRow[];
      const seen = new Map<string, LeadRow>();
      for (const l of all) { const k = `${l.company_id}|${l.title.trim().toLowerCase()}`, first = seen.get(k); if (first) { if (l.place && !first.place.includes(l.place)) first.place = `${first.place}; ${l.place}`; } else seen.set(k, { ...l }); }
      // The best eighty, and everything posted this week whatever its score, so the this-week filter is never cut short.
      const fresh = (l: LeadRow) => l.posted_at > 0 && Date.now() - l.posted_at <= 7 * DAY;
      // A posting whose stated range tops out under the person's own floor is left out, and counted so the list can say so.
      const floor = payFloor(), top = (salary: string) => Math.max(0, ...[...salary.matchAll(/\$(\d+)K/g)].map((m) => Number(m[1]) * 1000));
      const paid = [...seen.values()].filter((l) => floor === 0 || top(l.salary) === 0 || top(l.salary) >= floor), underPay = seen.size - paid.length;
      const merged = paid, rows = merged.filter((l, i) => i < 80 || fresh(l)).slice(0, 500);
      return send({ status: d.status, note: d.note, companies: names.size, unlisted: merged.length - rows.length, underPay, unscored: (db.query("SELECT count(*) AS n FROM leads WHERE status = 'new' AND score = -1").get() as { n: number }).n,
        checked: d.checked_at === 0 ? '' : new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(d.checked_at),
        items: rows.map((l) => ({ id: String(l.id), title: l.title, company: names.get(l.company_id) ?? '', place: l.place, score: l.score, reason: l.reason,
          salary: l.salary, posted: ago(l.posted_at), fresh: l.posted_at > 0 && Date.now() - l.posted_at <= 7 * DAY })) });
    },
  },
  '/leads/check': { OPTIONS: preflight, POST: () => checkWatchlistAgain() },
  '/leads/:id': {
    OPTIONS: preflight,
    GET: (req) => {
      const l = db.query('SELECT * FROM leads WHERE id = ?').get(Number(req.params.id)) as LeadRow | null;
      if (!l) return send({ error: 'That posting is gone.' }, 404);
      const c = db.query('SELECT name FROM companies WHERE id = ?').get(l.company_id) as { name: string } | null;
      return send({ id: String(l.id), title: l.title, company: c?.name ?? '', place: l.place, url: l.url, score: l.score, reason: l.reason, posting: l.posting, status: l.status, posted: ago(l.posted_at) });
    },
  },
  // Takes a lead up: it becomes a job and is read fully against the bank.
  '/leads/:id/read': {
    OPTIONS: preflight,
    POST: (req) => {
      const l = db.query('SELECT * FROM leads WHERE id = ?').get(Number(req.params.id)) as LeadRow | null;
      if (!l) return send({ error: 'That posting is gone.' }, 404);
      const c = db.query('SELECT name FROM companies WHERE id = ?').get(l.company_id) as { name: string } | null;
      // Already one of the person's jobs (added by its link earlier): say so, since nothing new would appear in Saved.
      if (db.query('SELECT id FROM jobs WHERE url = ? AND url != ?').get(l.url, '')) return send({ error: 'This posting is already one of your jobs. Find it on the Jobs list, or mark this one Not for Me.' }, 409);
      db.query('INSERT INTO jobs (url, posting, title, company, place, created_at, posted_at, salary) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(l.url, l.posting, l.title, c?.name ?? '', l.place, Date.now(), l.posted_at, l.salary);
      db.query("UPDATE leads SET status = 'promoted' WHERE id = ?").run(l.id);
      return send({ ok: true });
    },
  },
  '/leads/:id/dismiss': {
    OPTIONS: preflight,
    POST: (req) => { db.query("UPDATE leads SET status = 'dismissed' WHERE id = ?").run(Number(req.params.id)); return send({ ok: true }); },
  },
  '/companies': {
    OPTIONS: preflight,
    GET: () => send((db.query("SELECT c.*, (SELECT count(*) FROM leads l WHERE l.company_id = c.id AND l.status = 'new') AS open FROM companies c ORDER BY c.name COLLATE NOCASE").all() as (CompanyRow & { open: number })[])
      .map((c) => ({ id: String(c.id), name: c.name, board: `${c.ats === 'greenhouse' ? 'Greenhouse' : c.ats === 'lever' ? 'Lever' : 'Ashby'}, ${c.token}`, open: c.open, note: c.note }))),
    // A company is added by the link to its careers board; the board is read once to prove it is there.
    POST: async (req) => {
      const b = await req.json().catch(() => ({})), board = parseBoard(str(b.link));
      if (!board) return send({ error: 'Paste a link to the company’s job board on Greenhouse, Lever or Ashby (boards.greenhouse.io, jobs.lever.co or jobs.ashbyhq.com).' }, 400);
      if (db.query('SELECT id FROM companies WHERE ats = ? AND token = ?').get(board.ats, board.token)) return send({ error: 'That company is already on your watchlist.' }, 409);
      if (!process.argv.includes('--stub-github')) { try { await fetchBoard(board.ats, board.token); } catch (e) { return send({ error: `Couldn’t read that board. ${(e as Error).message}` }, 409); } }
      const name = str(b.name) || board.token.replace(/[-_.]+/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
      db.query('INSERT INTO companies (name, ats, token) VALUES (?, ?, ?)').run(name, board.ats, board.token);
      return send({ ok: true }, 201);
    },
  },
  '/companies/:id': {
    OPTIONS: preflight,
    DELETE: (req) => {
      const id = Number(req.params.id);
      db.query("DELETE FROM leads WHERE company_id = ? AND status IN ('new', 'closed', 'dismissed')").run(id);
      db.query('DELETE FROM companies WHERE id = ?').run(id);
      return send({ ok: true });
    },
  },
  '/jobs/:id/outreach': { OPTIONS: preflight, POST: (req) => draftMessagesAgain(Number(req.params.id)) },
  '/jobs/:id/read': { OPTIONS: preflight, POST: (req) => readJobAgain(Number(req.params.id)) },
  // A test server only (--stub-github): a job as the worker would leave it, for trying the screens without a model.
  ...(STUB ? { '/jobs/:id/result': {
    OPTIONS: preflight,
    POST: async (req: Request & { params: { id: string } }) => {
      const b = await req.json().catch(() => ({}));
      const reqs = weigh(Array.isArray(b.requirements) ? b.requirements : [], db.query('SELECT * FROM roles').all() as RoleRow[], Date.now());
      setResume(Number(req.params.id), str(b.resume), null, 'written', 'Written for this posting.', { set: { status: 'done', note: '', title: str(b.title), company: str(b.company), place: str(b.place), fit: fitOf(reqs),
        analysis: JSON.stringify({ verdict: str(b.verdict), requirements: reqs, strengths: b.strengths ?? [], risks: b.risks ?? [], changes: b.changes ?? [], gaps: b.gaps ?? [], knockouts: b.knockouts ?? [],
          terms: termsOf(Array.isArray(b.terms) ? b.terms : [], str(b.resume), ''), checks: b.checks ?? [] }), bank_sig: bankSignature(), updated_at: Date.now() } });
      return send({ ok: true });
    },
  } } : {}),
  '/inbox': { OPTIONS: preflight, GET: () => send({ folder: INBOX, files: inbox() }) },
  '/roles': {
    OPTIONS: preflight,
    // {title, company} or {line: "title at employer"}, with start and end or when, employment and location if given.
    POST: async (req) => { const d = addRole(await req.json().catch(() => ({}))); if (d.ok && d.wrote) follow(); return done(d, 201); },
  },
  // What kind of work a role or project was: the person's own word, used to weigh it as evidence. And what the
  // person says so the role's dates read true on a resume: an end date, a one-line context note, a label.
  // standing, reach and partOf go together, as before. end, note and label are each optional and may be sent alone.
  '/roles/:id': {
    OPTIONS: preflight,
    // A changed role can settle a question about the timeline, or raise one, and changes the flags that read it.
    PATCH: async (req) => { const d = patchRole(Number(req.params.id), await req.json().catch(() => ({}))); if (d.ok && d.wrote) follow(); return done(d); },
    // Its own projects and its facts go with it; a repository's project group filed under it stays, not placed.
    DELETE: (req) => { const d = deleteRole(Number(req.params.id)); if (d.ok && d.wrote) follow(); return done(d); },
  },
  // Suggested projects (lib/propose.ts): asked for on a role, read on it, and decided one by one.
  '/roles/:id/propose': {
    OPTIONS: preflight,
    // It takes no body; one sent must be a JSON object.
    POST: async (req) => {
      const raw = (await req.text()).trim();
      if (raw !== '') { let b: unknown = null; try { b = JSON.parse(raw); } catch { /* not JSON */ } if (b === null || typeof b !== 'object' || Array.isArray(b)) return send({ error: NOT_OBJECT }, 400); }
      const refused = /^\d+$/.test(req.params.id) ? askFor(Number(req.params.id)) : 'That role is no longer in your record.';
      return refused ? send({ error: refused }, 409) : send({ ok: true });
    },
  },
  '/roles/:id/proposals': {
    OPTIONS: preflight,
    GET: (req) => send({ proposals: /^\d+$/.test(req.params.id) ? proposalsOf(Number(req.params.id)) : [] }),
  },
  // {keep: true, title?, facts?} keeps it (edited, with the owner's title and facts); {reject: true} says it is not a
  // project; {result: "use" | "decline"} decides a kept project's suggested result.
  '/proposals/:id': {
    OPTIONS: preflight,
    POST: async (req) => {
      if (!/^\d+$/.test(req.params.id)) return send({ error: 'That suggestion is no longer there.' }, 404);
      const b = await objectBody(req), id = Number(req.params.id), now = Date.now();
      if (!b) return send({ error: NOT_OBJECT }, 400);
      const d: Decided = b.keep === true ? keepProposal(id, { ...(typeof b.title === 'string' ? { title: b.title } : {}), ...(Array.isArray(b.facts) ? { facts: b.facts } : {}) }, now)
        : b.reject === true ? rejectProposal(id, now)
        : b.result === 'use' || b.result === 'decline' ? decideResult(id, b.result === 'use', now)
        : { ok: false, error: 'Say keep, reject, or what to do with the result.', status: 400 };
      if (!d.ok) return send({ error: d.error }, d.status);
      follow();
      return send({ ok: true, ...(d.project ? { project: String(d.project) } : {}) });
    },
  },
  // A verdict on a line of "How you work" (lib/derived.ts): kept, rejected, or '' to take it back.
  '/derived/:key': {
    OPTIONS: preflight,
    POST: async (req) => {
      const b = await objectBody(req);
      if (!b) return send({ error: NOT_OBJECT }, 400);
      let key: string;
      // Read from the path as sent: Bun's own decoding of the name turns a broken escape into U+FFFD, and decoding its
      // result again would break a name with a % in it ("cut costs by 20%").
      try { key = decodeURIComponent(new URL(req.url).pathname.slice('/derived/'.length)); } catch { return send({ error: 'That line’s name could not be read.' }, 400); }
      const refused = judge(derivedNow(), key, typeof b.verdict === 'string' ? b.verdict : 'none', Date.now());
      return refused ? send({ error: refused }, 400) : send({ ok: true });
    },
  },
  // Projects (lib/record.ts): {title, roleId | side | newRole, when or start and end, and the parts}.
  '/projects': {
    OPTIONS: preflight,
    POST: async (req) => { const d = addProject(await req.json().catch(() => ({}))); if (d.ok && d.wrote) follow(); return done(d, 201); },
  },
  '/projects/:id': {
    OPTIONS: preflight,
    PATCH: async (req) => { const d = patchProject(Number(req.params.id), await req.json().catch(() => ({}))); if (d.ok && d.wrote) follow(); return done(d); },
    // ?facts=keep (the default) keeps its facts, back in Day to day (or General); ?facts=delete deletes them too.
    DELETE: (req) => { const d = deleteProject(Number(req.params.id), new URL(req.url).searchParams.get('facts') === 'delete' ? 'delete' : 'keep'); if (d.ok && d.wrote) follow(); return done(d); },
  },
  // The skills list (lib/skills.ts): each skill the bank names, what kind of thing it is, and the person's mark.
  // Only a tool, language or platform the person stands behind goes on a resume.
  '/skills': {
    OPTIONS: preflight,
    GET: () => {
      syncSkills(Date.now());
      const isReviewed = reviewed(), view = skillsView();
      // The list as the Skills screen draws it (lib/skillsview.ts): when it was reviewed, how many skills are new since,
      // and the skills in their groups, each with its facts and roles. `skills` is the plain list, as before.
      // due: unsent resumes' Skills lines are behind the list until the worker writes them, after a quiet (lib/jobs.ts).
      const due = skillsDue();
      return send({ reviewed: isReviewed, reviewedAt: reviewedOn(), reviewedOn: view.reviewedOn, newCount: view.newCount, due: due.due, dueLine: due.line, cap: CAP, groups: view.groups,
        skills: allSkills().map((s) => ({ name: s.name, kind: s.kind, mark: s.mark, facts: s.facts, shown: allowed(s, isReviewed) })) });
    },
    // Marks for many skills at once: {marks: [{name, mark?, kind?}], reviewed?}. Marking alone is not a review and
    // changes no stored resume. The list counts as reviewed only when "reviewed" is true, and that is refused (400,
    // nothing saved) while no tool, language or platform is marked confident, because a reviewed list shows only those.
    POST: async (req) => {
      const b = await objectBody(req);
      if (!b) return send({ error: NOT_OBJECT }, 400);
      if (!Array.isArray(b.marks)) return send({ error: 'Send the skills to mark.' }, 400);
      syncSkills(Date.now());
      // A mark for a skill Home asks about is that question's answer, so Home and the Skills screen agree.
      const got = markFromList(b.marks, b.reviewed === true, Date.now());
      if (got.refused) return send({ error: got.refused }, 400);
      // Once the list is reviewed, resumes not yet sent take their Skills line from it, with no model; one the person
      // edited is left as it is. That is done once a sitting of marks is over (lib/jobs.ts, refreshDueSkills, run by the
      // worker), so here a change only records that the lines are due. Before the review nothing is due.
      if (got.changed > 0 || b.reviewed === true) skillsChanged(Date.now());
      follow();
      return send({ ok: true, marked: got.marked, reviewed: reviewed(), due: skillsDue().due });
    },
  },
  // The questions code raised for the person from their own data (lib/raised.ts): job dates, LinkedIn differences,
  // new skills. Each has a stable key, and the choices the person may give. "inputs" says, choice by choice, what
  // must be sent with it: "month" (YYYY-MM), "line" (one line of text) or "" (nothing).
  '/questions': {
    OPTIONS: preflight,
    GET: () => { follow(); return send({ questions: openRaised().map((q) => ({ key: q.key, kind: q.kind, text: q.text, choices: q.choices, about: q.about, inputs: inputsOf(q) })) }); },
    // An answer: the question's key, the number of the choice (from 0), the words of that choice as the person saw them
    // (`text`; required, and checked against the choice at that place now), and the value that choice needs, if any.
    POST: async (req) => {
      const b = await req.json().catch(() => ({}));
      const kind = raisedByKey(str(b.key))?.kind ?? '';
      const refused = answer(str(b.key), Number(b.choice), str(b.value), Date.now(), typeof b.text === 'string' ? b.text : undefined);
      if (refused) return send({ error: refused }, 400);
      // Only an answer about a skill changes the skills list, so only that one makes the Skills lines due (lib/jobs.ts).
      if (kind === 'skill') skillsChanged(Date.now());
      follow();
      return send({ ok: true });
    },
  },
  // Home's list: everything that needs the person, in order (lib/queue.ts), and how many items are snoozed.
  '/queue': {
    OPTIONS: preflight,
    GET: () => { follow(); return send(queue(Date.now())); },
  },
  // Hides one item of the list until a time: {key, until?} (ms since 1970; default a day from now).
  '/queue/snooze': {
    OPTIONS: preflight,
    POST: async (req) => {
      const b = await req.json().catch(() => ({}));
      if (!str(b.key)) return send({ error: 'Choose an item to snooze.' }, 400);
      if (b.until !== undefined && typeof b.until !== 'number') return send({ error: 'Choose a time later than now.' }, 400);
      const refused = snooze(str(b.key), b.until, Date.now());
      return refused ? send({ error: refused }, 400) : send({ ok: true });
    },
  },
  // Slow work (lib/activity.ts): what waits, runs, failed and finished, and what finished since the owner last looked.
  '/activity': { OPTIONS: preflight, GET: () => send(activity(Date.now(), bankSignature)) },
  // The owner has seen the digest up to {at}, the end time of the latest line drawn: it is not announced again.
  '/activity/seen': {
    OPTIONS: preflight,
    POST: async (req) => {
      const b = await req.json().catch(() => ({}));
      const refused = markSeen(typeof b.at === 'number' ? b.at : NaN, Date.now());
      return refused ? send({ error: refused }, 400) : send({ ok: true });
    },
  },
  // A failed piece of work, asked for again by the same path its screen uses.
  '/activity/:id/retry': {
    OPTIONS: preflight,
    POST: (req) => {
      if (!/^\d+$/.test(req.params.id)) return send({ error: 'Say which piece of work, by its number.' }, 400);
      const row = failedRow(Number(req.params.id));
      if (!row) return send({ error: 'This work has already been tried again or put away.' }, 404);
      const again = AGAIN[row.kind];
      return again ? again(row.subject) : send({ error: 'Send your message again in Talk.' }, 409);
    },
  },
  // Puts a failed piece of work out of view. Nothing else changes.
  '/activity/:id/dismiss': {
    OPTIONS: preflight,
    POST: (req) => (!/^\d+$/.test(req.params.id) ? send({ error: 'Say which piece of work, by its number.' }, 400)
      : dismiss(Number(req.params.id), Date.now()) ? send({ ok: true }) : send({ error: 'This work has already been tried again or put away.' }, 404)),
  },
  // A test server only: stores proposals for a role as the worker would after its model request ({roleId, projects}),
  // through the same checks, with no model.
  ...(STUB ? { '/test/proposals': { OPTIONS: preflight, POST: async (req: Request) => {
    const b = await req.json().catch(() => ({})), roleId = Number(b.roleId);
    if (!Number.isInteger(roleId) || !db.query('SELECT id FROM roles WHERE id = ?').get(roleId)) return send({ error: 'No such role.' }, 404);
    const r = requestFor(roleId);
    return send({ ok: true, stored: storeProposals(roleId, checkProposals({ projects: b.projects }, r.facts, [...r.projects, ...r.rejected]), Date.now()) });
  } } } : {}),
  // A test server only: the worker's pass over due Skills lines, as if the quiet were over, with no printing.
  ...(STUB ? { '/test/skills-due': { OPTIONS: preflight, POST: async () => send({ ok: true, written: await refreshDueSkills(Date.now() + SKILLS_QUIET_MS, async () => {}) }) } } : {}),
  // A test server only: moves a piece of work as the worker would ({kind, id, to, note, stage, resume}), with no model.
  ...(STUB ? { '/test/work': { OPTIONS: preflight, POST: async (req: Request) => {
    const b = await req.json().catch(() => ({}));
    const refused = stubStep(str(b.kind) as Kind, Number(b.id), str(b.to), str(b.note), str(b.stage), typeof b.resume === 'string' ? b.resume : '');
    return refused ? send({ error: refused }, 400) : send({ ok: true });
  } } } : {}),
  '/facts': {
    OPTIONS: preflight,
    // A fact written by hand (or by a test) is the person's own word: confirmed unless it says otherwise. It goes in a
    // project ({projectId}), a role's Day to day ({roleId}), a role made on the spot ({newRole}), or General.
    POST: async (req) => { const d = addFact(await req.json().catch(() => ({}))); if (d.ok && d.wrote) follow(); return done(d, 201); },
  },
  '/facts/:id': {
    OPTIONS: preflight,
    // One fact whole: its story, evidence and where it came from.
    GET: (req) => { const f = fullFact(Number(req.params.id)); return f ? send(f) : send({ error: 'That fact is no longer in your record.' }, 404); },
    // The person's own wording for a fact, and where it is filed: a later re-read of its source leaves it alone.
    // text, detail and metric are each their own field: one sent alone changes only itself.
    PATCH: async (req) => { const d = patchFact(Number(req.params.id), await req.json().catch(() => ({}))); if (d.ok && d.wrote) follow(); return done(d); },
    DELETE: (req) => { const d = removeFact(Number(req.params.id)); if (d.ok && d.wrote) follow(); return done(d); },
  },
  '/sources': {
    OPTIONS: preflight,
    GET: () => send(sources()),
    POST: async (req) => {
      const b = await req.json().catch(() => ({})), kind = str(b.kind), body = str(b.body);
      if (!['text', 'file', 'repo'].includes(kind)) return send({ error: 'Choose what to add.' }, 400);
      if (!body) return send({ error: kind === 'text' ? 'Paste the text to read.' : kind === 'file' ? 'Choose a file.' : 'Enter the repository’s path.' }, 400);
      if (kind === 'repo' && !str(b.author)) return send({ error: 'Enter the name or email your commits use.' }, 400);
      if (kind === 'file' && !inbox().includes(body)) return send({ error: `${body} isn’t waiting in the inbox folder.` }, 409);
      if (kind === 'repo' && db.query("SELECT id FROM sources WHERE kind = 'repo' AND body = ?").get(body)) return send({ error: 'That repository is already a source. Read it again from its page.' }, 409);
      const title = str(b.title) || (kind === 'text' ? 'Pasted text' : body.replace(/\/+$/, '').split('/').pop()!);
      db.query('INSERT INTO sources (kind, title, body, author, created_at) VALUES (?, ?, ?, ?, ?)').run(kind, title, body, str(b.author), Date.now());
      return send({ ok: true }, 201);
    },
  },
  // A file picked in the app: its bytes are the body, its name the query. It is kept in the inbox and queued.
  '/sources/upload': {
    OPTIONS: preflight,
    POST: async (req) => {
      const wanted = str(new URL(req.url).searchParams.get('name'));
      const ext = extname(wanted).toLowerCase();
      if (ext !== '.zip' && !READABLE.includes(ext)) return send({ error: `${ext ? `${ext} files` : 'Files with no extension'} can’t be read. Add a PDF, Word or text file.` }, 415);
      const bytes = await req.arrayBuffer();
      if (bytes.byteLength === 0) return send({ error: 'That file is empty.' }, 400);
      if (bytes.byteLength > MAX_UPLOAD) return send({ error: 'That file is over 25 MB. Add a smaller one.' }, 413);
      if (ext === '.zip') {
        const text = await linkedinText(bytes);
        if (text === undefined) return send({ error: 'That zip isn’t a LinkedIn data export. Unzip it and add the files inside.' }, 415);
        db.query('INSERT INTO sources (kind, title, body, author, created_at) VALUES (?, ?, ?, ?, ?)').run('text', 'LinkedIn export', text, '', Date.now());
        return send({ ok: true }, 201);
      }
      const name = inboxName(wanted);
      await Bun.write(join(INBOX, name), bytes);
      db.query('INSERT INTO sources (kind, title, body, author, created_at) VALUES (?, ?, ?, ?, ?)').run('file', name, name, '', Date.now());
      return send({ ok: true }, 201);
    },
  },
  '/sources/:id/read': { OPTIONS: preflight, POST: (req) => readSourceAgain(Number(req.params.id)) },
  '/sources/:id': {
    OPTIONS: preflight,
    // Its facts go with it, except the ones the person edited, which stay in the bank.
    DELETE: (req) => {
      const id = Number(req.params.id);
      db.query("DELETE FROM facts WHERE source_id = ? AND status = 'proposed'").run(id);
        db.query('DELETE FROM sources WHERE id = ?').run(id);
      return send({ ok: true });
    },
  },
} });
console.log(`server.ts: http://${hostname}:${served.port}`);
