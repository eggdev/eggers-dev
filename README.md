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

## Earlier deployments

Until 2026-11-13 this repository held a Next and Nx workspace with two apps: a public holding page
and a private Studio. Two Vercel projects (`eggers-web` and `eggers-studio`) still build from this
repository's `main` branch and expect that code. The `eggers.dev` domain was never moved to them.
Disconnect those projects before this code reaches `main`, or their builds will fail. The earlier
code is in git history; the last commit that has it is `a2ad996`.
