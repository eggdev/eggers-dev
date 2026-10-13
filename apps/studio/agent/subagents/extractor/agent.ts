import { defineAgent, defineDynamic } from 'eve';
import { selectModel } from '../../model';
import { studio } from '../../studio';
export default defineAgent({
  defaultTools: false,
  description:
    'Retrieve queued job listings and extract their complete requirements with source excerpts. Uses the extraction model configured in Studio.',
  model: defineDynamic({
    events: {
      'step.started': async () => {
        const settings = await studio('settings');
        return selectModel(settings.extractionModel);
      },
    },
  }),
  experimental: { workflow: { retention: 0 } },
});
