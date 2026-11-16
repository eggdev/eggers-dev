// The publish step for the public collection: the text the public website's chat answers from. The owner edits and
// saves that text in the studio; the app's server keeps the saved text and answers GET /public with
// {text, savedAt, sha256, notes}. Publishing copies the saved text to the R2 bucket bound as CONTENT (bucket
// eggers-site-content), where the public website's Worker reads the object collection.md (site/worker/collection.ts).
//
//   GET  /api/_studio/public      {live: null} or {live: {sha256, publishedAt, size}}, from the object's metadata
//   POST /api/_studio/publish     body {sha256}: the saved text the owner reviewed. Writes a history copy, then
//                                 collection.md, and answers {ok: true, live}
//   POST /api/_studio/unpublish   deletes collection.md and answers {ok: true, live: null}. The public chat then
//                                 stops answering: this is the owner's emergency stop. The history stays.
//
// Two buckets. CONTENT holds collection.md and nothing else: an internet-facing Worker is bound to it, so after an
// unpublish no copy of the text may be left there. The history copies go to the private bucket DATA (bucket
// eggers-studio-data, which also holds the backups) as public-history/<time>.md; only the studio's Worker is bound
// to that bucket. The newest 20 copies are kept. Pruning deletes only keys of exactly that form, so it can never
// delete a backup; and the backup code lists and accepts only backups/<time>.tar.gz and its manifests
// (cloud/lib/manifest.ts, backups.ts), so it never lists, restores or deletes a history copy.
//
// A publish is refused with 409 and a plain message when nothing is saved, when the saved text is not the text the
// owner reviewed (its sha256 differs from the one sent), when the text does not match the server's own sha256, or
// when the text is only white space or too long. Nothing is written then.
// The Worker (studio.ts) calls these only after the Access check and the same-origin rule. One line is logged per
// publish and unpublish: the time and the sha256, never the text.
// This file has no Cloudflare imports, so `bun test` runs it with a fake bucket.
import { MESSAGES } from './messages.ts';

export const COLLECTION_KEY = 'collection.md';
/** Where the history copies go, in the private bucket DATA. Never under backups/. */
export const HISTORY_PREFIX = 'public-history/';
/** How many history copies are kept. Older ones are deleted after a publish. */
export const HISTORY_KEEP = 20;
/** The longest text that is published, in characters (UTF-16 units, as the text's length counts them). */
export const MAX_CHARS = 120_000;
const TYPE = 'text/markdown; charset=utf-8';

type Meta = { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> };

/** The parts of an R2 bucket binding this file uses: of CONTENT for collection.md, of DATA for the history. */
export interface ContentBucket {
  head(key: string): Promise<{ size: number; customMetadata?: Record<string, string>; uploaded?: Date } | null>;
  put(key: string, value: string | Uint8Array, options?: Meta): Promise<unknown>;
  delete(keys: string | string[]): Promise<void>;
  list(options: { prefix: string; cursor?: string; limit?: number }): Promise<{ objects: { key: string }[]; truncated: boolean; cursor?: string }>;
}

/** What is published now. sha256 and publishedAt are null for an object this file did not write. */
export type Live = { sha256: string | null; publishedAt: string | null; size: number };

export type PublishDeps = {
  /** CONTENT: the bucket the public website reads. It gets collection.md only. */
  bucket: ContentBucket;
  /** DATA: the private bucket. It gets the history copies, under public-history/. */
  history: Pick<ContentBucket, 'put' | 'list' | 'delete'>;
  /** GET /public on the app's server, through the Durable Object (which starts the container when it sleeps). */
  saved: () => Promise<Response>;
  now: () => number;
  /** Where operator messages go (Worker logs). Never the text. */
  log: (msg: string) => void;
};

const SHA = /^[0-9a-f]{64}$/;
const HISTORY_KEY = /^public-history\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.md$/;

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) => Response.json(body, { status, headers: { 'cache-control': 'no-store', ...extra } });
const fail = (status: number, error: string) => json({ error }, status);
const reason = (error: unknown) => (error instanceof Error ? error.message : 'unknown error');

/** The history key of a publish at this ISO time: its ':' and '.' become '-', so keys sort by time. */
export function historyKey(iso: string): string {
  return `${HISTORY_PREFIX}${iso.replace(/[:.]/g, '-')}.md`;
}

/** The SHA-256 of bytes, in lowercase hex. */
async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** GET /api/_studio/public: what is published now. A head of the object; its body is not read. */
export async function live(d: Pick<PublishDeps, 'bucket' | 'log'>): Promise<Response> {
  try {
    const head = await d.bucket.head(COLLECTION_KEY);
    if (!head) return json({ live: null });
    const meta = head.customMetadata ?? {};
    const now: Live = {
      sha256: SHA.test(meta.sha256 ?? '') ? meta.sha256! : null,
      publishedAt: meta.publishedAt ?? head.uploaded?.toISOString() ?? null,
      size: head.size,
    };
    return json({ live: now });
  } catch (error) {
    d.log(`public: the bucket could not be read (${reason(error)})`);
    return fail(502, MESSAGES.bucketFailed);
  }
}

/** POST /api/_studio/publish: copies the saved text to the bucket when it is the text the owner reviewed. */
export async function publish(request: Request, d: PublishDeps): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { sha256?: unknown } | null;
  const reviewed = typeof body?.sha256 === 'string' ? body.sha256 : '';
  if (!SHA.test(reviewed)) return fail(400, MESSAGES.publishBody);

  // The saved text, from the server. Never from the request: the page cannot publish a text of its own.
  let res: Response;
  try {
    res = await d.saved();
  } catch (error) {
    d.log(`publish: the container gave no answer (${reason(error)})`);
    return fail(502, MESSAGES.containerDown);
  }
  if (res.status === 502 || res.status === 503) {
    // The Durable Object's own answers (the server is starting, or it is not answering) go to the page as they are.
    const retry = res.headers.get('retry-after');
    return new Response(res.body, {
      status: res.status,
      headers: { 'content-type': res.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store', ...(retry ? { 'retry-after': retry } : {}) },
    });
  }
  const saved = res.ok ? ((await res.json().catch(() => null)) as { text?: unknown; sha256?: unknown } | null) : null;
  if (!res.ok) await res.body?.cancel().catch(() => {});
  if (!saved || typeof saved.text !== 'string' || !(saved.sha256 === null || typeof saved.sha256 === 'string')) {
    d.log(`publish: GET /public answered ${res.status}${res.ok ? ' without the saved text' : ''}`);
    return fail(502, MESSAGES.savedUnreadable);
  }

  if (saved.sha256 === null) return fail(409, MESSAGES.nothingSaved);
  if (saved.sha256 !== reviewed) return fail(409, MESSAGES.savedChanged);
  const bytes = new TextEncoder().encode(saved.text);
  const own = await sha256(bytes);
  if (own !== saved.sha256) {
    d.log('publish: refused, the text does not match the sha256 the server sent with it');
    return fail(409, MESSAGES.checksum);
  }
  if (saved.text.trim() === '') return fail(409, MESSAGES.emptyText);
  if (saved.text.length > MAX_CHARS) return fail(409, MESSAGES.tooLong);

  const publishedAt = new Date(d.now()).toISOString();
  const options: Meta = { httpMetadata: { contentType: TYPE }, customMetadata: { sha256: own, publishedAt } };
  try {
    // The history copy first (in the private bucket), so every text that was ever live has a copy. The bytes
    // written are the bytes hashed.
    await d.history.put(historyKey(publishedAt), bytes, options);
    await d.bucket.put(COLLECTION_KEY, bytes, options);
  } catch (error) {
    d.log(`publish: the bucket write failed (${reason(error)})`);
    return fail(502, MESSAGES.bucketFailed);
  }
  d.log(`publish: ${publishedAt} sha256 ${own}`);
  await prune(d);
  return json({ ok: true, live: { sha256: own, publishedAt, size: bytes.length } satisfies Live });
}

/** Deletes the history copies past the newest HISTORY_KEEP. A failure here leaves extra copies, never fewer. */
async function prune(d: Pick<PublishDeps, 'history' | 'log'>): Promise<void> {
  try {
    const keys: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await d.history.list({ prefix: HISTORY_PREFIX, cursor, limit: 1000 });
      keys.push(...page.objects.map((o) => o.key));
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    // Only keys of this file's own form are counted or deleted: never a backup, whatever the listing returns.
    // Their names sort by time.
    const old = keys.filter((k) => HISTORY_KEY.test(k)).sort().reverse().slice(HISTORY_KEEP);
    if (old.length) await d.history.delete(old);
  } catch (error) {
    d.log(`publish: the history could not be pruned (${reason(error)})`);
  }
}

/** POST /api/_studio/unpublish: deletes collection.md, so the public chat stops answering. The history stays. */
export async function unpublish(d: Pick<PublishDeps, 'bucket' | 'now' | 'log'>): Promise<Response> {
  // What was live, for the log line only. The delete does not depend on it.
  const was = await d.bucket.head(COLLECTION_KEY).then(
    (h) => (!h ? 'none (nothing was published)' : SHA.test(h.customMetadata?.sha256 ?? '') ? h.customMetadata!.sha256! : 'unknown'),
    () => 'unknown',
  );
  try {
    await d.bucket.delete(COLLECTION_KEY);
  } catch (error) {
    d.log(`unpublish: the bucket delete failed (${reason(error)})`);
    return fail(502, MESSAGES.bucketFailed);
  }
  d.log(`unpublish: ${new Date(d.now()).toISOString()} sha256 ${was}`);
  return json({ ok: true, live: null });
}
