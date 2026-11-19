// Where a fact came from, in the owner's own words: the turn of Talk, the source text or the fact as the owner typed
// it, the span of characters inside that text, and a copy of the words. A writer can then show the words behind a
// line, and a check can tell when the text it points at has changed since. Nothing calls this yet. Additive only: one
// new table and its triggers, created when this file is imported. Safe to import alone: the `talk` table belongs to
// lib/talk.ts, and nothing here needs it until a talk origin is added.
import { carryFacts, db, type CarriedFact } from './db.ts';

// talk: a row of `talk` (lib/talk.ts) the owner wrote, its body. source: a row of `sources` of kind text, its body
// (a file's or a repository's body is its name, not the words). typed: the fact itself, its text as the owner typed it
// into the record; its span is checked against the fact's text as it now stands, so an edit to the fact shows.
export const ORIGIN_KINDS = ['talk', 'source', 'typed'] as const;
export type OriginKind = (typeof ORIGIN_KINDS)[number];

// span_start and span_end are offsets into the text in UTF-16 code units (as String.slice takes them), end not
// included. quote is the words as they were when the link was made.
db.run(`CREATE TABLE IF NOT EXISTS fact_origins (
  id INTEGER PRIMARY KEY AUTOINCREMENT, fact_id INTEGER NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('talk', 'source', 'typed')),
  ref_id INTEGER NOT NULL, span_start INTEGER NOT NULL, span_end INTEGER NOT NULL, quote TEXT NOT NULL, added_at INTEGER NOT NULL DEFAULT 0,
  CHECK (span_start >= 0 AND span_end > span_start))`);
db.run('CREATE INDEX IF NOT EXISTS fact_origins_fact ON fact_origins (fact_id)');
// For the triggers that delete the origins of a deleted Talk turn or source.
db.run('CREATE INDEX IF NOT EXISTS fact_origins_ref ON fact_origins (kind, ref_id)');
// A deletion is real: a deleted fact, Talk turn or source takes the origins that point at it, and their copies of the
// words, with it. A new fact never takes origins left behind under its id. Created only if missing, so a change to a
// body needs a DROP first to reach an existing database.
db.run('CREATE TRIGGER IF NOT EXISTS fact_origins_gone AFTER DELETE ON facts BEGIN DELETE FROM fact_origins WHERE fact_id = OLD.id; END');
db.run('CREATE TRIGGER IF NOT EXISTS fact_origins_fresh AFTER INSERT ON facts BEGIN DELETE FROM fact_origins WHERE fact_id = NEW.id; END');
db.run("CREATE TRIGGER IF NOT EXISTS fact_origins_source_gone AFTER DELETE ON sources BEGIN DELETE FROM fact_origins WHERE kind = 'source' AND ref_id = OLD.id; END");
const hasTalk = () => db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'talk'").get() !== null;
// The talk trigger can only be made once lib/talk.ts has made its table: here, or before the first talk origin is
// added (addOrigin). So no talk origin is ever stored without it.
const talkTrigger = () => { if (hasTalk()) db.run("CREATE TRIGGER IF NOT EXISTS fact_origins_talk_gone AFTER DELETE ON talk BEGIN DELETE FROM fact_origins WHERE kind = 'talk' AND ref_id = OLD.id; END"); };
talkTrigger();

export type Origin = { id: number; factId: number; kind: OriginKind; refId: number; start: number; end: number; quote: string; addedAt: number };
type OriginRow = { id: number; fact_id: number; kind: string; ref_id: number; span_start: number; span_end: number; quote: string; added_at: number };
const toOrigin = (r: OriginRow): Origin => ({ id: r.id, factId: r.fact_id, kind: r.kind as OriginKind, refId: r.ref_id, start: r.span_start, end: r.span_end, quote: r.quote, addedAt: r.added_at });

// The text an origin points at, as it now stands, or null when that row is gone (or Talk has no table here).
export function originText(kind: OriginKind, refId: number): string | null {
  switch (kind) {
    case 'talk': return hasTalk() ? (db.query('SELECT body FROM talk WHERE id = ?').get(refId) as { body: string } | null)?.body ?? null : null;
    case 'source': return (db.query('SELECT body FROM sources WHERE id = ?').get(refId) as { body: string } | null)?.body ?? null;
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
  return db.transaction((): Added => {
    if (db.query('SELECT 1 FROM facts WHERE id = ?').get(factId) === null) return { ok: false, error: 'That fact is not in the record.' };
    const refId = o.kind === 'typed' ? factId : o.refId;
    const text = originText(o.kind, refId);
    if (text === null) return { ok: false, error: 'The text this points at is not in the record.' };
    // An origin is the owner's own words: a turn Claude wrote in Talk is never one, nor a file's or a repository's name.
    if (o.kind === 'talk' && (db.query('SELECT who FROM talk WHERE id = ?').get(refId) as { who: string }).who !== 'you') return { ok: false, error: 'That turn of Talk is not the owner’s.' };
    if (o.kind === 'source' && (db.query('SELECT kind FROM sources WHERE id = ?').get(refId) as { kind: string }).kind !== 'text') return { ok: false, error: 'Only a source of pasted text holds the words themselves.' };
    if (!Number.isInteger(o.start) || !Number.isInteger(o.end) || o.start < 0 || o.end <= o.start || o.end > text.length || splits(text, o.start) || splits(text, o.end)) return { ok: false, error: 'The span is not inside the text.' };
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
