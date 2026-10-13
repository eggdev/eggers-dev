import { defineTool } from 'eve/tools';
import { studio } from '../studio';
export default defineTool({
  description:
    'Manage the job research import queue. research.queue takes urls:string[] and family. research.pending returns up to 50 queued/extracting originals. research.fetch retrieves a queued listing by id. research.extract saves id,title,company,family,seniority,location,arrangement,requirements:[{label,kind,section,quote}]; kind is technical/collaboration/leadership/product/delivery/other and quote must be verbatim source text. Never invent requirements. research.retry retries a failed listing by id.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [
          'research.queue',
          'research.pending',
          'research.fetch',
          'research.extract',
          'research.retry',
        ],
      },
      input: { type: 'object', additionalProperties: true },
    },
    required: ['action', 'input'],
    additionalProperties: false,
  },
  execute: async (input, ctx) =>
    studio(String(input.action), input.input, ctx.callId, ctx.abortSignal),
});
