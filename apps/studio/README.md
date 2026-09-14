# Studio

The Access-gated CMS for `eggers.dev`. Studio edits one structured public-site document, autosaves
revisioned drafts to the shared D1 database, creates expiring real-renderer previews, and publishes
one validated public projection to Workers KV.

Git commits are no longer part of publishing. The old GitHub App, private-key conversion, and
cross-service repository write path have been removed.

## Local development

```bash
bun run --cwd apps/studio db:migrate:local
bun run dev:studio
```

Visit `http://localhost:5173`. Loopback requests use the explicit local auth bypass and identify as
the first entry in `ALLOWED_EMAILS`.

## Data and publication seams

- `@repo/content` owns the complete Effect Schema and strips hidden résumé fields.
- `@repo/cms` owns draft, preview, and publication workflows.
- `@repo/database/cms` implements the draft and audit repository in D1.
- `PUBLIC_CONTENT` stores the single current publication and one-hour preview snapshots.
- Web is the only renderer; Studio preview URLs use Web's `/preview/:id` route.

The advanced JSON editor exposes every publishable field, but applies it only after the same schema
validation used by the Worker.

## Production

Do not deploy while the Wrangler resource IDs are placeholders. Follow the repository
[Cloudflare cutover runbook](../../docs/cloudflare-cutover.md), then:

```bash
bun run deploy:studio
```
