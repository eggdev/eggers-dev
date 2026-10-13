import { defineAgent } from 'eve';
import { mockModel } from 'eve/evals';
export default defineAgent({
  defaultTools: false,
  model: mockModel(({ lastUserMessage, userMessageCount, toolResults }) => {
    if (lastUserMessage?.startsWith('Fixture save:')) {
      if (!toolResults.length)
        return { toolCalls: [{ name: 'career', input: { action: 'context', input: {} } }] };
      if (toolResults.length === 1) {
        const context = toolResults[0].output as any;
        return {
          toolCalls: [
            {
              name: 'career',
              input: {
                action: 'entries.save',
                input: {
                  title: 'Tool-authored entry',
                  markdown: lastUserMessage,
                  skills: ['Collaboration'],
                  sourceMessageIds: [context.messages[0].id],
                },
              },
            },
          ],
        };
      }
      return toolResults.some((result) => result.isError)
        ? 'Tool failed.'
        : 'Saved through the career tool.';
    }
    return `Turn ${userMessageCount}: ${lastUserMessage}`;
  }),
  tool: false,
  experimental: { workflow: { retention: 0 } },
});
