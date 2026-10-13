import { database } from '@repo/database';
import { redirect } from 'next/navigation';
export const dynamic = 'force-dynamic';
async function unsubscribe(data: FormData) {
  'use server';
  const token = String(data.get('token') ?? '');
  if (/^[\da-f-]{36}$/.test(token)) {
    await (await database()).query('DELETE FROM subscribers WHERE unsubscribe_token=$1', [token]);
  }
  redirect('/unsubscribe?done=1');
}
export default async function Unsubscribe({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; done?: string }>;
}) {
  const { token, done } = await searchParams;
  return (
    <main className="mx-auto max-w-lg p-10">
      <h1 className="text-2xl font-semibold">
        {done ? 'You’re off the list.' : 'Launch notification'}
      </h1>
      {!done && (
        <form action={unsubscribe} className="mt-6">
          <input type="hidden" name="token" value={token ?? ''} />
          <p className="mb-4 text-muted-foreground">Remove your email from the launch list.</p>
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
            disabled={!token}
          >
            Unsubscribe
          </button>
        </form>
      )}
      <a href="/" className="mt-8 block text-sm underline">
        Back to Brendan Eggers
      </a>
    </main>
  );
}
