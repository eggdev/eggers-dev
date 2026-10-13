import { timingSafeEqual } from 'node:crypto';
import { localDev } from 'eve/channels/auth';
import { defaultEveAuth, eveChannel } from 'eve/channels/eve';
import { studio } from '../studio';

const local = localDev();
export default eveChannel({
  onMessage: (ctx) => ({ auth: defaultEveAuth(ctx), title: 'Private Studio conversation' }),
  auth: [
    async (request) => {
      const expected = process.env.STUDIO_INTERNAL_TOKEN;
      const actual = request.headers.get('x-studio-internal-token');
      if (
        expected &&
        actual &&
        expected.length === actual.length &&
        timingSafeEqual(Buffer.from(expected), Buffer.from(actual))
      )
        return {
          principalId: 'owner',
          principalType: 'user' as const,
          authenticator: 'studio-internal',
          attributes: {},
        };
      const principal = await local(request);
      if (!principal) return null;
      const threadId = request.headers.get('x-studio-thread-id');
      if (!threadId) return null; // Every conversation must belong to a persisted Studio thread.
      try {
        await studio('threads.get', { id: threadId });
      } catch {
        return null;
      }
      return { ...principal, attributes: { ...principal.attributes, threadId } };
    },
  ],
});
