// The Cloudflare Worker for the private studio: the Access check on every request, then /api/... to the server on
// the owner's machine and every other path from the built screens in dist/ (studio.ts, access.ts).
//
// The gate is made once per isolate, so the Access keys it fetches stay in module memory between requests.
import { createGate } from './access.ts';
import { worker } from './studio.ts';

export default worker({
  gate: createGate({ fetch: (url) => fetch(url) }),
  log: (msg) => console.log(msg),
});
