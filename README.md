# eggers.dev

Personal portfolio for Brendan Eggers — AI-native engineer and engineering
leader. Built as a work sample: fast, restrained, and crafted on purpose.

## Stack

- [Astro](https://astro.build) — static output, near-zero JS
- TypeScript (strict) · [Biome](https://biomejs.dev) · [lefthook](https://lefthook.dev)
- Self-hosted variable font, OKLCH color, system-adaptive light/dark
- Deployed to **Cloudflare Pages**

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
├─ styles/        design tokens + base styles
└─ assets/        fonts, imagery
content/          source copy (not shipped)
_source/          research + the build brief (not shipped)
```

Design system and conventions: see [`DESIGN.md`](./DESIGN.md),
[`PRODUCT.md`](./PRODUCT.md), and [`AGENTS.md`](./AGENTS.md).

## Deploy

Cloudflare Pages, static build. Build command `bun run build`, output `dist/`.
