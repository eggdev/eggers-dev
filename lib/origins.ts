// Where a fact came from, in the owner's own words: the turn of Talk, the source text, the owner's answer in a telling
// sitting, or the fact as the owner typed it, the span of characters inside that text, and a copy of the words. A writer
// can then show the words behind a line, and a check can tell when the text it points at has changed since. Deriving a
// told project (lib/derive.ts) adds told origins; a Talk reply (lib/talk.ts) adds talk origins; reading a pasted text
// (worker.ts, sourceOrigins below) adds source origins; backfillOrigins adds both, once, for facts stored before. Typed
// origins are added only by tests so far. One table and its
// triggers, created when this file is imported. Safe to import alone: the `talk` table belongs to lib/talk.ts and
// `capture_turns` to lib/sittings.ts, and nothing here needs them until an origin of their kind is added.
import { carryFacts, db, type CarriedFact } from './db.ts';

// talk: a row of `talk` (lib/talk.ts) the owner wrote, its body. source: a row of `sources` of kind text, its body
// (a file's or a repository's body is its name, not the words). told: one of the owner's answers in a telling sitting
// (a row of `capture_turns`), its text, stored exactly as given. typed: the fact itself, its text as the owner typed it
// into the record; its span is checked against the fact's text as it now stands, so an edit to the fact shows.
export const ORIGIN_KINDS = ['talk', 'source', 'told', 'typed'] as const;
export type OriginKind = (typeof ORIGIN_KINDS)[number];

// span_start and span_end are offsets into the text in UTF-16 code units (as String.slice takes them), end not
// included. quote is the words as they were when the link was made.
const SHAPE = `id INTEGER PRIMARY KEY AUTOINCREMENT, fact_id INTEGER NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('talk', 'source', 'told', 'typed')),
  ref_id INTEGER NOT NULL, span_start INTEGER NOT NULL, span_end INTEGER NOT NULL, quote TEXT NOT NULL, added_at INTEGER NOT NULL DEFAULT 0,
  CHECK (span_start >= 0 AND span_end > span_start)`;
const hasTalk = () => db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'talk'").get() !== null;
// The talk trigger can only be made once lib/talk.ts has made its table: here, or before the first talk origin is
// added (addOrigin). So no talk origin is ever stored without it.
const talkTrigger = () => { if (hasTalk()) db.run("CREATE TRIGGER IF NOT EXISTS fact_origins_talk_gone AFTER DELETE ON talk BEGIN DELETE FROM fact_origins WHERE kind = 'talk' AND ref_id = OLD.id; END"); };
// The same for the telling sittings: a deleted answer (alone, with its sitting, or with its project) takes the told
// origins that quote it.
const hasTurns = () => db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'capture_turns'").get() !== null;
const toldTrigger = () => { if (hasTurns()) db.run("CREATE TRIGGER IF NOT EXISTS fact_origins_told_gone AFTER DELETE ON capture_turns BEGIN DELETE FROM fact_origins WHERE kind = 'told' AND ref_id = OLD.id; END"); };

// The table, its indexes and its triggers, in one transaction that takes the write lock first, so a second start and a
// second process find it done and nothing is written between a rebuild and its triggers. A table made before told
// origins existed refuses the kind: it is made again in the new shape with every row, its id, and the counter of ids
// (an id is never handed out twice). The triggers that name it are dropped first (a rename checks every trigger) and
// made again below. Each trigger is created only if missing, so a change to a body needs a DROP first to reach an
// existing database.
db.transaction(() => {
  db.run(`CREATE TABLE IF NOT EXISTS fact_origins (${SHAPE})`);
  const made = (db.query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'fact_origins'").get() as { sql: string }).sql;
  if (!made.includes("'told'")) {
    const seq = (db.query("SELECT seq FROM sqlite_sequence WHERE name = 'fact_origins'").get() as { seq: number } | null)?.seq ?? 0;
    for (const t of ['fact_origins_gone', 'fact_origins_fresh', 'fact_origins_source_gone', 'fact_origins_talk_gone', 'fact_origins_told_gone']) db.run(`DROP TRIGGER IF EXISTS ${t}`);
    db.run(`CREATE TABLE fact_origins_next (${SHAPE})`);
    db.run('INSERT INTO fact_origins_next SELECT id, fact_id, kind, ref_id, span_start, span_end, quote, added_at FROM fact_origins');
    db.run('DROP TABLE fact_origins');
    db.run('ALTER TABLE fact_origins_next RENAME TO fact_origins');
    db.query("UPDATE sqlite_sequence SET seq = max(seq, ?) WHERE name = 'fact_origins'").run(seq);
    if (seq > 0) db.query("INSERT INTO sqlite_sequence (name, seq) SELECT 'fact_origins', ? WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'fact_origins')").run(seq);
  }
  db.run('CREATE INDEX IF NOT EXISTS fact_origins_fact ON fact_origins (fact_id)');
  // For the triggers that delete the origins of a deleted Talk turn, source or answer.
  db.run('CREATE INDEX IF NOT EXISTS fact_origins_ref ON fact_origins (kind, ref_id)');
  // A deletion is real: a deleted fact, Talk turn, source or answer takes the origins that point at it, and their copies
  // of the words, with it. A new fact never takes origins left behind under its id.
  db.run('CREATE TRIGGER IF NOT EXISTS fact_origins_gone AFTER DELETE ON facts BEGIN DELETE FROM fact_origins WHERE fact_id = OLD.id; END');
  db.run('CREATE TRIGGER IF NOT EXISTS fact_origins_fresh AFTER INSERT ON facts BEGIN DELETE FROM fact_origins WHERE fact_id = NEW.id; END');
  db.run("CREATE TRIGGER IF NOT EXISTS fact_origins_source_gone AFTER DELETE ON sources BEGIN DELETE FROM fact_origins WHERE kind = 'source' AND ref_id = OLD.id; END");
  talkTrigger();
  toldTrigger();
}).immediate();

export type Origin = { id: number; factId: number; kind: OriginKind; refId: number; start: number; end: number; quote: string; addedAt: number };
type OriginRow = { id: number; fact_id: number; kind: string; ref_id: number; span_start: number; span_end: number; quote: string; added_at: number };
const toOrigin = (r: OriginRow): Origin => ({ id: r.id, factId: r.fact_id, kind: r.kind as OriginKind, refId: r.ref_id, start: r.span_start, end: r.span_end, quote: r.quote, addedAt: r.added_at });

// The text an origin points at, as it now stands, or null when that row is gone (or Talk has no table here).
export function originText(kind: OriginKind, refId: number): string | null {
  switch (kind) {
    case 'talk': return hasTalk() ? (db.query('SELECT body FROM talk WHERE id = ?').get(refId) as { body: string } | null)?.body ?? null : null;
    case 'source': return (db.query('SELECT body FROM sources WHERE id = ?').get(refId) as { body: string } | null)?.body ?? null;
    case 'told': return hasTurns() ? (db.query("SELECT text FROM capture_turns WHERE id = ? AND who = 'owner'").get(refId) as { text: string } | null)?.text ?? null : null;
    case 'typed': return (db.query('SELECT text FROM facts WHERE id = ?').get(refId) as { text: string } | null)?.text ?? null;
    default: return never(kind);
  }
}
function never(x: never): never { throw new Error(`Not handled: ${String(x)}`); }

// A span may not cut a character written as two code units (an emoji, for one) in half.
const splits = (text: string, at: number) => at > 0 && at < text.length && /[\uD800-\uDBFF]/.test(text[at - 1]) && /[\uDC00-\uDFFF]/.test(text[at]);

export type Added = { ok: true; id: number } | { ok: false; error: string };
// Links a fact to the words it came from. The words are copied from the text as it is now, so the copy is exactly what
// the span held. A typed origin points at the fact itself (refId is ignored). Returns the new origin's id, or why it
// was refused.
export function addOrigin(factId: number, o: { kind: OriginKind; refId: number; start: number; end: number }, now = Date.now()): Added {
  if (!(ORIGIN_KINDS as readonly string[]).includes(o.kind)) return { ok: false, error: 'That is not a kind of origin.' };
  if (o.kind === 'talk') talkTrigger();
  if (o.kind === 'told') toldTrigger();
  return db.transaction((): Added => {
    if (db.query('SELECT 1 FROM facts WHERE id = ?').get(factId) === null) return { ok: false, error: 'That fact is not in the record.' };
    const refId = o.kind === 'typed' ? factId : o.refId;
    const text = originText(o.kind, refId);
    if (text === null) return { ok: false, error: 'The text this points at is not in the record.' };
    // An origin is the owner's own words: a turn Claude wrote in Talk is never one, nor a file's or a repository's name.
    if (o.kind === 'talk' && (db.query('SELECT who FROM talk WHERE id = ?').get(refId) as { who: string }).who !== 'you') return { ok: false, error: 'That turn of Talk is not the owner’s.' };
    if (o.kind === 'source' && (db.query('SELECT kind FROM sources WHERE id = ?').get(refId) as { kind: string }).kind !== 'text') return { ok: false, error: 'Only a source of pasted text holds the words themselves.' };
    if (!Number.isInteger(o.start) || !Number.isInteger(o.end) || o.start < 0 || o.end <= o.start || o.end > text.length || splits(text, o.start) || splits(text, o.end)) return { ok: false, error: 'The span is not inside the text.' };
    const existing = db.query('SELECT id FROM fact_origins WHERE fact_id = ? AND kind = ? AND ref_id = ? AND span_start = ? AND span_end = ? ORDER BY id LIMIT 1')
      .get(factId, o.kind, refId, o.start, o.end) as { id: number } | null;
    if (existing) return { ok: true, id: existing.id };
    const quote = text.slice(o.start, o.end);
    const r = db.query('INSERT INTO fact_origins (fact_id, kind, ref_id, span_start, span_end, quote, added_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id')
      .get(factId, o.kind, refId, o.start, o.end, quote, now) as { id: number };
    return { ok: true, id: r.id };
  }).immediate();
}

// A fact's origins, oldest first.
export const originsOf = (factId: number) => (db.query('SELECT * FROM fact_origins WHERE fact_id = ? ORDER BY id').all(factId) as OriginRow[]).map(toOrigin);

export const removeOrigin = (id: number) => db.query('DELETE FROM fact_origins WHERE id = ?').run(id).changes > 0;

// holds: the span still holds the copied words. moved: the words are still in the text, once or more, but the span no
// longer holds them; at is where they first appear now. changed: the words are no longer in the text. gone: the row
// the origin points at is gone.
export type SpanCheck = { state: 'holds' } | { state: 'moved'; at: number } | { state: 'changed' } | { state: 'gone' };

// Pure: whether a span of a text still holds the copied words. text is null when the row is gone.
export function checkSpan(text: string | null, o: { start: number; end: number; quote: string }): SpanCheck {
  if (text === null) return { state: 'gone' };
  if (text.slice(o.start, o.end) === o.quote) return { state: 'holds' };
  const at = text.indexOf(o.quote);
  return at >= 0 ? { state: 'moved', at } : { state: 'changed' };
}

// The same, for a stored origin against the text it points at now.
export const checkOrigin = (o: Origin): SpanCheck => checkSpan(originText(o.kind, o.refId), o);

// ---------- Origins written as facts are stored, and once for facts stored before ----------

// A quote is taken as the words behind a fact only when it says something: at least MIN_QUOTE characters and two words,
// standing whole in the text. A single letter, a word or a heading ("I", "a", "Skills") is found inside anything.
export const MIN_QUOTE = 12;
const WORDISH = /[\p{L}\p{N}]/u;
export const quoteOk = (words: string) => words.length >= MIN_QUOTE && /\S\s+\S/.test(words);
// The first place `words` stand in `text` as whole words (not inside a longer word at either end), or -1.
function wholeAt(text: string, words: string): number {
  for (let at = text.indexOf(words); at >= 0; at = text.indexOf(words, at + 1)) {
    const before = at === 0 ? '' : text[at - 1], after = text[at + words.length] ?? '';
    if (!(WORDISH.test(words[0]) && WORDISH.test(before)) && !(WORDISH.test(words.at(-1)!) && WORDISH.test(after))) return at;
  }
  return -1;
}

// Pure: where a fact's evidence stands in a pasted text, or null. A reading's evidence is "a short verbatim quote"
// (lib/ingest.ts), but it may come in quotation marks, or with words around a quote, or as several pieces joined by " · "
// when a later reading added to the fact (applyExtraction in lib/db.ts). Each piece, each piece without its outer
// quotation marks, and each quoted part is tried; the longest that is a quote (quoteOk) and stands whole in the text is
// taken, at its first place. Nothing else is guessed: evidence whose words are not in the text gives no span.
export function evidenceSpan(evidence: string, body: string): { start: number; end: number } | null {
  const pieces = new Set<string>();
  for (const part of evidence.split(' · ')) {
    const p = part.trim();
    pieces.add(p);
    pieces.add(p.replace(/^["“‘'](.*)["”’'][.,;]?$/s, '$1').trim());
    for (const m of p.matchAll(/["“]([^"“”]+)["”]/g)) pieces.add(m[1].trim());
  }
  let best: { start: number; end: number } | null = null;
  for (const w of pieces) {
    if (!quoteOk(w) || (best && w.length <= best.end - best.start)) continue;
    const at = wholeAt(body, w);
    if (at >= 0) best = { start: at, end: at + w.length };
  }
  return best;
}

// Pure: which of the owner's messages a fact Talk wrote came from, and where in it. `messages` are the owner's messages
// the reply answers: every one since the last reply that was written (a reply that failed leaves its message
// unanswered, and the model may take a fact from it), oldest first. `said` is the model's copy of the owner's words.
// - `said` is a quote (quoteOk) that stands whole in exactly one of them: that message, that passage.
// - Otherwise (no `said`, a scrap, words changed in the copying, or words in more than one message): the whole message,
//   only when there is just one; with more, which one is not guessed, and there is no origin.
export function talkOriginOf(said: unknown, messages: { id: number; body: string }[]): { talkId: number; start: number; end: number } | null {
  const s = typeof said === 'string' ? said.trim() : '';
  if (quoteOk(s)) {
    const hits = messages.map((m) => ({ m, at: wholeAt(m.body, s) })).filter((h) => h.at >= 0);
    if (hits.length === 1) return { talkId: hits[0].m.id, start: hits[0].at, end: hits[0].at + s.length };
  }
  return messages.length === 1 && messages[0].body.length > 0 ? { talkId: messages[0].id, start: 0, end: messages[0].body.length } : null;
}

// The owner's messages a reply answers: every one since the last reply that was written, oldest first. A reply is the
// row say() (lib/talk.ts) writes right after the owner's message, so a reply that was written is a done turn of Claude's
// that follows one of the owner's. A turn the tool put (a question, put() in lib/talk.ts and lib/nextquestion.ts) and a
// reply that failed are passed over.
export function unansweredBefore(replyId: number): { id: number; body: string }[] {
  if (!hasTalk()) return [];
  const rows = db.query('SELECT id, who, status, body FROM talk WHERE id < ? ORDER BY id DESC LIMIT 200').all(replyId) as { id: number; who: string; status: string; body: string }[];
  const out: { id: number; body: string }[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.who === 'you') { if (r.body.length > 0) out.push({ id: r.id, body: r.body }); continue; }
    if (r.status === 'done' && rows[i + 1]?.who === 'you') break;
  }
  return out.reverse();
}

// Links a fact Talk wrote to the owner's words it came from (talkOriginOf). Returns null when no origin is added.
export function addTalkOrigin(factId: number, messages: { id: number; body: string }[], said: unknown, now = Date.now()): Added | null {
  const o = talkOriginOf(said, messages);
  if (!o) return null;
  const got = addOrigin(factId, { kind: 'talk', refId: o.talkId, start: o.start, end: o.end }, now);
  // A span that cuts a character in two is refused; the whole message never is.
  const body = messages.find((m) => m.id === o.talkId)!.body;
  return got.ok ? got : addOrigin(factId, { kind: 'talk', refId: o.talkId, start: 0, end: body.length }, now);
}

const noOrigin = (factId: number) => db.query('SELECT 1 FROM fact_origins WHERE fact_id = ? LIMIT 1').get(factId) === null;
type Planned = { factId: number; kind: 'talk' | 'source'; refId: number; start: number; end: number };
// Adds what was planned, under the write lock, to the facts that still have no origin. Nothing planned, nothing written.
function addPlanned(plan: Planned[], now: number): number {
  if (plan.length === 0) return 0;
  return db.transaction(() => {
    let n = 0;
    for (const p of plan) if (noOrigin(p.factId) && addOrigin(p.factId, { kind: p.kind, refId: p.refId, start: p.start, end: p.end }, now).ok) n++;
    return n;
  }).immediate();
}

// The source origins to add for a pasted text's facts that have none: one where the evidence stands in the text.
function plannedFromSource(sourceId: number): Planned[] {
  const s = db.query('SELECT kind, body FROM sources WHERE id = ?').get(sourceId) as { kind: string; body: string } | null;
  if (!s || s.kind !== 'text') return [];
  const facts = db.query('SELECT id, evidence FROM facts f WHERE source_id = ? AND NOT EXISTS (SELECT 1 FROM fact_origins o WHERE o.fact_id = f.id) ORDER BY id').all(sourceId) as { id: number; evidence: string }[];
  return facts.flatMap((f) => { const span = evidenceSpan(f.evidence, s.body); return span ? [{ factId: f.id, kind: 'source' as const, refId: sourceId, ...span }] : []; });
}

// After a pasted text is read (worker.ts): each of its facts with no origin yet gets the passage its evidence quotes,
// when that passage is in the text. A file's or a repository's facts get none: their source's body is a name. A fact
// made again with the same words has kept its origins already (carryFacts below). Returns how many were added.
export const sourceOrigins = (sourceId: number, now = Date.now()) => addPlanned(plannedFromSource(sourceId), now);

// Once, for the facts stored before origins were written for Talk and pasted text: safe to run at every start, since
// it only adds to a fact with no origin at all, and what it adds is copied from the text it points at.
// - A fact Talk wrote: Talk's reply row lists the sentences of the facts it added (talk.added, lib/talk.ts), and the
//   owner's message is the last of theirs before that reply. A fact is linked to the whole message only when exactly
//   one reply lists its sentence and exactly one fact Talk wrote has it: words since reworded, or said twice, are not
//   guessed at.
// - A fact read from a pasted text: as sourceOrigins does.
// Returns how many origins were added.
export function backfillOrigins(now = Date.now()): number {
  const plan: Planned[] = [];
  if (hasTalk()) {
    // Read once, so a start with nothing to add costs a few queries, not some for each reply.
    const rows = db.query('SELECT id, who, status, body, added FROM talk ORDER BY id').all() as { id: number; who: string; status: string; body: string; added: string }[];
    const sentencesOf = (added: string): string[] => {
      try { const l = JSON.parse(added) as unknown; return Array.isArray(l) ? l.filter((x): x is string => typeof x === 'string').map((x) => x.replace(/^Updated: /, '')) : []; } catch { return []; }
    };
    // Each reply that was written, with the owner's messages it answers: the same walk as unansweredBefore, forwards.
    const replies: { added: string[]; since: { id: number; body: string }[] }[] = [];
    let since: { id: number; body: string }[] = [];
    rows.forEach((r, i) => {
      if (r.who === 'you') { if (r.body.length > 0) since.push({ id: r.id, body: r.body }); return; }
      if (r.status !== 'done' || rows[i - 1]?.who !== 'you') return;
      if (r.added !== '' && r.added !== '[]') replies.push({ added: sentencesOf(r.added), since });
      since = [];
    });
    // A sentence more than one reply lists (said, then said again; or reworded away and back) could be any of them.
    const listed = new Map<string, number>();
    for (const r of replies) for (const t of new Set(r.added)) listed.set(t, (listed.get(t) ?? 0) + 1);
    // The facts Talk wrote, by their words, and the facts that already have an origin.
    const byText = new Map<string, number[]>();
    for (const f of db.query("SELECT id, text FROM facts WHERE source_id IS NULL AND evidence LIKE '%Said by you in Talk on %'").all() as { id: number; text: string }[]) byText.set(f.text, [...(byText.get(f.text) ?? []), f.id]);
    const linked = new Set((db.query('SELECT DISTINCT fact_id FROM fact_origins').all() as { fact_id: number }[]).map((r) => r.fact_id));
    for (const r of replies) {
      // The message the reply answers, as talkOriginOf takes it: only when it is the one message since the reply before.
      if (r.since.length !== 1) continue;
      const owner = r.since[0];
      for (const text of r.added) {
        const same = byText.get(text) ?? [];
        if (listed.get(text) !== 1 || same.length !== 1 || linked.has(same[0])) continue;
        linked.add(same[0]);
        plan.push({ factId: same[0], kind: 'talk', refId: owner.id, start: 0, end: owner.body.length });
      }
    }
  }
  const texts = db.query("SELECT DISTINCT s.id FROM sources s JOIN facts f ON f.source_id = s.id WHERE s.kind = 'text' AND NOT EXISTS (SELECT 1 FROM fact_origins o WHERE o.fact_id = f.id) ORDER BY s.id").all() as { id: number }[];
  for (const s of texts) plan.push(...plannedFromSource(s.id));
  return addPlanned(plan, now);
}

// A fact made again with the same words, when its source is read again, keeps its origins under the new id (a typed
// origin then points at the new fact). Origins of a fact with no such successor go with it. A fold moves the origins
// of the duplicates in Talk and sources to the fact that stays; their typed origins quote words that are gone, and go.
carryFacts({
  table: 'fact_origins',
  reread: (old: CarriedFact[]) => {
    const held = new Map<string, OriginRow[][]>();
    for (const f of old) {
      const rows = db.query('SELECT * FROM fact_origins WHERE fact_id = ?').all(f.id) as OriginRow[];
      if (rows.length > 0) held.set(f.key, [...(held.get(f.key) ?? []), rows]);
    }
    // Origins never hold a reading: only a kept mark does (lib/standing.ts).
    return {
      held: () => [],
      carry: (made: CarriedFact[]) => {
        for (const f of made) {
          for (const r of held.get(f.key)?.shift() ?? []) {
            db.query('INSERT INTO fact_origins (fact_id, kind, ref_id, span_start, span_end, quote, added_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
              .run(f.id, r.kind, r.kind === 'typed' ? f.id : r.ref_id, r.span_start, r.span_end, r.quote, r.added_at);
          }
        }
      },
    };
  },
  fold: (keep: number, drop: number[]) => {
    for (const id of drop) db.query("UPDATE fact_origins SET fact_id = ? WHERE fact_id = ? AND kind != 'typed'").run(keep, id);
  },
});
