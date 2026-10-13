import { defineAgent, defineDynamic } from 'eve';
import { selectModel } from './model';
import { studio } from './studio';
export default defineAgent({
  defaultTools: false,
  model: defineDynamic({
    events: {
      'step.started': async () => {
        const settings = await studio('settings');
        return selectModel(settings.interviewModel);
      },
    },
  }),
  experimental: { workflow: { retention: 0 } },
});
