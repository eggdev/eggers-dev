# Career Studio

Private, single-user workspace for Brendan's career knowledge base and résumé composition. The
Studio runs as its own Cloudflare Worker at `studio.eggers.dev`; its drafts live in D1. Publishing
writes one validated, public-only projection to `career/public-resume.json` on `main`, which rebuilds
the static résumé at `eggers.dev/resume`.

## Local development

From the repository root:

```bash
bun install
bun run --cwd studio db:migrate:local
bun run dev:studio # http://localhost:5173
```

Loopback requests bypass Access for local development. Production requests still require a valid
Access assertion for the configured audience and exact allowed email. Local publishing is optional;
copy `.dev.vars.example` to `.dev.vars` and supply a GitHub App private key if you need to test it.

## Production setup

1. In Cloudflare Zero Trust, create a self-hosted Access application for `studio.eggers.dev`. Allow
   only `brendan@eggers.dev`.
2. Copy the Access team domain and application audience (`AUD`) into `ACCESS_TEAM_DOMAIN` and
   `ACCESS_AUD` in `wrangler.jsonc`.
3. Create a GitHub App with repository `Contents: read and write`, no webhook, and no other
   permissions. Install it only on `eggdev/eggers-dev`.
4. Put its App ID and installation ID in `wrangler.jsonc`.
5. Deploy the Studio Worker. Its provisioned D1 database is registered in `wrangler.jsonc`:

   ```bash
   bun run deploy:studio
   ```

6. Apply the remote schema and add the private key secret:

   ```bash
   bun run --cwd studio db:migrate:remote
   cd studio && bunx wrangler secret put GITHUB_PRIVATE_KEY
   ```

The first authenticated request seeds D1 from the existing résumé and selected public work. Draft
edits autosave to D1. Publishing is explicit, is limited to the canonical résumé, and is rejected
while any included claim is marked `unverified`.

## Useful commands

```bash
bun run dev:studio
bun run build:studio
bun run --cwd studio check
bun run deploy:studio
```

The legacy hand-authored files in `resume/` remain historical deliverables. The generated public
route is sourced from `career/public-resume.json`.
