import { defineHook } from 'eve/hooks';
import { studio, threadId } from '../studio';
export default defineHook({
  events: {
    'message.received': async (event, ctx) => {
      const id = threadId(ctx);
      if (id)
        await studio('messages.save', {
          id: event.meta.id,
          threadId: id,
          sessionId: ctx.session.id,
          kind: 'user',
          turnId: event.data.turnId,
          body: event.data.message,
        });
    },
    'message.completed': async (event, ctx) => {
      const id = threadId(ctx);
      if (id)
        await studio('messages.save', {
          id: event.meta.id,
          threadId: id,
          sessionId: ctx.session.id,
          kind: 'assistant',
          turnId: event.data.turnId,
          body: event.data.message,
        });
    },
  },
});
