# eggers.dev

A fresh career workspace for Brendan Eggers. Studio helps build a detailed career knowledge bank
through conversations with Eve, then uses recurring job requirements to prompt deeper recall.
Web is a minimal public holding page with a single launch-email signup.

## Run locally

Requires Node 24+, Bun 1.4+, and the Codex CLI with a subscription sign-in for live interviews.

```sh
bun install
bun run eve:login
# Complete Codex sign-in in your browser.
bun run dev
```

- Studio: http://127.0.0.1:3001
- Web: http://127.0.0.1:3000

`bun run dev:studio` and `bun run dev:web` start either app alone. The launcher generates a
process-local internal token shared by Next and Eve. Use the launcher, not a bare `next dev`.
No API key is necessary for local subscription mode. Interview and extraction model identifiers
are editable in Studio Settings; the defaults are `gpt-6.1-sol` and `gpt-6-luna`. Availability
depends on your account. Eve uses a conservative 128,000-token working context budget for
local models; set `EVE_CONTEXT_WINDOW_TOKENS` if selecting a model with a smaller limit. Authentication failures are shown in the conversation, not replaced
with simulated replies. This repository does not copy or store Codex credentials.

Local data persists in each app’s `.data/postgres` directory using PGlite (PostgreSQL compiled
to WASM). One Next process owns each directory; Eve accesses Studio’s internal API. Restarting
keeps your bank. Do not run two app processes against the same directory. Use `LOCAL_DATA_DIR`
for an isolated store. There is no historical content migration or seed.

For Neon, set `DATABASE_URL` in the app’s `.env.local` or launch environment. Run
`DATABASE_URL=… bun run db:migrate` once against a fresh database before deployment. Local
stores initialize automatically. Never place private content or secrets in Git.

## Working in Studio

1. Add a role or start a focused conversation. Explore memories freely in **Pass 1 · Recall**.
2. Eve saves narrative entries and builds an editable interview map. Review/correct them in
   Knowledge bank. Revisions can be restored into the editor and saved as a new revision.
3. Add listing URLs in Job research. Choose **Process with Eve**, then send the prepared message.
   The extraction subagent uses Luna and continues batches. Blocked sources remain visible for
   browser capture or manual paste.
4. Switch a role conversation to **Pass 2 · Dig deeper** when ready. Eve uses the full recurring
   requirement map as prompts, without treating missing stories as absent skills.

The editor renders Markdown as you type or paste. Select text for formatting, or type `/` in an
empty paragraph for headings, lists, quotes and code blocks. Messages sent to Eve are Markdown.

**Automatic edits start on.** Enable “Review Eve’s edits” in Settings to queue diffs for entries, role details, and interview topics.
Requested deletions happen directly. Entry deletion removes its revisions and linked transcript
turns (including associated replies). Conversation deletion also removes entries sourced from that conversation. Runtime
sessions are retired and event snapshots cleared to prevent replay of deleted source content.
Deleting a source-linked entry can remove a message that also supported another entry; inspect
and correct those related entries when needed. Semantic copies in unrelated narrative text are
not automatically detected. There is no hidden trash or archival copy in the application.

## Browser job capture

```sh
bunx playwright install chromium
bun run import:browser
# Or supply listing URLs:
bun run import:browser /path/to/listings.txt
```

Start Studio first. The importer opens a dedicated persistent browser profile in `.data/browser`.
Sign into TrueUp yourself, navigate to saved jobs/search results, then follow the terminal prompt.
Without a URL file it gathers listing links currently present on that page (scroll/load more
before continuing). It captures rendered pages and preserves originals in Studio. Logged-in
sessions remain on your personal computer. Use `BROWSER_CHANNEL=chrome` if you prefer installed
Chrome. The importer does not assume a LinkedIn API or bypass login/paywall controls.

Imports normalize tracking URLs, detect repeated descriptions, preserve failed retrievals,
and retain verbatim requirement evidence. Re-fetching an unchanged parsed description avoids
another extraction. Source-specific JSON-LD parsing is preferred; visible-page capture is the
fallback. Review extracted location/family fields for relevance; ingestion does not silently
filter or score candidates. Daily discovery and application tracking come later.

## Checks

```sh
bun run check
bun run lint
bun run test
bun run test:e2e
bun run build
bun run build:eve
```

Tests use empty disposable databases. Browser tests start local services with isolated stores;
they do not send paid model requests. Live subscription access and a real Neon connection depend on your account/environment;
the automated suite intentionally uses no model billing.

## Deployment direction

Two Vercel projects, rooted at `apps/web` and `apps/studio`; keep workspace dependencies available.
See [deployment notes](docs/deployment.md). Nothing is deployed by local development or these
checks. The existing Cloudflare production wiring must be explicitly disconnected during cutover.
Do not merge/push assuming that the old production setup has already been removed.

Later milestones: live voice, remote private interviews, explicit public knowledge preparation,
low-cost public Eve, targeted resumes and cover letters, job targets and application tracking,
and scheduled discovery. Launch notifications are collected now; sending the single launch
email is a separate explicit launch action, not an automatic development side effect.
