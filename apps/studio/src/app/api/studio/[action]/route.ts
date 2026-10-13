import { apiError, execute } from '@studio/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const allowed = new Set([
  'workspace',
  'jobs.list',
  'jobs.get',
  'jobs.track',
  'jobs.save',
  'jobs.stage',
  'jobs.delete',
  'jobs.activity.save',
  'jobs.activity.delete',
  'jobs.followup.complete',
  'settings.save',
  'roles.save',
  'roles.delete',
  'threads.create',
  'threads.get',
  'threads.phase',
  'threads.cursor',
  'threads.delete',
  'entries.save',
  'entries.history',
  'entries.delete',
  'topics.save',
  'topics.delete',
  'research.queue',
  'research.get',
  'research.fetch',
  'research.capture',
  'research.retry',
  'research.blocked',
  'research.delete',
  'proposals.accept',
  'proposals.reject',
]);
export async function POST(request: Request, { params }: { params: Promise<{ action: string }> }) {
  try {
    const { action } = await params;
    if (!allowed.has(action)) return Response.json({ error: 'Unknown action.' }, { status: 404 });
    const text = await request.text();
    if (text.length > 2_000_000)
      return Response.json({ error: 'Request too large.' }, { status: 413 });
    const result = await execute(action, text ? JSON.parse(text) : {});
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}
