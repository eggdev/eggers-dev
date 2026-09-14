# Home

Private family tools at `home.eggers.dev`. Home is a React/Vite application served through a
Cloudflare Worker. The Worker authenticates every request with Cloudflare Access before serving
assets or the Effect-backed API.

Honeymoon planning is the first domain. Private dates, point balances, planning notes, and imported
research live only in the shared D1 database and must never be committed.

## Local development

```bash
bun run --cwd apps/home db:migrate:local
bun run dev:home
```

Loopback requests use the explicit local auth bypass. An empty database renders import guidance;
it does not fabricate planning data.

Import private research from an absolute local path:

```bash
bun run --cwd apps/home db:import -- /absolute/path/to/honeymoon-handoff.zip --local
bun run --cwd apps/home db:import:hotels -- /absolute/path/to/hotel-research.json --local
```

Remote imports always require the explicit `--remote` flag.

## Architecture

- `src/` composes the shared shadcn-style UI and Home API client.
- `src/worker/` is the thin Request → Effect → Response application boundary.
- `@repo/home` owns contracts, input schemas, and repository service interfaces.
- `@repo/database/home` owns D1 query implementation.
- `packages/database/migrations/` is the only migration stream for Home and CMS tables.

Destination changes use optimistic revisions. Research entries remain additive and keep source,
confidence, and verification metadata.

## Production

Follow the repository [Cloudflare cutover runbook](../../docs/cloudflare-cutover.md) before the first
monorepo deployment, then:

```bash
bun run deploy:home
```
