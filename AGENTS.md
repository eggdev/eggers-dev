# AGENTS.md — eggers.dev

Personal portfolio for Brendan Eggers. Single-page Astro site, static output,
deployed to Cloudflare Workers (static assets via `wrangler.jsonc`). The site
itself is a work sample: its craft,
speed, and restraint are part of the argument. Build it that way.

## Commands

- `bun run dev` — local dev server (http://localhost:4321)
- `bun run build` — production build to `dist/`
- `bun run preview` — serve the built site
- `bun run check` — `astro check` (typecheck; run before pushing)
- `bun run lint:fix` — Biome format + lint with autofix

Use `bun`, not npm/pnpm. Conventional commits. Commit, don't push, unless asked.

## Deploy

**Anything that lands on `main` ships to production.** A Git-connected
Cloudflare Worker builds the site and serves `dist/` per `wrangler.jsonc`.
That includes merging a branch into `main`, not just pushing commits to it.

There is no GitHub Actions workflow, so the absence of `.github/workflows/` is
not evidence that pushing is safe. The deploy is wired up in the Cloudflare
dashboard and is invisible from inside the repo.

`bun run deploy` builds and ships from a local machine. It is the out-of-band
path; normal work reaches production through `main`.

## Structure

- `src/pages/` — routes (`index.astro`, `404.astro`). Only reserved dir.
- `src/layouts/BaseLayout.astro` — `<head>`, meta, fonts, global CSS.
- `src/components/` — PascalCase, grouped by purpose. One concern each.
- `src/content/work/` — work entries as Markdown (typed collection).
- `src/content.config.ts` — Zod schema for collections. Schema is the contract.
- `src/styles/global.css` — design tokens (OKLCH) + base styles.
- `public/` — favicon, OG image, `robots.txt`. Fonts come from the
  `@fontsource-variable` package, not a checked-in directory.
- `content/`, `_source/` — source copy and research. Not shipped, and
  gitignored because this repo is public. Don't import, don't un-ignore.

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
- Lead with git-verified numbers. State self-reported figures plainly, no false
  precision. Never invent a metric.

## Performance

- Static output, near-zero JS. Ship JS only where it earns its place (sticky-nav
  active state, the dot-matrix). Self-host fonts. Keep the repo lean: no build
  output, no stray media. Two binaries are committed on purpose and stay put —
  `public/og.png`, the social share card, which is a required static asset; and
  `resume/brendan-eggers-resume.pdf`, a rendered deliverable kept in sync with
  `resume/brendan-eggers-resume.html`. Do not delete either one.
