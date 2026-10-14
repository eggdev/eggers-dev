import { defineTool } from 'eve/tools';
import { studio } from '../studio';
export default defineTool({
  description:
    'Manage the job research import queue. research.queue takes urls:string[] and family. research.summary reports total counts and source gaps; always check it before reporting completion. research.pending returns up to 5 queued/extracting originals. research.fetch retrieves a queued listing by id. research.extract saves id,title,company,family,track,seniority,level,location,arrangement,requirements:[{label,kind,section,quote}]; track is software/frontend/full_stack/platform/forward_deployed/product/technical_product/other and level is early/mid/senior/staff/principal or empty when the source does not say; kind is technical/collaboration/leadership/product/delivery/other and quote must be verbatim source text. Never invent requirements. research.retry retries a failed listing by id.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [
          'research.queue',
          'research.pending',
          'research.summary',
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
