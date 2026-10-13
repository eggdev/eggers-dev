import { defineTool } from 'eve/tools';
import { studio } from '../studio';
export default defineTool({
  description: `Curate the requirement hierarchy and read experience guides. All IDs are stable lowercase slugs. map.catalog returns concepts/capabilities, their revisions, guides and counts. map.labels returns current source labels and keys for a corpus overview. map.pending returns up to 30 unmapped requirements with original excerpts. map.capability takes {id} and returns the guide and exact source evidence.
map.concept.save takes {id,label,description,expectedRevision?}. map.capability.save takes {id,label,kind,description,experienceGuide,prompts:string[],distinctions,conceptIds:string[],expectedRevision?}; kind is technical/collaboration/leadership/product/delivery/other. Existing records require their current expectedRevision. Create concepts first. Capabilities may belong to multiple concepts.
map.link takes {mappings:[{listingId,requirementKey,capabilityIds:string[]}]} and adds associations, preserving existing ones. Source keys must come from map.pending/map.labels; never invent them. map.unlink takes {listingId,requirementKey,capabilityId}. map.capability.delete takes {id}, permanently removing it and its associations. These tools organize market requirements, never claims about the owner's experience.`,
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [
          'map.catalog',
          'map.labels',
          'map.pending',
          'map.capability',
          'map.concept.save',
          'map.capability.save',
          'map.link',
          'map.unlink',
          'map.capability.delete',
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
