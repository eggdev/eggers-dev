# eggers.dev

A private career workspace: a knowledge bank of one person's work, and the job search built on it.
It is an Exact app with a small Bun server beside it. It runs on one machine and is reached over a
private network. It has no sign-in and is not a public website.

This repository is public. The code is here; the person's data is not. Everything personal lives
in `.data/`, which git ignores.

## What it does

- **Bank.** You add sources: pasted text, files, a LinkedIn export, git repositories. A worker has
  Claude Code read each source and writes what it finds as facts under the role they belong to.
  Duplicate facts from several sources are folded into one.
- **Profile.** One document written from the whole bank. Where the bank is thin, it asks
  questions instead of guessing.
- **Talk.** One running conversation about your work. What you say is written into the bank.
- **Jobs.** A posting is read against the bank: what it requires, what supports each requirement,
  and a fit score computed from that coverage. Each job gets a tailored resume built only from
  bank facts, a PDF that an applicant tracking system reads cleanly, and draft outreach messages.
- **Council.** Three readers, each a different model, score a tailored resume and name its weak
  lines. A reviser rewrites it from the bank until it passes or three rounds are spent.
- **Discovery.** The public job boards of companies on a watchlist are read daily, and each new
  posting gets a quick first score.

One rule holds everywhere: nothing may invent, round up or infer a number. A resume is built only
from facts in the bank.

## Run it

You need Bun 1.4.2, an Exact checkout at `../exact` (or name one with `EXACT`), and the `claude`
command signed in on this machine. GitHub sources use the `gh` command's sign-in. Chrome prints
the resume PDFs (`CHROME` names the binary when it is not in the usual place).

```sh
bun install
bun exact.mjs dev
```

This starts three things: the API server (`server.ts`, port 8787), the worker (`worker.ts`) and
the web app (port 8765). With `mprocs` installed, each runs in its own terminal tab.

To reach the app from another device on a Tailscale network, set `EGG_REMOTE` to this machine's
`.ts.net` name. Everything then listens on this machine only, and Tailscale Serve carries it over
HTTPS. `tools/dev.ts` has the two `tailscale serve` commands.

```sh
EGG_REMOTE=<machine>.<tailnet>.ts.net bun tools/dev.ts --plain
```

## Layout

| Path | What it is |
| --- | --- |
| `app.contract` | The view: every screen of the app |
| `app.ts` | The app's data module: calls to the server |
| `app.test.contract` | The tests, run against `server.ts` on an empty database |
| `app.tamber` | Colours and theme tokens |
| `server.ts` | The API. It stores and serves; it never calls a model |
| `worker.ts` | Reads sources, writes the profile, reads jobs, replies in Talk |
| `lib/` | One file per concern, such as `db`, `ingest`, `profile`, `jobs`, `council`, `pdf`, `discover`, `talk` and `llm` |
| `tools/` | Commands to run by hand, listed below |
| `.data/` | The database, inbox, cloned repositories and resumes. Ignored by git |

## Commands

| Command | What it does |
| --- | --- |
| `bun exact.mjs dev` | Server, worker and web app together |
| `bun exact.mjs verify` | Builds the app and runs the tests. Run it from a copy while `dev` is running |
| `bun test lib` | Unit tests for `lib/`, such as the place check for found jobs |
| `bun exact.mjs help` | Every Exact verb |
| `bun tools/refresh.ts [steps]` | Brings everything derived from the bank up to date |
| `bun tools/rerank.ts` | Reads every job again and prints the old and new fit |
| `bun tools/council.ts [job id]` | Has the council review resumes not yet sent |
| `bun tools/discover.ts` | Checks the watchlist now |
| `bun tools/score.ts [days]` | Quick-scores recent found postings |
| `bun tools/widen.ts <file>` | Adds companies to the watchlist from a file of board names |
| `bun tools/unslop.ts` | Rewords bank facts to the writing rules without changing what they say |
| `bun tools/questions.ts` | Closes open questions that the bank already answers |
| `bun tools/public.ts` | Writes a draft of the public collection to `.data/public/` for the owner to audit. It publishes nothing |

Run the `tools/` commands while the worker is idle.

## Models

Every model call goes through `ask()` in `lib/llm.ts`, which runs headless Claude Code under this
machine's existing login. There is no API key. `EGG_MODEL` sets the default model. A variable for
each task (`EGG_READ_MODEL`, `EGG_JOB_MODEL`, `EGG_PROFILE_MODEL`, `EGG_TALK_MODEL` and others in
`lib/`) overrides it.

### Codex instead of Claude Code

Set `EGG_LLM=codex` to send every model call to the `codex` command instead. Codex must be signed
in (`codex login`). It keeps its sign-in in `CODEX_HOME`. `CODEX_BIN` names the binary when it is
not on the path. When `EGG_LLM` is unset or `claude`, nothing changes.

The code still asks for `opus`, `sonnet` and `haiku`. Under Codex, these names become
`gpt-6.1-sol`, `gpt-6.1-terra` and `gpt-6-luna`. `EGG_CODEX_OPUS`, `EGG_CODEX_SONNET` and
`EGG_CODEX_HAIKU` change them. `gpt` is Codex's own default model, and `gpt:<name>` is `<name>`.

Every Codex call runs in Codex's read-only sandbox. A call without tools starts in an empty folder
with no shell. A call that reads files starts in its folder and may run read-only commands such as
`git log`. On Linux the sandbox needs bubblewrap. When the sandbox cannot start, the call fails
with an error. It never runs without the sandbox. `llmReady()` in `lib/llm.ts` checks the sign-in
and the sandbox, and asks no model. Do not put an `AGENTS.md` file in `CODEX_HOME`: Codex reads
that file into every call.

Codex cannot read a PDF itself. Under `EGG_LLM=codex`, the worker takes the text out of a PDF first.

### Other machines

- `EGG_CHROME_ARGS` adds arguments to the Chrome command that prints PDFs, split on spaces. In a
  container, set it to `--no-sandbox --disable-dev-shm-usage`. Chrome is also found on the path as
  `google-chrome`, `google-chrome-stable`, `chromium` or `chromium-browser`.
- Word and RTF files become text with macOS's `textutil`. Where it is missing, `pandoc` does it.
  Pandoc reads `.docx` and `.rtf` files, but not the older `.doc`.

## The public site

`site/` is a second Exact project: one public page where a visitor asks questions about the
owner's work, and an assistant answers. It is built as static files and served by a Cloudflare
Worker (`site/worker/`), which also answers the questions at `POST /ask`.

The assistant answers only from one file, the public collection, which the owner approves:

1. `bun tools/public.ts` writes a draft of the whole bank to `.data/public/collection.draft.md`.
2. The owner deletes what must not be public and saves the result as `.data/public/collection.md`.
3. In `site/`, `bun tools/deploy.ts --origin https://<public origin>` builds the page, copies the
   approved collection into the Worker and deploys both. It refuses to run without that file.

The collection is never in git. The model's address and name are settings in `site/wrangler.jsonc`,
and its key is a Worker secret. In `site/`, `bun exact.mjs verify` tests the page against a
stand-in endpoint, and `bun run test:worker` tests the Worker against a fake model.

## The studio at studio.eggers.dev

The studio is this app, reached from any browser at `https://studio.eggers.dev`. Only the owner can
open it. It runs on Cloudflare, so the owner's machine can be off.

### What runs where

A Worker (`studio/`) serves the app's screens. Cloudflare Access asks for the sign-in. The Worker
then checks the Access token again on every request. Without a valid token it serves nothing.

The Worker sends each call to `/api/...` to a Durable Object. The Durable Object owns one
Cloudflare Container, which runs the image in `cloud/Dockerfile`. In the container, the keeper
(`cloud/keeper.ts`) starts `server.ts` and `worker.ts` and starts either one again if it stops.
The models are Codex (`EGG_LLM=codex`), signed in with a ChatGPT subscription.

A container's disk is erased every time it stops. So the keeper keeps the data in a private R2
bucket, `eggers-studio-data`:

- **Restore.** When the container starts, the keeper downloads the newest backup, checks it and
  unpacks it. Then it starts the app. A backup that fails a check is skipped for the one before
  it. The keeper never starts the app on an empty or partial database by accident. When the bucket
  holds no backup, it starts the app only when `EGG_ALLOW_EMPTY=1` is set.
- **Back up.** When the data changes, the keeper waits for 45 seconds of quiet (at most 5 minutes)
  and uploads one archive: the database, the data folder's files and the Codex sign-in. It leaves
  out `repos/`. A new backup becomes the one to restore only after its upload is complete. A backup
  much smaller than the last one is refused, unless `EGG_ALLOW_SHRINK=1` is set. The bucket keeps
  the newest 30 backups and one for each day of the last 30 days.
- **Sleep.** After about 20 minutes with no request, no work in hand and nothing unsaved, the
  container stops. The keeper backs up anything unsaved before it exits. The next request starts
  the container again. That request waits until the app answers, up to about a minute. Once a
  day, the container starts by itself, so the worker checks the job boards.

The limits: a hard crash loses the changes made since the last backup, at most about 5 minutes of
work. The first request after a sleep is slow, because the container restores the data first.

The container reaches the bucket only through the Worker (`studio/worker/backups.ts`). It holds no
storage keys. `GET /api/_studio/status` shows the container, the last backup, whether Codex is
signed in and whether its sandbox starts. `POST /api/_studio/backup` takes a backup now.

### Commands

| Command | What it does |
| --- | --- |
| `bun studio/tools/deploy.ts` | Builds the screens and the container image, and deploys both. Needs Docker. `--dry-run` uploads nothing |
| `bun cloud/tools/seed.ts` | Makes the first backup from this machine's `.data/`. `--upload` puts it in the bucket |
| `bun cloud/tools/pull.ts` | Downloads the newest backup into a new folder in `.data.cloud/` and checks it. It never writes to `.data/` |
| `bun test cloud` | Tests the keeper with a fake bucket and small invented databases |

In `studio/`, `bun run test` tests the Worker, the Durable Object's logic and the backup gateway
with fakes.

Before the first deploy, create the bucket once: `wrangler r2 bucket create eggers-studio-data`.
Then run `bun cloud/tools/seed.ts --upload`. Add `--codex-home ~/.codex` to include the Codex
sign-in. The seed refuses to run while the app runs on this machine, unless `--live` is given. It
refuses to replace a backup already in the bucket, unless `--replace` is given.

A deploy and the bucket commands need `CLOUDFLARE_ACCOUNT_ID` in the environment. Set the secrets
once with `wrangler secret put` in `studio/`:

- `ACCESS_TEAM_DOMAIN`: the Access team's host name. Required.
- `ACCESS_AUD`: the Access application's audience tag. Required. Without these two, the studio
  answers 503.
- `GH_TOKEN`: a GitHub token for GitHub sources. Optional.

### Falling back to the Mac

Set `STUDIO_BACKEND` to `tunnel` in `studio/wrangler.jsonc` and deploy. The Worker then sends
`/api/...` through a private Cloudflare Tunnel to the server on the owner's machine, as before.
There, `bun tools/live.ts` runs the server, the worker and the tunnel. Before you switch, run
`bun cloud/tools/pull.ts` to get the cloud's newest data. It goes into a new folder in
`.data.cloud/`. With the app stopped, move it into `.data/` yourself. Do not run the app in both
places at once: each has its own copy of the data.

## Earlier deployments

Until 2026-11-13 this repository held a Next and Nx workspace with two apps: a public holding page
and a private Studio. Two Vercel projects (`eggers-web` and `eggers-studio`) still build from this
repository's `main` branch and expect that code. The `eggers.dev` domain was never moved to them.
Disconnect those projects before this code reaches `main`, or their builds will fail. The earlier
code is in git history; the last commit that has it is `a2ad996`.
