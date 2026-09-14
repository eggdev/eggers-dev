# Architecture

This workspace adapts next-forge's structural model to Nx: apps are independent deployment units;
packages isolate shared capabilities and replaceable implementations; app-local environment modules
compose their bindings. Nx and Oxlint make those seams executable constraints.

## Dependency direction

```text
apps/web ───────────────┐
apps/studio ────────────┼──> domain packages ───> foundation
apps/home ──────────────┘          │
        │                          │
        └──> infrastructure <──────┘

foundation:     @repo/design, @repo/ui
domain:         @repo/content, @repo/cms, @repo/home
infrastructure: @repo/auth, @repo/database, @repo/worker
```

Applications may use packages but never another application. Domain code defines terms, schemas,
errors, and Effect service interfaces. Infrastructure code implements those services for D1, KV,
Cloudflare Access, and Workers. The app Worker composes Layers and translates HTTP only at the edge.

## Import contract

- Web-local code uses `@web/*`.
- Studio-local code uses `@studio/*`.
- Home-local code uses `@home/*`.
- Shared code uses `@repo/*`.
- Relative source imports are forbidden, including imports within the same package.

Aliases resolve directly to source through `tsconfig.base.json`; packages do not need public export
maps for workspace compilation. Oxlint's Nx boundary plugin constrains dependency direction, while
`tools/check-imports.ts` covers file types such as Astro that a JavaScript-only rule can miss.

## Backend boundary

Effect 3 owns backend validation, errors, service interfaces, orchestration, logging, and D1/KV
effects. Effect Schema is the contract at request, storage, and publication boundaries. The native
Cloudflare handler remains deliberately thin:

```text
Request → Access authentication → Effect route → domain service → Layer → Response
```

`@repo/worker` centralizes the bridge, bounded JSON parsing, same-origin write protection, private
security headers, and error projection. `@repo/auth` validates Access assertions and supports an
explicit loopback-only development bypass.

## Content lifecycle

```text
Studio form
  → validated/revisioned D1 draft
  → expiring KV preview ──> Web's real renderer at /preview/:id
  → explicit publish
      → public-only projection
      → one versioned KV snapshot
      → Web SSR
```

The one KV write is the publication transaction: readers see the old complete snapshot or the new
complete snapshot, never partially updated sections. Its `publishedAt` and `publishedBy` fields are
the authoritative publication audit. Studio also appends history to D1; if that secondary append
fails after KV succeeds, it logs the failure but correctly reports that the already-visible
publication succeeded.

Web has no D1 binding. A checked-in, schema-validated seed keeps the public site available before the
first publication and during KV read errors. Public responses use short shared-cache freshness with
stale-while-revalidate; previews are Access-gated, noindex, private, and uncached.

## Data ownership

There is one D1 database and one ordered migration stream. Table names and query adapters preserve
domain ownership:

- `@repo/database/cms` accesses CMS drafts and publication history.
- `@repo/database/home` accesses Home travel, preferences, and research data.
- Web never accesses private relational data.

The D1 driver used by `@effect/sql-d1` does not offer database transactions. Optimistic revision
updates make conflicting draft and planning writes explicit. Publication atomicity comes from the
single immutable KV value, not a fictional cross-D1/KV transaction.

## UI ownership

`@repo/design` owns the Tailwind v4 theme and source scanning. `@repo/ui` owns customized
shadcn-style React primitives shared by Studio and Home. Web consumes the same tokens but keeps its
Astro-first, type-led composition and signature canvas behavior, avoiding React hydration for static
primitives.
