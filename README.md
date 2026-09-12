# eggers.dev + Career Studio

Personal portfolio for Brendan Eggers — AI-native engineer and engineering
leader. Built as a work sample: fast, restrained, and crafted on purpose.

## Stack

- [Astro](https://astro.build) — static output, near-zero JS
- TypeScript (strict) · [Biome](https://biomejs.dev) · [lefthook](https://lefthook.dev)
- Self-hosted variable font, OKLCH color, system-adaptive light/dark
- Deployed to **Cloudflare Workers** (static assets)
- Private React + Milkdown Career Studio backed by Cloudflare D1

## Develop

```bash
bun install
bun run dev      # http://localhost:4321
bun run dev:studio # http://localhost:5173
```

```bash
bun run build    # → dist/
bun run build:studio
bun run preview
bun run test
bun run check    # portfolio + Studio typecheck
bun run lint:fix # biome format + lint
```

## Structure

```
career/           durable public résumé schema + published projection
src/
├─ pages/         routes (index, resume, 404)
├─ layouts/       BaseLayout (head, fonts, global css)
├─ components/    UI, grouped by purpose
├─ content/       work entries (typed Markdown collection)
└─ styles/        design tokens + base styles
public/           favicon, OG image, robots.txt
content/          source copy (not shipped, gitignored)
_source/          research + the build brief (not shipped, gitignored)
studio/           private D1-backed editor and résumé composer
```

Design system and conventions: see [`DESIGN.md`](./DESIGN.md),
[`PRODUCT.md`](./PRODUCT.md), and [`AGENTS.md`](./AGENTS.md).

Career Studio setup and deployment: see [`studio/README.md`](./studio/README.md).

## Deploy

**Merging to `main` deploys production.** A Git-connected Cloudflare Worker
runs `bun run build`, then serves `dist/` as static assets per
[`wrangler.jsonc`](./wrangler.jsonc). Production branch: `main`.

The wiring lives in the Cloudflare dashboard, not in the repo — there is no
`.github/workflows/`, so don't read its absence as "pushing won't ship."

`bun run deploy` builds and ships from your machine, for out-of-band deploys.
