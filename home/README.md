# Eggers Home

Private family tools at `home.eggers.dev`. Home is a Vite/React single-page app served by a
Cloudflare Worker. The Worker validates Cloudflare Access before serving either the app shell or
the D1-backed API.

Honeymoon planning is the first module. Finances and meal planning are represented only as future
areas in the shell; they have no routes or data yet.

## Privacy boundary

This repository is public. Personal travel dates, point balances, planning notes, and research data
must stay in D1 and must never be committed to Git. The importer reads the handoff ZIP from any local
path, writes through Wrangler, and removes its temporary SQL file when finished.

Each import creates an immutable `research_run` snapshot before updating the working destination,
hotel, source, points, and transfer tables. Personal shortlist/status/note fields are preserved when
the same destination is re-imported.

Hotel research imports require one funding plan per hotel. Each plan records an assumed stay,
points range, points/cash target, eligible transfer currencies, reliability, estimate basis, and a
recommendation. The browser compares those plans with the current D1 balances and transfer paths;
it does not assume unrecorded household points or speculative transfers.

## Local development

From the repository root:

```bash
bun install
bun run --cwd home db:import -- /absolute/path/to/honeymoon-handoff.zip --local
bun run --cwd home db:import:hotels -- /absolute/path/to/hotel-research.json --local
bun run dev:home
```

The import command applies pending local migrations automatically. Localhost bypasses Cloudflare
Access and identifies the session as the first address in `ALLOWED_EMAILS`.

Useful checks:

```bash
bun run --cwd home check
bun run --cwd home build
bun run --cwd home preview
```

## Production setup

1. Create the D1 database and copy its ID into `home/wrangler.jsonc`:

   ```bash
   cd home
   bunx wrangler d1 create eggers-home
   ```

2. In Cloudflare Zero Trust, create a self-hosted Access application for `home.eggers.dev`. The
   initial allow policy should include only `brendan@eggers.dev`.
3. Copy the new application's audience tag into `ACCESS_AUD` in `home/wrangler.jsonc`. The existing
   Eggers Access team domain is already configured.
4. Deploy the empty gated app before importing private data:

   ```bash
   bun run deploy:home
   ```

5. Import the handoff into remote D1. `--remote` must always be explicit:

   ```bash
   bun run --cwd home db:import -- /absolute/path/to/honeymoon-handoff.zip --remote
   bun run --cwd home db:import:hotels -- /absolute/path/to/hotel-research.json --remote
   ```

6. Reopen `home.eggers.dev` through Access.

To add Emina later, update the Cloudflare Access allow policy and append `emina@eggers.dev` to the
comma-separated `ALLOWED_EMAILS` defense-in-depth allowlist before deploying.

## Architecture

- `src/` — React decision cockpit and API client
- `worker/` — Access validation, request security, input validation, and D1 queries
- `migrations/` — versioned D1 schema
- `scripts/import-handoff.ts` — private ZIP-to-D1 importer
- `scripts/import-hotel-research.ts` — repeatable hotel research importer
- `shared.ts` — browser/Worker contract

The app stores user-entered research additively. Every finding carries a confidence state and can
include its source and verification date. Destination planning updates use optimistic revisions so
future multi-user edits fail visibly instead of silently overwriting one another.
