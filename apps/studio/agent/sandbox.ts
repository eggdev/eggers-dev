import { defineSandbox, type SandboxSession } from 'eve/sandbox';
import { defineSandboxProvider } from 'eve/sandbox/provider';

// Studio's authored tools use its API and public web fetching. No shell or filesystem tools
// are exposed, so avoid provisioning a VM merely to prepare the agent bundle.
const ApiOnlySandbox = defineSandboxProvider<undefined, undefined, null, null, SandboxSession>({
  name: 'studio-api-only',
  environment() {
    return {
      async prepare() {
        return null;
      },
      async start() {
        throw new Error('Studio does not expose sandbox tools.');
      },
      async resume() {
        throw new Error('Studio does not expose sandbox tools.');
      },
    };
  },
});
export const environment = ApiOnlySandbox.environment();
export default defineSandbox(() => environment.open());
