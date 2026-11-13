// Finding jobs: the public job boards of companies on the watchlist (Greenhouse, Lever and Ashby
// each publish a company's open postings as JSON, no sign-in), filtered to the kind of role and
// place the person wants, then given a quick first score against their profile. A lead is only a
// lead: its real fit comes from reading it fully as a job (lib/jobs.ts).
import { db } from './db.ts';
import { ask } from './llm.ts';
import { direction } from './direction.ts';
import { TARGETS } from './profile.ts';
import { nearby } from './place.ts';

export type Ats = 'greenhouse' | 'lever' | 'ashby';
export type Posting = { ext: string; title: string; place: string; url: string; text: string; posted: number; salary: string };
export type CompanyRow = { id: number; name: string; ats: Ats; token: string; checked_at: number; note: string };
export type LeadRow = { id: number; company_id: number; ext: string; title: string; place: string; url: string; posting: string; score: number; reason: string; status: string; first_seen: number; posted_at: number; salary: string };

const strip = (h: string) => h.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&rsquo;/g, '’').replace(/&nbsp;/g, ' ')
  .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr)>/gi, '\n').replace(/<li[^>]*>/gi, '- ').replace(/<[^>]+>/g, ' ')
  .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();

// A pay range as a posting's text states it ("$184,000 - $219,000", "$184K to $219K"), written one way: "$184K – $219K". '' when none.
export function salaryIn(text: string): string {
  const m = text.match(/\$\s?(\d{2,3})(?:[,.]?(\d{3}))?\s?([kK])?(?:\s?(?:USD|per year|\/\s?yr|\/\s?year|a year))?\s?(?:-|–|—|to)\s?\$?\s?(\d{2,3})(?:[,.]?(\d{3}))?\s?([kK])?/);
  if (!m) return '';
  const k = (a: string, thousands: string | undefined, kk: string | undefined) => (thousands || kk ? Number(a) : Number(a) >= 1000 ? Math.round(Number(a) / 1000) : Number(a));
  const lo = k(m[1], m[2], m[3] ?? m[6]), hi = k(m[4], m[5], m[6] ?? m[3]);
  return lo >= 30 && hi >= lo && hi <= 999 ? `$${lo}K – $${hi}K` : '';
}
const when = (v: unknown) => { const t = typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) : NaN; return Number.isFinite(t) ? t : 0; };

// A careers link or a bare board name, as the watchlist form takes it.
export function parseBoard(input: string): { ats: Ats; token: string } | undefined {
  const s = input.trim();
  const m = s.match(/greenhouse\.io\/(?:embed\/job_board\?for=)?([\w-]+)/i) ?? null;
  if (m && !/boards-api/.test(s)) return { ats: 'greenhouse', token: m[1] };
  const g = s.match(/boards-api\.greenhouse\.io\/v1\/boards\/([\w-]+)/i); if (g) return { ats: 'greenhouse', token: g[1] };
  const l = s.match(/lever\.co\/(?:v0\/postings\/)?([\w-]+)/i); if (l) return { ats: 'lever', token: l[1] };
  const a = s.match(/ashbyhq\.com\/(?:posting-api\/job-board\/)?([\w.-]+)/i); if (a) return { ats: 'ashby', token: a[1] };
  return undefined;
}

export async function fetchBoard(ats: Ats, token: string): Promise<Posting[]> {
  const url = ats === 'greenhouse' ? `https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`
    : ats === 'lever' ? `https://api.lever.co/v0/postings/${token}?mode=json` : `https://api.ashbyhq.com/posting-api/job-board/${token}?includeCompensation=true`;
  const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(res.status === 404 ? 'No public job board by that name.' : `The job board answered ${res.status}.`);
  const d = (await res.json()) as any;
  if (ats === 'greenhouse') return (d.jobs ?? []).map((j: any) => ({ ext: String(j.id), title: String(j.title ?? ''), place: String(j.location?.name ?? ''), url: String(j.absolute_url ?? ''), text: strip(String(j.content ?? '')),
    posted: when(j.first_published ?? j.updated_at), salary: salaryIn(strip(String(j.content ?? ''))) }));
  if (ats === 'lever') return (Array.isArray(d) ? d : []).map((j: any) => ({ ext: String(j.id), title: String(j.text ?? ''), place: [j.categories?.location, j.workplaceType].filter(Boolean).join(', '), url: String(j.hostedUrl ?? ''),
    text: [j.descriptionPlain, ...(j.lists ?? []).map((x: any) => `${x.text}\n${strip(String(x.content ?? ''))}`), j.additionalPlain].filter(Boolean).join('\n\n'), posted: when(j.createdAt),
    salary: j.salaryRange?.min && j.salaryRange?.max ? `$${Math.round(j.salaryRange.min / 1000)}K – $${Math.round(j.salaryRange.max / 1000)}K` : salaryIn(String(j.additionalPlain ?? '') + ' ' + String(j.descriptionPlain ?? '')) }));
  return (d.jobs ?? []).filter((j: any) => j.isListed !== false).map((j: any) => ({ ext: String(j.id), title: String(j.title ?? ''), place: [j.location, j.isRemote ? 'Remote' : ''].filter(Boolean).join(', '), url: String(j.jobUrl ?? ''),
    text: String(j.descriptionPlain ?? strip(String(j.descriptionHtml ?? ''))), posted: when(j.publishedAt),
    salary: salaryIn(String(j.compensation?.scrapeableCompensationSalarySummary ?? j.compensation?.compensationTierSummary ?? '')) || salaryIn(String(j.descriptionPlain ?? '')) }));
}

// The first sieve, by title and place alone, so no model reads a posting that could not suit.
// Engineering roles at senior level or unlabelled, in a place the person could work from (lib/place.ts).
const WANT = /engineer|developer|architect|technical lead|tech lead|solutions|forward.deployed|founding|cto\b|head of engineering/i;
const SKIP = /\bintern\b|internship|new grad|university|junior|\bjr\b|associate\b|apprentice|recruit|sales (?!engineer)|account (executive|manager)|marketing|designer|counsel|attorney|accountant|hardware|mechanical|electrical|firmware|embedded|\bios\b|android|security clearance|data scientist|research scientist|\bml research|site reliability|\bsre\b|network engineer|support engineer|\bqa\b|test engineer|manager,? (?!engineering)|director of (?!engineering)/i;
export const suits = (p: { title: string; place: string }) => WANT.test(p.title) && !SKIP.test(p.title) && nearby(p.place);

// Which suited postings get a quick score first: titles in the role families the person named, then
// senior general engineering. Only the first few per company are scored, so a company with hundreds
// of openings cannot crowd out the rest.
export const priority = (title: string) =>
  (/forward.deployed|solutions (engineer|architect)|founding|deployed engineer|customer engineer|field engineer|implementation engineer/i.test(title) ? 4 : 0)
  + (/tech(nical)? lead|lead engineer|staff|principal|engineering manager|head of engineering/i.test(title) ? 3 : 0)
  + (/product engineer|full.?stack|front.?end|applied ai|ai engineer|agent/i.test(title) ? 2 : 0)
  + (/senior|sr\.?\b/i.test(title) ? 1 : 0);
export const PER_COMPANY = 10, PER_RUN = 300;

// Reads every watchlisted board, keeps what suits, and scores the most promising unscored leads.
// Returns a line saying what it found.
export async function discover(now: number, score = true): Promise<string> {
  const companies = db.query('SELECT * FROM companies ORDER BY id').all() as CompanyRow[];
  if (companies.length === 0) throw new Error('The watchlist is empty. Add a company first.');
  let found = 0, failed = 0;
  for (const c of companies) {
    try {
      const postings = (await fetchBoard(c.ats, c.token)).filter(suits);
      const open = new Set(postings.map((p) => p.ext));
      for (const p of postings) {
        const had = db.query('SELECT id FROM leads WHERE company_id = ? AND ext = ?').get(c.id, p.ext) as { id: number } | null;
        if (had) db.query('UPDATE leads SET posted_at = ?, salary = ? WHERE id = ?').run(p.posted, p.salary, had.id);
        if (!had) { db.query('INSERT INTO leads (company_id, ext, title, place, url, posting, first_seen, posted_at, salary) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(c.id, p.ext, p.title, p.place, p.url, p.text.slice(0, 40_000), now, p.posted, p.salary); found++; }
      }
      // A posting that left the board is closed, unless the person already took it up.
      for (const l of db.query("SELECT id, ext FROM leads WHERE company_id = ? AND status = 'new'").all(c.id) as { id: number; ext: string }[]) if (!open.has(l.ext)) db.query("UPDATE leads SET status = 'closed' WHERE id = ?").run(l.id);
      db.query("UPDATE companies SET checked_at = ?, note = '' WHERE id = ?").run(now, c.id);
    } catch (e) { failed++; db.query('UPDATE companies SET note = ? WHERE id = ?').run((e as Error).message, c.id); }
  }
  const names = new Map(companies.map((c) => [c.id, c.name]));
  if (!score) return `${found} new ${found === 1 ? 'posting' : 'postings'} across ${companies.length} companies; none scored${failed ? `; ${failed} could not be read` : ''}.`;
  // Recent postings first: one from the last two weeks is scored before any older one, whatever its title.
  const recent = (l: LeadRow) => (l.posted_at > now - 14 * 86_400_000 ? 1 : 0);
  const waiting = (db.query("SELECT * FROM leads WHERE status = 'new' AND score = -1").all() as LeadRow[]).sort((a, b) => recent(b) - recent(a) || priority(b.title) - priority(a.title) || b.posted_at - a.posted_at);
  const taken = new Map<number, number>(), pick: LeadRow[] = [];
  for (const l of waiting) { const n = taken.get(l.company_id) ?? 0; if (n < PER_COMPANY && pick.length < PER_RUN) { pick.push(l); taken.set(l.company_id, n + 1); } }
  // Batches of 25, four at a time, each saved as it returns so a stopped run keeps what it scored.
  const batches: LeadRow[][] = [];
  for (let i = 0; i < pick.length; i += 25) batches.push(pick.slice(i, i + 25));
  let scoredCount = 0;
  const run = async (): Promise<void> => {
    const batch = batches.shift();
    if (!batch) return;
    try {
      for (const s of await triage(batch, names)) { db.query('UPDATE leads SET score = ?, reason = ? WHERE id = ?').run(s.score, s.reason, s.id); scoredCount++; }
    } catch (e) { console.log(`  a batch could not be scored: ${(e as Error).message}`); }
    return run();
  };
  await Promise.all([run(), run(), run(), run()]);
  const scored = { length: scoredCount };
  return `${found} new ${found === 1 ? 'posting' : 'postings'} across ${companies.length} companies; ${scored.length} scored${failed ? `; ${failed} ${failed === 1 ? 'board' : 'boards'} could not be read` : ''}.`;
}

const SCHEMA = { type: 'object', additionalProperties: false, required: ['leads'], properties: { leads: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'score', 'reason'],
  properties: { id: { type: 'number' }, score: { type: 'number' }, reason: { type: 'string' } } } } } };

// What happened with the jobs the person already tried: the only real signal of what works for them.
function history(): string {
  const rows = db.query("SELECT title, company, fit, outcome, outcome_note FROM jobs WHERE outcome != ''").all() as { title: string; company: string; fit: number; outcome: string; outcome_note: string }[];
  return rows.length === 0 ? 'None recorded yet.' : rows.map((r) => `- ${r.title} at ${r.company} (fit ${r.fit}): ${r.outcome}${r.outcome_note ? `. ${r.outcome_note}` : ''}`).join('\n');
}

// A quick score for each lead, from the profile and the posting's opening, in batches.
export async function triage(leads: LeadRow[], companyOf: Map<number, string>): Promise<{ id: number; score: number; reason: string }[]> {
  const profile = (db.query('SELECT body FROM profile WHERE id = 1').get() as { body: string }).body;
  if (profile.trim() === '') throw new Error('Write the profile first: leads are scored against it.');
  const out: { id: number; score: number; reason: string }[] = [];
  for (let i = 0; i < leads.length; i += 25) {
    const batch = leads.slice(i, i + 25);
    const r = await ask<{ leads: { id: number; score: number; reason: string }[] }>({ cwd: process.cwd(), schema: SCHEMA, timeoutMs: 10 * 60_000, model: process.env.EGG_TRIAGE_MODEL ?? 'sonnet',
      prompt: `You are sorting job postings for one person, to decide which are worth a careful read. Score each from 0 to 100 for how well the person's actual experience fits what the posting asks, and how likely an application is to reach an interview.

Be discriminating: most postings should land between 20 and 70. Score high only when the posting's central requirements are things the profile shows in paid, production work. Score low when it centres on a specialty the profile lacks, asks for much more seniority or a different discipline, or the domain is far from anything they have done. A familiar domain counts: the profile's industries and products are an advantage where a posting shares them.

"reason" is one plain sentence naming the main thing that helps and the main thing that hurts. It is shown to the person, so address them as "you" and never as "he" or "she".

The person is looking for: ${TARGETS.list.join('; ')}.${direction() ? `\n\nTheir own notes on their direction, including the fit test they apply to a listing. Weigh a posting against it: one that passes their fit test should score higher than one that only matches skills.\n<direction>\n${direction()}\n</direction>` : ''}

What happened with jobs they already tried (weigh this: it shows where their profile gets traction):
${history()}

Their profile:
${profile.slice(0, 14_000)}

The postings, as JSON (text is the opening of each):
${JSON.stringify(batch.map((l) => ({ id: l.id, company: companyOf.get(l.company_id) ?? '', title: l.title, place: l.place, text: l.posting.slice(0, 1800) })))}` });
    const known = new Set(batch.map((l) => l.id));
    out.push(...r.leads.filter((x) => known.has(x.id)).map((x) => ({ id: x.id, score: Math.max(0, Math.min(100, Math.round(x.score))), reason: x.reason.trim() })));
  }
  return out;
}
