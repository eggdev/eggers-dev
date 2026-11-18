// The versions of a job's resume text, and the one path that writes it (rule 7, "The resume is the screen").
// setResume is the only code that writes `jobs.resume` (a test reads the sources to hold that). In one immediate
// transaction it checks its guard, writes the text, its links and the other columns its caller names, and, when the text
// changed, adds a version: a letter (A, B, … Z, AA) with why it was made and a reason in plain words. So one letter is
// one text and one PDF. A Save that changes nothing makes no letter.
//
// Nothing is written at a start: a resume with no row is version A by rule. Its first change stores the text as it
// stood as A (with no date), then the new one as B. A version is never changed or deleted, except with its job.
import { db } from './db.ts';
import { storeLinks, type Links } from './links.ts';

export type Why = 'written' | 'edited' | 'skills' | 'details' | 'suggestion' | 'undo';
export type Version = { job_id: number; n: number; letter: string; sig: string; resume: string; links: string; why: Why; reason: string; pages: number; made_at: number; sent: number };
// How many of the newest versions a job keeps, besides A and every version that went out (about 8 KB each).
export const KEEP_VERSIONS = 20;

// 1 is A, 26 is Z, 27 is AA.
export function letter(n: number): string {
  let s = '';
  for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(65 + ((k - 1) % 26)) + s;
  return s;
}
const sig = (text: string) => new Bun.CryptoHasher('sha256').update(text.trim()).digest('hex').slice(0, 16);
export const STANDING_REASON = 'As it stood before versions were kept.';

// The columns a caller may set beside the text, in the same write. Anything else is refused.
const COLUMNS = new Set(['analysis', 'edited', 'bank_sig', 'updated_at', 'pdf', 'status', 'note', 'title', 'company', 'place', 'fit']);
type Cur = { resume: string; links: string; edited: number; pages: number };
const current = (jobId: number) => db.query('SELECT resume, links, edited, pages FROM jobs WHERE id = ?').get(jobId) as Cur | null;

// The text as it stands kept as A, when the job has no version yet and has a text. Inside a transaction.
function standing(jobId: number, cur: Cur): void {
  if (cur.resume.trim() === '' || db.query('SELECT 1 FROM resume_versions WHERE job_id = ? LIMIT 1').get(jobId)) return;
  db.query('INSERT OR IGNORE INTO resume_versions (job_id, n, sig, resume, links, why, reason, pages, made_at) VALUES (?, 1, ?, ?, ?, ?, ?, ?, 0)')
    .run(jobId, sig(cur.resume), cur.resume, cur.links, cur.edited === 1 ? 'edited' : 'written', STANDING_REASON, cur.pages);
}

// Writes a job's resume text: the only code that does. `links` is the text's links, null for none, or 'same' to leave
// them as they are (a change that touches no linked line: the header, the Skills line). `guard` writes only while the
// stored text is still `resume` (and `edited` is still that value, when given). `set` names other columns of the same
// write. False when the job is gone or the guard did not hold; then nothing is written.
export function setResume(jobId: number, text: string, links: Links | null | 'same', why: Why, reason: string,
  opts: { guard?: { resume: string; edited?: number }; set?: Record<string, string | number> } = {}): boolean {
  const set = opts.set ?? {};
  for (const k of Object.keys(set)) if (!COLUMNS.has(k)) throw new Error(`setResume cannot set the column “${k}”.`);
  return db.transaction(() => {
    const cur = current(jobId);
    if (!cur) return false;
    if (opts.guard && (cur.resume !== opts.guard.resume || (opts.guard.edited !== undefined && cur.edited !== opts.guard.edited))) return false;
    const stored = links === 'same' ? cur.links : storeLinks(links);
    const cols = ['resume = ?', 'links = ?', ...Object.keys(set).map((k) => `${k} = ?`)];
    db.query(`UPDATE jobs SET ${cols.join(', ')} WHERE id = ?`).run(text, stored, ...Object.values(set), jobId);
    if (text !== cur.resume) {
      standing(jobId, cur);
      const n = (db.query('SELECT coalesce(max(n), 0) AS n FROM resume_versions WHERE job_id = ?').get(jobId) as { n: number }).n + 1;
      db.query('INSERT INTO resume_versions (job_id, n, sig, resume, links, why, reason, pages, made_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(jobId, n, sig(text), text, stored, why, reason, cur.pages, Date.now());
      // Kept: A, the newest KEEP_VERSIONS and every version that went out. Letters are never reused: n keeps counting.
      db.query('DELETE FROM resume_versions WHERE job_id = ? AND n > 1 AND sent = 0 AND n <= ?').run(jobId, n - KEEP_VERSIONS);
    }
    if (text !== cur.resume || why === 'written') staleAfter(jobId, text, why);
    return true;
  }).immediate();
}

// A suggestion still open on a text that changed (lib/suggest.ts) goes stale when its line no longer stands once, or when
// the resume was written again: it is then never shown, and cannot be kept. Inside setResume's transaction.
function staleAfter(jobId: number, text: string, why: Why): void {
  const lines = text.split('\n');
  for (const s of db.query("SELECT id, old FROM resume_suggestions WHERE job_id = ? AND status = 'open'").all(jobId) as { id: number; old: string }[]) {
    if (why === 'written' || lines.filter((l) => l === s.old).length !== 1) db.query("UPDATE resume_suggestions SET status = 'stale' WHERE id = ?").run(s.id);
  }
}

// Keeps the text as it stands as A before something changes what the next writing is measured against (a new length):
// so the next letter's reason can say what changed. Writes nothing when the job has a version or no text.
export function keepStanding(jobId: number): void {
  db.transaction(() => { const cur = current(jobId); if (cur) standing(jobId, cur); }).immediate();
}

// The version that is current when the job is marked sent is kept for good. A job with no version yet is at A, which is
// always kept, so nothing is written for it.
export function keepSent(jobId: number): void {
  db.query('UPDATE resume_versions SET sent = 1 WHERE job_id = ? AND n = (SELECT max(n) FROM resume_versions WHERE job_id = ?)').run(jobId, jobId);
}

// The reason a writing gives, from what code knows: the first one; a new length; a changed record; else plainly again.
export function writtenReason(jobId: number, bankSig: string): string {
  const cur = db.query('SELECT resume, bank_sig, pages FROM jobs WHERE id = ?').get(jobId) as { resume: string; bank_sig: string; pages: number } | null;
  if (!cur || cur.resume.trim() === '') return 'Written for this posting.';
  const last = db.query('SELECT pages FROM resume_versions WHERE job_id = ? ORDER BY n DESC LIMIT 1').get(jobId) as { pages: number } | null;
  if (last && last.pages !== cur.pages) return `Written again at ${cur.pages === 1 ? 'one page' : 'two pages'}.`;
  if (cur.bank_sig !== '' && cur.bank_sig !== bankSig) return 'Written again after your record changed.';
  return 'Written again.';
}

// A job's versions, oldest first.
export const versionsOf = (jobId: number): Version[] => (db.query('SELECT * FROM resume_versions WHERE job_id = ? ORDER BY n').all(jobId) as Omit<Version, 'letter'>[]).map((v) => ({ ...v, letter: letter(v.n) }));
