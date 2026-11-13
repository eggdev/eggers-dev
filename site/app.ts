import type { Answer, Result, Sources } from './app.contract.d.ts';

// The chat endpoint's origin, a setting (app.json's "env"): the environment's value, else .env.local's (out of
// git), else this default, server.ts's address. A build for the real site sets API_BASE_URL in its environment.
// It is inlined into the module on every host, so it is public: never a secret.
export const API = import.meta.env.API_BASE_URL ?? 'http://127.0.0.1:8797';
export const grants = `net.fetch ${API}`;

type Reply = Result<'ask'>;

// One event of the answer's stream. The endpoint sends `{"delta": "...", "text": "..."}` for each piece, `text`
// being the whole answer so far, and `{"done": true, "text": "..."}` at the end.
// Why `text` as well as `delta`: on the web an event stream's events that arrive in one network read reach the
// mapper as one, the newest (reference.md, "coalesce to the newest"). Deltas alone would lose words; the whole
// text so far loses nothing. A stream with no `text` is still read by its deltas, and fails if one was lost.
function parse(data: string): { delta?: string; text?: string; done: boolean } {
  const body: unknown = JSON.parse(data);
  if (body === null || typeof body !== 'object') throw new Error('The answer stream sent something other than an object.');
  const v = body as Record<string, unknown>;
  return {
    delta: typeof v.delta === 'string' ? v.delta : undefined,
    text: typeof v.text === 'string' ? v.text : undefined,
    done: v.done === true,
  };
}

const sources: Sources = {
  // POST {API}/ask with the conversation; the answer is a stream of server-sent events, each mapped to the
  // answer so far. The resource stays pending until the first piece lands, then shows each piece as it comes.
  // A failure (the endpoint refusing, the network, a stream that breaks off) ends the answer with `error` set:
  // it is data the page shows, not a thrown error, so the text that did arrive stays with it.
  ask: ([turns]) => {
    const messages = turns.map(t => ({ role: t.role, content: t.content }));
    let last: Reply = { text: '', done: false, error: '' };
    const fail = (error: string): Reply => (last = { text: last.text, done: true, error });
    return fetch(`${API}/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages }),
      exactStream: (event): Reply => {
        if (last.error) return last;
        if (event.type === 'message') {
          let piece;
          try { piece = parse(String(event.data)); } catch { return fail('The answer could not be read.'); }
          if (piece.text !== undefined) last = { text: piece.text, done: piece.done, error: '' };
          else if (piece.delta !== undefined && event.coalesced > 0) return fail('Part of the answer was lost.');
          else last = { text: last.text + (piece.delta ?? ''), done: piece.done, error: '' };
          return last;
        }
        // The end of the stream: after `done` it is the server closing, as it should; before, the answer broke off.
        if (last.done) return last;
        return fail(event.kind === 'Response' ? `The endpoint answered ${event.status}.` : 'The answer broke off.');
      },
    });
  },
};
export const answer: Answer = (source, args, store, storage, native) => sources[source](args, store, storage, native);
