import { createHash, randomUUID } from 'node:crypto';
import { database } from '@repo/database';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    const origin = request.headers.get('origin');
    if (origin && new URL(origin).host !== request.headers.get('host'))
      return Response.json({ error: 'Invalid request.' }, { status: 403 });
    const text = await request.text();
    if (text.length > 4096) return Response.json({ error: 'Request too large.' }, { status: 413 });
    const data = JSON.parse(text);
    if (data.website) return Response.json({ ok: true });
    const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
    if (email.length > 254 || !/^\S+@[^\s@]+\.[^\s@]+$/.test(email))
      return Response.json({ error: 'Please enter a valid email address.' }, { status: 400 });
    const db = await database();
    // Vercel supplies x-vercel-forwarded-for; local traffic shares a single bucket.
    const address = process.env.VERCEL
      ? (request.headers.get('x-vercel-forwarded-for') ?? 'unknown')
      : 'local';
    const key = createHash('sha256').update(address).digest('hex');
    const [limit] = await db.query(
      `INSERT INTO rate_limits(key,window_start,count) VALUES($1,now(),1)
 ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.window_start<now()-interval '1 hour' THEN 1 ELSE rate_limits.count+1 END,
 window_start=CASE WHEN rate_limits.window_start<now()-interval '1 hour' THEN now() ELSE rate_limits.window_start END RETURNING count`,
      [key],
    );
    if (limit.count > 10)
      return Response.json(
        { error: 'Please try again in an hour.' },
        { status: 429, headers: { 'Retry-After': '3600' } },
      );
    await db.query(
      'INSERT INTO subscribers(id,email,unsubscribe_token) VALUES($1,$2,$3) ON CONFLICT(email) DO NOTHING',
      [randomUUID(), email, randomUUID()],
    );
    return Response.json({ ok: true });
  } catch {
    return Response.json(
      { error: 'Could not save your email. Please try again.' },
      { status: 503 },
    );
  }
}
