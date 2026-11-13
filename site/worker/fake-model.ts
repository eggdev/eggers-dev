// A fake model for tests and local runs: it speaks the OpenAI Chat Completions streaming format and calls no
// real provider. `bun worker/fake-model.ts [port]` serves it at http://127.0.0.1:<port>/v1 (default 8798).
// Point the Worker at it with MODEL_BASE_URL=http://127.0.0.1:<port>/v1.
//
// It answers every question with REPLY, a few words per chunk, and writes each chunk in two network writes split
// in the middle of a line, as a real stream may arrive. The last request it got is kept in `lastRequest`.

export const REPLY = 'Ada Example leads the data platform team at Acme Widgets. Her team of six builds the pipelines that move order data into the warehouse.';

export type FakeModel = { url: string; stop: () => void; lastRequest: () => { authorization: string | null; body: unknown } | null };

function chunk(content: string | null, finish: string | null) {
  const delta = content === null ? {} : { content };
  return `data: ${JSON.stringify({ id: 'fake', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
}

export function startFakeModel(port = 0, reply = REPLY): FakeModel {
  let last: { authorization: string | null; body: unknown } | null = null;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port,
    async fetch(req) {
      const { pathname } = new URL(req.url);
      if (req.method !== 'POST' || pathname !== '/v1/chat/completions') return new Response('not found', { status: 404 });
      last = { authorization: req.headers.get('authorization'), body: await req.json().catch(() => null) };
      const words = reply.match(/\S+\s*/g) ?? [];
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          const write = async (text: string) => {
            // Two writes per event, split mid-line.
            const cut = Math.floor(text.length / 2);
            controller.enqueue(encoder.encode(text.slice(0, cut)));
            await Bun.sleep(5);
            controller.enqueue(encoder.encode(text.slice(cut)));
          };
          await write(`data: ${JSON.stringify({ id: 'fake', choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] })}\n\n`);
          for (let i = 0; i < words.length; i += 3) await write(chunk(words.slice(i, i + 3).join(''), null));
          await write(chunk(null, 'stop'));
          await write('data: [DONE]\n\n');
          controller.close();
        },
      });
      return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
    },
  });
  return { url: `http://127.0.0.1:${server.port}/v1`, stop: () => server.stop(true), lastRequest: () => last };
}

if (import.meta.main) {
  const model = startFakeModel(Number(process.argv[2] ?? 8798));
  console.log(`fake-model.ts: ${model.url}`);
}
