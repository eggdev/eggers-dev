# Cloudflare cutover

Production was cut over on 2026-09-14. This document remains the recovery record and checklist; do
not rerun the create or import commands against the live resources.

Completed:

- Backed up both legacy D1 databases outside the repository and left the source databases intact.
- Created `eggers-apps` and `eggers-public-content`, applied the shared migration stream, imported
  the Home and legacy Studio data, and verified every source/target row count.
- Updated the Worker bindings and deployed Web, Studio, and Home independently.
- Created the `eggers.dev/preview/*` Access application with the reusable exact-email policy,
  updated the Web audience binding, and redeployed.
- Verified the public site, résumé export, static metadata, error handling, unauthenticated Access
  redirects, authenticated private preview headers, and the Studio-to-KV publication flow.
- Loaded the imported Home workspace and verified a reversible preference write persisted through a
  fresh navigation, then restored the original value.

Keep database exports in a temporary directory outside the public repository.

## 1. Back up the two existing D1 databases

```bash
cutover_dir=$(mktemp -d /tmp/eggers-cutover.XXXXXX)
bunx wrangler d1 export eggers-home --remote --output "$cutover_dir/home-backup.sql"
bunx wrangler d1 export eggers-career-studio --remote --output "$cutover_dir/studio-backup.sql"
```

Create data-only exports for the tables that move into the shared database:

```bash
bunx wrangler d1 export eggers-home --remote --no-schema \
  --table app_state --table research_runs --table research_snapshots \
  --table destinations --table hotels --table sources --table point_accounts \
  --table transfer_paths --table research_entries --table app_preferences \
  --table activity_log --table hotel_destination_links --table experiences \
  --output "$cutover_dir/home-data.sql"

bunx wrangler d1 export eggers-career-studio --remote --no-schema \
  --table documents --table resumes --table publish_events \
  --output "$cutover_dir/studio-legacy-data.sql"
```

Do not delete either source database during the cutover.

## 2. Create shared resources

```bash
bunx wrangler d1 create eggers-apps
bunx wrangler kv namespace create eggers-public-content
```

Copy the new D1 ID into both `apps/studio/wrangler.jsonc` and `apps/home/wrangler.jsonc`. Copy the KV
namespace ID into both `apps/studio/wrangler.jsonc` and `apps/web/wrangler.jsonc`.

## 3. Finish Cloudflare Access

- Keep whole-host Access applications on `studio.eggers.dev` and `home.eggers.dev`.
- Confirm both policies allow only the intended identities; the Worker allowlist is defense in depth.
- Create an Access application for `eggers.dev/preview/*`, leaving every other `eggers.dev` path public.
- Copy that application's audience tag into `apps/web/wrangler.jsonc`.
- Confirm all `REPLACE_WITH_*` markers are gone.

## 4. Regenerate and verify binding types

```bash
bun run --cwd apps/web types
bun run --cwd apps/studio types
bun run --cwd apps/home types
bun run lint
bun run check
bun run test
bun run test:e2e
bun run build
```

## 5. Build the shared database

Apply the migration stream once, then import both data-only exports:

```bash
bun run --cwd apps/studio db:migrate:remote
bunx wrangler d1 execute eggers-apps --remote --file "$cutover_dir/home-data.sql" \
  --config apps/home/wrangler.jsonc
bunx wrangler d1 execute eggers-apps --remote --file "$cutover_dir/studio-legacy-data.sql" \
  --config apps/studio/wrangler.jsonc
```

The legacy Studio tables remain readable for recovery. The new structured CMS draft seeds from the
checked-in public content on its first authenticated request.

## 6. Configure independent Git builds

Keep one Cloudflare Worker build per app. Each should use repository root `/`, Bun, and its explicit
deploy command:

| Worker | Production branch | Deploy command | Primary watch paths |
| --- | --- | --- | --- |
| `eggers-dev` | `main` | `bun run deploy:web` | `apps/web/**`, `packages/{auth,cms,content,design,worker}/**` |
| `eggers-career-studio` | `main` | `bun run deploy:studio` | `apps/studio/**`, `packages/**` |
| `eggers-home` | `main` | `bun run deploy:home` | `apps/home/**`, `packages/{auth,database,design,home,ui,worker}/**` |

CI is verification-only. Do not add one workflow command that deploys all three applications.

## 7. Deploy and initialize

Deploy Web first; an empty KV safely renders the checked-in fallback. Then deploy Studio and Home:

```bash
bun run deploy:web
bun run deploy:studio
bun run deploy:home
```

Open Studio through Access, review the seeded structured draft, create a preview, and publish. Verify:

- `eggers.dev` is public and renders the published revision.
- the Studio preview opens through Access and carries `noindex`/private cache headers.
- Studio and Home reject an unauthenticated non-loopback request.
- Home shows the imported private data and can persist one reversible planning edit.

## 8. Retire the old publishing path

After a soak period and a verified backup, remove the old `GITHUB_PRIVATE_KEY` Worker secret and
disable or uninstall the repository-scoped GitHub App. Retain the old D1 exports until recovery is no
longer needed. Database deletion is intentionally outside this runbook.
