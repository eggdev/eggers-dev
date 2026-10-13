import { timingSafeEqual } from 'node:crypto';
import { apiError, execute } from '@studio/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const allowed = new Set([
  'map.get',
  'map.catalog',
  'map.labels',
  'map.pending',
  'map.capability',
  'map.concept.save',
  'map.capability.save',
  'map.link',
  'map.unlink',
  'map.capability.delete',
  'settings',
  'context',
  'threads.get',
  'messages.save',
  'roles.save',
  'roles.delete',
  'entries.save',
  'entries.delete',
  'topics.save',
  'topics.delete',
  'research.pending',
  'research.summary',
  'research.queue',
  'research.fetch',
  'research.capture',
  'research.extract',
  'research.retry',
]);
export async function POST(request: Request) {
  const expected = process.env.STUDIO_INTERNAL_TOKEN;
  const given = request.headers.get('x-studio-internal-token');
  if (
    !expected ||
    !given ||
    expected.length !== given.length ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(given))
  )
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const text = await request.text();
    if (text.length > 2_000_000)
      return Response.json({ error: 'Request too large.' }, { status: 413 });
    const { action, input, mutationId } = JSON.parse(text);
    if (!allowed.has(action)) return Response.json({ error: 'Unknown action.' }, { status: 404 });
    return Response.json(await execute(action, input, 'eve', mutationId), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return apiError(error);
  }
}
