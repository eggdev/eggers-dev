// The Cloudflare Worker for the public site: POST /ask answers from the approved collection; every other path is
// the built site in dist/ (wrangler.jsonc "assets"), its 404 page included.
//
// private/collection.md is the owner's approved public collection. It is not in git: tools/deploy.ts copies it
// here just before `wrangler deploy` (or a test collection, with --collection), and wrangler.jsonc's "rules"
// bundle it as text.
import collection from './private/collection.md';
import { worker } from './ask.ts';

export default worker(collection);
