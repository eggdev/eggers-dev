import { database } from '@repo/database';
import { createCareerService, DomainError } from '@repo/domain';
import { Effect } from 'effect';
import { Client } from 'eve/client';

export async function execute(
  action: string,
  input: unknown,
  actor: 'owner' | 'eve' = 'owner',
  mutationId?: string,
) {
  const service = createCareerService(await database(), async (session) => {
    const id = session?.id ?? session?.sessionId;
    if (!id) return;
    const client = new Client({
      host: process.env.STUDIO_INTERNAL_URL ?? 'http://127.0.0.1:3001',
      headers: {
        'x-studio-internal-token': process.env.STUDIO_INTERNAL_TOKEN ?? '',
        ...(process.env.VERCEL_AUTOMATION_BYPASS_SECRET
          ? { 'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET }
          : {}),
      },
    });
    await client.sessions.attach(id).reset({ reason: 'Owner requested deletion' });
  });
  return Effect.runPromise(service.execute(action, input, actor, mutationId));
}
export function apiError(error: unknown) {
  return Response.json(
    {
      error:
        error instanceof DomainError ? error.message : 'Studio could not complete that operation.',
    },
    { status: error instanceof DomainError ? error.status : 500 },
  );
}
