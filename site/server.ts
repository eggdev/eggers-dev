// A stand-in for the chat endpoint, so the dev loop, `serve`, `test` and `verify` need no network and no model.
// `bun server.ts` listens at API (app.ts); `test` and `verify` run it themselves. It calls no model: every question
// gets the same fixed answer, streamed in pieces with short pauses, as the real endpoint streams.
//
// The contract the real endpoint follows:
//   POST {API_BASE_URL}/ask   {"messages": [{"role": "user" | "assistant", "content": "..."}]}
//   200 text/event-stream: `data: {"delta": "<piece>", "text": "<answer so far>"}` per piece,
//                          then `data: {"done": true, "text": "<whole answer>"}`, then the stream closes.
//   Anything else (a 4xx or 5xx with a JSON body) is a failure the page reports.
// A question that contains FAIL_MARKER fails with a 500, so tests can reach the page's error state.
import { API } from './app.ts';

export const FAIL_MARKER = 'stand-in-fail';
const REPLY = 'This is a stand-in reply. The real assistant is not connected yet, so this page cannot answer questions yet. Until it is, the email link at the top of the page reaches me.';
const PAUSE_MS = 40;

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST, OPTIONS' };
const fail = (error: string, status: number) => Response.json({ error }, { status, headers: CORS });

type Message = { role: 'user' | 'assistant'; content: string };
function isMessages(value: unknown): value is Message[] {
  return Array.isArray(value) && value.length > 0 && value.every(m => m !== null && typeof m === 'object'
    && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string');
}

// The reply in pieces of a few words, each with its trailing space, so the pieces join back to REPLY.
function pieces(text: string, words = 4): string[] {
  const parts = text.match(/\S+\s*/g) ?? [];
  const out: string[] = [];
  for (let i = 0; i < parts.length; i += words) out.push(parts.slice(i, i + words).join(''));
  return out;
}

const { hostname, port } = new URL(API);
Bun.serve({ hostname, port: Number(port), routes: {
  '/ask': {
    OPTIONS: () => new Response(null, { status: 204, headers: CORS }),
    POST: async (req) => {
      const body = await req.json().catch(() => null) as { messages?: unknown } | null;
      if (!body || !isMessages(body.messages)) return fail('Send {"messages": [{"role", "content"}, ...]}.', 400);
      const question = body.messages.at(-1)!;
      if (question.role !== 'user') return fail('The last message must be the question.', 400);
      if (question.content.includes(FAIL_MARKER)) return fail('A failure the question asked for.', 500);
      const encoder = new TextEncoder();
      const event = (data: unknown) => encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
      const stream = new ReadableStream({
        async start(controller) {
          let text = '';
          for (const delta of pieces(REPLY)) {
            await Bun.sleep(PAUSE_MS);
            text += delta;
            controller.enqueue(event({ delta, text }));
          }
          controller.enqueue(event({ done: true, text }));
          controller.close();
        },
      });
      return new Response(stream, { headers: { ...CORS, 'content-type': 'text/event-stream', 'cache-control': 'no-cache' } });
    },
  },
} });
console.log(`server.ts: ${API}`);
