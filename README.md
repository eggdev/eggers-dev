# eggers.dev

Personal portfolio for Brendan Eggers — AI-native engineer and engineering
leader. Built as a work sample: fast, restrained, and crafted on purpose.

## Stack

- [Astro](https://astro.build) — static output, near-zero JS
- TypeScript (strict) · [Biome](https://biomejs.dev) · [lefthook](https://lefthook.dev)
- Self-hosted variable font, OKLCH color, system-adaptive light/dark
- Deployed to **Cloudflare Workers** (static assets)

## Develop

```bash
bun install
bun run dev      # http://localhost:4321
```

```bash
bun run build    # → dist/
bun run preview
bun run check    # astro check (typecheck)
bun run lint:fix # biome format + lint
```

## Structure

```
src/
├─ pages/         routes (index, 404)
├─ layouts/       BaseLayout (head, fonts, global css)
├─ components/    UI, grouped by purpose
├─ content/       work entries (typed Markdown collection)
└─ styles/        design tokens + base styles
public/           favicon, OG image, robots.txt
content/          source copy (not shipped, gitignored)
_source/          research + the build brief (not shipped, gitignored)
```

Design system and conventions: see [`DESIGN.md`](./DESIGN.md),
[`PRODUCT.md`](./PRODUCT.md), and [`AGENTS.md`](./AGENTS.md).

## Deploy

**Merging to `main` deploys production.** A Git-connected Cloudflare Worker
runs `bun run build`, then serves `dist/` as static assets per
[`wrangler.jsonc`](./wrangler.jsonc). Production branch: `main`.

The wiring lives in the Cloudflare dashboard, not in the repo — there is no
`.github/workflows/`, so don't read its absence as "pushing won't ship."

`bun run deploy` builds and ships from your machine, for out-of-band deploys.
