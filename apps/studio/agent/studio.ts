export async function studio(
  action: string,
  input: unknown = {},
  mutationId?: string,
  signal?: AbortSignal,
): Promise<any> {
  const response = await fetch(
    `${process.env.STUDIO_INTERNAL_URL ?? 'http://127.0.0.1:3001'}/api/internal`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-studio-internal-token': process.env.STUDIO_INTERNAL_TOKEN ?? '',
        ...(process.env.VERCEL_AUTOMATION_BYPASS_SECRET
          ? { 'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET }
          : {}),
      },
      body: JSON.stringify({ action, input, mutationId }),
      signal,
    },
  );
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'Studio operation failed.');
  return result;
}
export function threadId(ctx: any): string | undefined {
  return ctx.session.auth.initiator?.attributes?.threadId;
}
