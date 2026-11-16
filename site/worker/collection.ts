// The collection the chat endpoint answers from (ask.ts). The owner publishes it from the studio, which writes it to
// the R2 bucket bound as CONTENT (wrangler.jsonc) under the key collection.md. The Worker reads it at request time,
// so a content change needs no deploy. This file has no Cloudflare imports, so `bun test` can run it with a fake bucket.
//
// Each isolate keeps the text it read for CACHE_MS, so most questions cost no bucket read. Then it reads again:
//   - The object is there and usable: that text is used from now on.
//   - The object is missing (the owner unpublished it), empty or too long: the assistant stops answering at once.
//   - The read fails with an error: the last text read stays in use for another CACHE_MS, and one line is logged.
//     When reads keep failing and the last read that worked is more than STALE_MS old, the assistant stops
//     answering until a read works again. So an unpublish takes effect within STALE_MS even in a bucket outage.
// The object's custom metadata (sha256, publishedAt) is for the studio; answering does not need it.

/** The part of an R2 bucket binding this file uses. */
export interface ContentBucket {
  get(key: string): Promise<{ text(): Promise<string> } | null>;
}

export const COLLECTION_KEY = 'collection.md';
export const CACHE_MS = 60_000;
export const STALE_MS = 5 * 60_000;
export const MAX_COLLECTION_CHARS = 200_000;

/** The collection for one request, or null when there is none to answer from. */
export type ReadCollection = (bucket: ContentBucket | undefined) => Promise<string | null>;

/** The text, or null (with a log line) when it cannot be the collection. */
function usable(text: string | null, log: (msg: string) => void): string | null {
  if (text === null) {
    log(`collection: ${COLLECTION_KEY} is not in the bucket, so the assistant does not answer`);
    return null;
  }
  if (text.trim() === '') {
    log(`collection: ${COLLECTION_KEY} is empty, so the assistant does not answer`);
    return null;
  }
  if (text.length > MAX_COLLECTION_CHARS) {
    log(`collection: ${COLLECTION_KEY} is longer than ${MAX_COLLECTION_CHARS} characters, so the assistant does not answer`);
    return null;
  }
  return text;
}

/**
 * Makes the reader for one isolate. Call it once (worker() in ask.ts does), so the text it read stays in memory
 * between requests. `now` is the clock in milliseconds; a fake in tests.
 */
export function collectionCache(deps: { log: (msg: string) => void; now: () => number }): ReadCollection {
  // readAt: the last read, which may have failed. okAt: the last read that worked.
  let held: { text: string | null; readAt: number; okAt: number } | null = null;
  return async (bucket) => {
    if (held !== null && deps.now() - held.readAt < CACHE_MS) return held.text;
    if (bucket === undefined) {
      deps.log('config: the CONTENT bucket binding is missing');
      return null;
    }
    try {
      const object = await bucket.get(COLLECTION_KEY);
      const text = object === null ? null : await object.text();
      const now = deps.now();
      held = { text: usable(text, deps.log), readAt: now, okAt: now };
    } catch {
      if (held === null) {
        // Nothing read yet: refuse this question, and try again on the next one.
        deps.log('collection: reading the bucket failed, and no earlier read exists');
        return null;
      }
      const now = deps.now();
      if (now - held.okAt > STALE_MS) {
        deps.log('collection: reading the bucket has failed for more than 5 minutes, so the assistant does not answer');
        held = { text: null, readAt: now, okAt: held.okAt };
      } else {
        deps.log('collection: reading the bucket failed; the last read stays in use for another minute');
        held = { text: held.text, readAt: now, okAt: held.okAt };
      }
    }
    return held.text;
  };
}
