import { defineTool } from 'eve/tools';
import { studio, threadId } from '../studio';
export default defineTool({
  description:
    'Read current context or create/update/delete private career knowledge and interview topics. Entry writes require title, markdown, skills, sourceMessageIds, optional roleId/id, optional capabilityIds (requirement-map capability IDs the story itself demonstrates; a supplied list replaces existing links, omission keeps them), and expectedRevision for updates. Role writes require title and optionally company/dates/context. Topic writes require label, status (unexplored, exploring, sufficient, revisit), optional roleId, notes and id. Review setting is enforced by Studio. Deletion is permanent.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [
          'context',
          'roles.save',
          'roles.delete',
          'entries.save',
          'entries.delete',
          'topics.save',
          'topics.delete',
        ],
      },
      input: { type: 'object', additionalProperties: true },
    },
    required: ['action', 'input'],
    additionalProperties: false,
  },
  execute: async (input, ctx) =>
    studio(
      String(input.action),
      {
        ...(input.input as object),
        ...(input.action === 'context' ? { threadId: threadId(ctx) } : {}),
      },
      ctx.callId,
      ctx.abortSignal,
    ),
});
