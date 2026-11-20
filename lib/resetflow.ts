// The screen's steps for starting a new record (app.ts, resetRecord), apart from the network so `bun test lib` can try
// every answer. No imports: the app's data module bundles it.
//
// 1. Where it runs, decided once before anything else, from GET /_studio/status: an answer means the deployed studio;
//    a 404 means a development machine (server.ts answers /_studio/... so, with CORS, so the page can read it). Any
//    other answer, or none, stops here with nothing deleted.
// 2. In the studio, a backup of the record as it is. Anything but a backup taken stops here with nothing deleted.
// 3. The reset itself (POST /record/reset).
// 4. In the studio, a backup of the new record at once. Anything but a backup taken is said as "not backed up yet",
//    with what to do, because until then a restart of the machine brings the old record back.

// One request's outcome: its status and JSON body, or status 0 when no answer came (timeout or network error).
export type Answer = { status: number; body: Record<string, unknown> };
export type FlowDeps = {
  status: () => Promise<Answer>;
  backup: () => Promise<Answer>;
  reset: () => Promise<Answer>;
};
export type FlowResult = { ok: boolean; error: string; note: string };

const text = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const sentence = (s: string) => (s === '' ? '' : `${s[0].toUpperCase()}${s.slice(1)}${/[.!?]$/.test(s) ? '' : '.'}`);
// What an answer said went wrong, in a sentence.
const why = (a: Answer, none: string) => (a.status === 0 ? none : sentence(text(a.body.error) || text(a.body.reason)) || `The machine answered ${a.status}.`);
// A backup that was taken: an answer, and not one that says it failed.
const backedUp = (a: Answer) => a.status >= 200 && a.status < 300 && a.body.ok !== false;

const NOT_DELETED = 'Nothing was deleted.';

/** Where the screens run: the studio, a development machine, or neither for sure (with why, in words). */
export function placeOf(a: Answer): { where: 'studio' | 'here' } | { where: 'unknown'; error: string } {
  if (a.status >= 200 && a.status < 300) return { where: 'studio' };
  if (a.status === 404) return { where: 'here' };
  if (a.status === 503) return { where: 'unknown', error: `The machine is starting. Try again in a moment. ${NOT_DELETED}` };
  return { where: 'unknown', error: `It couldn’t be told whether the studio’s machine is there. ${why(a, 'The studio can’t be reached right now.')} ${NOT_DELETED}` };
}

/** The result line: what was deleted and kept, from the reset's answer. */
export function saidOf(body: Record<string, unknown>): string {
  const d = obj(body.deleted), k = obj(body.kept);
  const many = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;
  const sent = num(k.sentResumes);
  const kept = sent > 0 ? `${many(num(k.jobs), 'job')}, ${sent} of them sent with ${sent === 1 ? 'its resume' : 'their resumes'}` : many(num(k.jobs), 'job');
  const notDeleted = Array.isArray(body.notDeleted) ? body.notDeleted.map(text).filter(Boolean) : [];
  const files = notDeleted.length > 0 ? ` These files couldn’t be deleted: ${notDeleted.join(', ')}.` : '';
  return `A new record is started. Deleted ${many(num(d.roles), 'role')}, ${many(num(d.projects), 'project')}, ${many(num(d.facts), 'fact')}, ${many(num(d.sources), 'source')}, ${many(num(d.answers), 'answer')} and ${many(num(d.unsentResumes), 'unsent resume')}. Kept ${kept}.${files}`;
}

export async function startNewRecord(d: FlowDeps): Promise<FlowResult> {
  const place = placeOf(await d.status());
  if (place.where === 'unknown') return { ok: false, note: '', error: place.error };
  const studio = place.where === 'studio';
  if (studio) {
    const before = await d.backup();
    if (!backedUp(before)) return { ok: false, note: '', error: `Your record couldn’t be backed up first, so ${NOT_DELETED.toLowerCase()} ${why(before, 'The machine didn’t answer in time.')}` };
  }
  const r = await d.reset();
  if (r.status < 200 || r.status >= 300) return { ok: false, note: '', error: why(r, 'No answer came, so it isn’t known whether your record was deleted. Open Experience to see.') };
  const said = saidOf(r.body);
  if (!studio) return { ok: true, error: '', note: said };
  const after = await d.backup();
  return { ok: true, error: '', note: backedUp(after) ? `${said} The new record is backed up.`
    : `${said} The new record isn’t backed up yet. ${why(after, 'The machine didn’t answer in time.')} Press Back up now. Until a backup is taken, a restart of the machine brings your old record back.` };
}
