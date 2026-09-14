# AGENTS.md — eggers.dev

Nx monorepo for Brendan Eggers' public portfolio, CMS, and private Home workspace. The public Astro
site is a Cloudflare Worker with on-demand content; Studio and Home are independently deployed
React/Vite Workers. The public site itself is a work sample: its craft, speed, and restraint are
part of the argument. Build it that way.

## Commands

- `bun run dev` — all apps through Nx
- `bun run dev:web|dev:studio|dev:home` — one app only
- `bun run build` — all production builds through Nx
- `bun run check` — TypeScript/Astro plus generated Wrangler binding checks
- `bun run test` — Vitest and Cloudflare Workers/D1 integration tests
- `bun run test:e2e` — Playwright smoke tests for all apps
- `bun run lint` — Oxlint, Nx module boundaries, and the alias-only import gate
- `bun run lint:fix` — Biome/Oxlint autofix followed by the import gate

Use `bun`, not npm/pnpm. Conventional commits. Commit, don't push, unless asked.

## Deploy

**Anything that lands on `main` ships to production.** A Git-connected
Cloudflare Worker builds the site and serves `dist/` per `wrangler.jsonc`.
That includes merging a branch into `main`, not just pushing commits to it.

The GitHub workflow verifies only; deployment is wired up separately in the Cloudflare dashboard.
Use `bun run deploy:web`, `bun run deploy:studio`, or `bun run deploy:home` for an explicit local
deployment. There is intentionally no deploy-all command. Wrangler configs contain resource
placeholders until `docs/cloudflare-cutover.md` has been completed.

## Structure

- `apps/web/` — public Astro renderer. Reads a published KV snapshot server-side.
- `apps/studio/` — Access-gated structured CMS. Drafts/audit in D1; publications/previews in KV.
- `apps/home/` — Access-gated private family workspace backed by D1.
- `packages/content/` — Effect Schema contracts, public projection, and checked-in fallback.
- `packages/database/` — the single D1 migration stream and `queries/cms`, `queries/home` adapters.
- `packages/ui/` — customized shadcn-style React primitives for Studio and Home.
- `packages/design/` — Tailwind v4 theme tokens and shared source styles.
- `packages/auth`, `packages/worker` — Cloudflare Access and the shared Effect HTTP boundary.
- `public/` — favicon, OG image, `robots.txt`. Fonts come from the
  `@fontsource-variable` package, not a checked-in directory.
- `content/`, `_source/` — source copy and research. Not shipped, and
  gitignored because this repo is public. Don't import, don't un-ignore.

Apps do not import apps. Use `@web/*`, `@studio/*`, and `@home/*` inside apps and `@repo/*` for
packages. Do not add relative source imports; the rule is enforced. Backend services are Effect 3
programs. The thin native Worker handler is only the Request → Effect → Response bridge. Use Effect
Schema, not Zod, for domain and request contracts.

## Design rules (non-negotiable; full spec in DESIGN.md)

- **Color:** near-monochrome base, cobalt accent (hue 230) on ≤10% of any view.
  One warm counter-accent, exactly one job (the contact CTA). Light + dark are
  both first-class via `prefers-color-scheme`. No theme toggle. Dark = cool
  slate, never navy.
- **Type:** ONE weight-driven grotesque, self-hosted. Hierarchy from weight +
  scale (≥1.25 ratio), not a second family. Tabular figures for metrics. No
  mono. Banned: Inter, DM Sans, Space Grotesk, Plus Jakarta.
- **Depth:** flat. Tonal steps + 1px hairlines, not shadows. Shadow only as a
  hover/focus response. No glassmorphism.
- **Motion:** quiet and intentional. The dot-matrix is the one signature
  animation. Never hijack scroll. Every animation needs a
  `prefers-reduced-motion: reduce` fallback. Reveals enhance an
  already-visible default (never gate content on a transition).
- **Contrast:** body ≥4.5:1, large ≥3:1, placeholders included, in BOTH themes.
  WCAG 2.1 AA is the floor.

## Hard bans (rewrite if you reach for these)

- Generic dev-portfolio template (purple gradient, skill bars, identical cards).
- SaaS marketing clichés (hero-metric blocks, feature-icon grids, gradient buttons).
- The AI editorial-magazine look (serif italic + tiny tracked mono eyebrows + ruled columns).
- `border-left`/`border-right` > 1px as a colored accent stripe. Gradient text.
- Cards as the default. Work entries are hairline-separated, type-led, NOT a card grid.

## Content & honesty

- Work entries lead with the shipped outcome, then the how.
- Lead with specific, defensible numbers. Avoid false precision. Never invent a
  metric.

## Performance

- Server-rendered output with near-zero client JS. Ship browser JS only where it earns its place
  (sticky-nav active state, the dot-matrix). Self-host fonts. Keep the repo lean: no build
  output, no stray media. Two binaries are committed on purpose and stay put —
  `public/og.png`, the social share card, which is a required static asset; and
  `resume/brendan-eggers-resume.pdf`, a rendered deliverable kept in sync with
  `resume/brendan-eggers-resume.html`. Do not delete either one.
