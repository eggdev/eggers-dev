# eggers.dev

An Nx monorepo for Brendan Eggers' public portfolio and private tools. The layout follows the
structural ideas in [next-forge](https://www.next-forge.com/docs/structure): independently
deployable apps, shared implementation packages, app-owned environment composition, and enforced
dependency boundaries. Nx replaces Turborepo as the workspace engine.

## Applications

| App | Host | Runtime | Access |
| --- | --- | --- | --- |
| `web` | `eggers.dev` | Astro SSR on Cloudflare Workers | Public; `/preview/*` requires Access |
| `studio` | `studio.eggers.dev` | React/Vite + Worker | Entire app requires Access |
| `home` | `home.eggers.dev` | React/Vite + Worker | Entire app requires Access |

Studio is the CMS for Web. It autosaves one structured whole-site draft to D1 and explicitly
publishes one validated snapshot to Workers KV. Web reads that snapshot server-side and falls back
to the checked-in seed when KV is empty or temporarily unavailable. Home and Studio share one D1
database but use separate query modules and tables.

## Develop

```bash
bun install
bun run dev             # all three apps
bun run dev:web         # http://localhost:4321
bun run dev:studio      # http://localhost:5173
bun run dev:home        # http://localhost:5174
```

Local Studio and Home setup:

```bash
bun run --cwd apps/studio db:migrate:local
bun run --cwd apps/home db:migrate:local
```

Loopback requests use the explicit local Access bypass in each app's Wrangler configuration. Any
non-loopback request fails closed without a valid Cloudflare Access assertion.

## Quality gates

```bash
bun run lint             # Oxlint, Nx boundaries, and no-relative-import check
bun run check            # TypeScript, Astro, and generated Wrangler binding drift
bun run test             # Vitest plus Cloudflare Workers/D1 integration
bun run test:e2e         # Playwright smoke coverage for all three apps
bun run build            # Nx-cached production builds
```

All local source imports must use `@web/*`, `@studio/*`, `@home/*`, or `@repo/*`. Relative source
imports are rejected by both Oxlint and the repository import check.

## Structure

```text
apps/
├── web/                 public Astro renderer and preview route
├── studio/              structured CMS and publishing Worker
└── home/                private family workspace
packages/
├── auth/                Cloudflare Access identity service
├── cms/                 draft, preview, and publication workflows
├── content/             Effect Schema contracts and checked-in fallback
├── database/            shared D1 migrations and domain query adapters
├── design/              Tailwind v4 tokens and shared source styles
├── home/                Home contracts and Effect services
├── ui/                  customized shadcn-style React primitives
└── worker/              shared Request → Effect → Response boundary
```

The applications never import one another. Domain packages describe policy and contracts;
infrastructure packages implement Cloudflare and database concerns; apps compose those layers.
See [Architecture](docs/architecture.md) for the dependency rules.

## Deployment

Deployment remains deliberately explicit—there is no deploy-all command:

```bash
bun run deploy:web
bun run deploy:studio
bun run deploy:home
```

The checked-in Wrangler files still contain IDs that must be replaced during the production
cutover. Do not deploy until [Cloudflare cutover](docs/cloudflare-cutover.md) is complete.

Anything that lands on `main` may ship through the existing Cloudflare Git integrations. CI only
verifies; it does not deploy. Configure each Worker build independently and use app-specific watch
paths. Commit, do not push, unless deployment is intended.

Public visual constraints remain in [DESIGN.md](DESIGN.md). Repository rules for agents and
contributors are in [AGENTS.md](AGENTS.md).
