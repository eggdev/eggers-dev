# eggers.dev

A private career workspace: a knowledge bank of one person's work, and the job search built on it.
It is an Exact app with a small Bun server beside it. It runs on Cloudflare as the studio, which only
the owner can open. For development, it also runs on one machine. It is not a public website. The
public site is a separate project in `site/`.

This repository is public. The code is here; the person's data is not. Everything personal lives
in `.data/`, which git ignores, and in private storage on Cloudflare.

## What it does

- **Telling.** The record starts with your jobs. Under each job you tell one story at a time: you
  name a piece of work, then answer fixed questions about it by talking freely. Your answers are
  kept word for word. A worker then has a model write the story's four parts and a few facts from
  what you said, leaving out the asides. Code checks that each fact quotes at least three of your words
  that show it, that every number in a part or a fact (digits with their magnitude and unit, or a number word) is
  one you said about that story in the same form, and that each skill is one you named. Only the
  prompt keeps names, employers and tools in the parts to what you said. A part you typed, changed or
  cleared is never written over.
- **Stories.** Every story with something to tell, in one place to read aloud before an interview,
  grouped under its job. On request, a worker has a model write each story's spoken version: one
  text in the first person, in CARL order, in your own words, to say in under three and a half
  minutes. Code refuses a text with a number you did not say, a heading or a list, or more than 520
  words; a refused text is asked for once more with the reason, and refused again it is not kept. It
  waits while the story is being written from what you said. A text you edited or cleared is never
  written over unless you choose to replace it, and a failed replacement leaves it protected. The screen shows how long each story
  takes to say (at 140 words a minute), and keeps each time you practised it, timed or not. After a
  real interview you note the questions you were asked, at the job or on their own, and choose the
  story that answers each. A question with no story waits on Home.
- **Bank.** You add sources: pasted text, files, a LinkedIn export, git repositories. A worker has
  a model read each source and writes what it finds as facts under the role they belong to.
  Duplicate facts from several sources are folded into one.
- **Profile.** Your name, the document readers meet you by, the lines that stand out (yours to edit or
  leave out) and one question at a time where the bank is thin. "Read it" opens everything you have told
  as one document, with your own words behind each fact (`/profile/told`).
- **Talk.** One running conversation about your work. What you say is written into the bank. Each
  fact keeps the words you said it in (`lib/origins.ts`). When the model copies a passage of at
  least 12 characters and two words, and it stands whole in exactly one of your messages since the
  last reply, the fact keeps that passage. Otherwise it keeps your whole message, but only when you
  sent one message since the last reply; with more, it keeps none. A fact read from pasted text
  keeps the passage its evidence quotes, by the same length rule, and only when the passage is in
  the text. Facts stored before this are linked once, at server start: a Talk fact to its whole
  message, only when one reply lists its sentence and one message came before that reply.
- **You.** One page about you, built by code (`lib/you.ts`, `GET /you`, `GET /told`).
  - "What stands out" shows every line you wrote yourself first, then lines chosen from the record,
    up to four lines in all. Lines follow the order of projects (`lib/standing.ts`). Current work
    comes first: a project with no end, in a role with no end, unless you set its state. A chosen
    line is one of the project's own facts: one a saved job leans on, else one with a measured
    result, else the first. Your own line is never replaced. Leaving a project out hides it and
    keeps your line. The page lists the projects you left out, and bringing one back restores your own line if you wrote one.
  - "Everything you have told" is the whole record as one document, with the words behind each fact.
  - Kept facts and kept projects are left out of both. So are words behind a fact when a kept fact
    was taken from the same words.
  - The page asks one question at a time (`lib/nextquestion.ts`). First come the agenda questions
    (`lib/agenda.ts`): a term that two or more unsent postings require, that their readings found
    nothing for, and that no fact in the record names. Then a project your last resumes lean on.
    Then the record's gaps that ask for story: a job with no story, a project's missing part, the
    number before, your own part. Last come the questions a model wrote while writing a resume, the
    profile's gaps, and what a posting's reading found missing.
  - Questions code raises about dates, titles, skills or where a repository belongs are never asked
    here. Neither are the six-second skim's or the council review's questions. A question a model
    wrote that uses a word of doubt (confirm, verify, overlap and the like) is held back. A model
    can still word a doubt another way, so that check is a guard, not a guarantee.
  - Your answer is saved immediately. If Talk is busy, it waits its turn before going into the
    conversation, where the studio learns from it. A draft stays tied to the question you started
    answering, even after a reload. You can skip a question to move on.
- **Jobs.** A posting is read against the bank: what it requires, what supports each requirement,
  and a fit score computed from that coverage. Each job gets a tailored resume built only from
  bank facts, a PDF that an applicant tracking system reads cleanly, and draft outreach messages.
  A project in the bank is told in four parts: Context, Action, Result, Learning (CARL). A resume's
  bullets follow the same form, and each job on it ends with one line of the technologies its facts
  name, which code writes from your skills list (RESUME-RULES.md, rules 13 and 14).
- **Council.** Three readers, each a different model, score a tailored resume and name its weak
  lines. A reviser rewrites it from the bank until it passes or three rounds are spent.
- **Discovery.** The public job boards of companies on a watchlist are read daily, and each new
  posting gets a quick first score.
- **Public Page.** The owner writes the public collection, the only text the public site's
  assistant answers from, and publishes it.

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

A local run has its own data in `.data/`. It does not share data with the studio. To work on a
copy of the studio's data, see `bun cloud/tools/pull.ts` below.

## Layout

| Path | What it is |
| --- | --- |
| `app.contract` | The view: every screen of the app |
| `app.ts` | The app's data module: calls to the server |
| `app.test.contract` | The tests, run against `server.ts` on an empty database |
| `app.tamber` | Colours and theme tokens |
| `server.ts` | The API. It stores and serves; it never calls a model |
| `worker.ts` | Reads sources, writes the profile, reads jobs, replies in Talk |
| `lib/` | One file per concern, such as `db`, `ingest`, `profile`, `jobs`, `council`, `pdf`, `discover`, `talk`, `public` and `llm` |
| `tools/` | Commands to run by hand, listed below |
| `cloud/` | The container image and its keeper, which runs the app in the studio |
| `studio/` | The studio's Cloudflare Worker |
| `site/` | The public site and its Cloudflare Worker |
| `.github/` | The workflow that tests and deploys on GitHub |
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
| `bun tools/public.ts` | Writes a draft of the public collection and a list of lines to check to `.data/public/`. It never writes the collection and publishes nothing |

Run the `tools/` commands while the worker is idle.

## Models

Every model call goes through `ask()` in `lib/llm.ts`. On a developer machine, it runs headless
Claude Code under that machine's existing login. There is no API key. The studio uses Codex
instead (below). `EGG_MODEL` sets the default model. A variable for each task (`EGG_READ_MODEL`,
`EGG_JOB_MODEL`, `EGG_PROFILE_MODEL`, `EGG_TALK_MODEL`, `EGG_DERIVE_MODEL` for writing a told story
(default `opus`), `EGG_SPOKEN_MODEL` for writing a story's spoken version (default `opus`), and others
in `lib/`) overrides it.

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

### Ways back

Each switch gives back an earlier way of writing resumes, with no deploy of old code. The tests in `lib/` prove that
each one gives the earlier prompts byte for byte.

- `EGG_CARL=off` gives the bullet rules, the project parts sent to the writer, the length limits and the resume as they
  were before CARL: no Technologies line (one an earlier pass wrote is taken out when the Skills lines are next written,
  never from a resume you edited), and no project Learning sent to the writer. The code that scores and checks a resume
  reads it as before too: no context clause, and a line of up to 28 words. The project columns keep their
  new names either way. `lib/prompts.carl.test.ts` lists what the switch changes. Turning the switch writes unsent
  resumes again once when a project that holds a fact has a Learning, because the writer is given it only with CARL on.
- `EGG_LINKS=off` leaves out the links of each resume line to its facts (`lib/links.ts`, RESUME-RULES.md rule 7).

### Other machines

- `EGG_CHROME_ARGS` adds arguments to the Chrome command that prints PDFs, split on spaces. In a
  container, set it to `--no-sandbox --disable-dev-shm-usage`. Chrome is also found on the path as
  `google-chrome`, `google-chrome-stable`, `chromium` or `chromium-browser`.
- Word and RTF files become text with macOS's `textutil`. Where it is missing, `pandoc` does it.
  Pandoc reads `.docx` and `.rtf` files, but not the older `.doc`.

## Running it day to day (no laptop needed)

Each routine job is done in a browser or on GitHub. The owner's machine can be off.

| Job | Where it is done |
| --- | --- |
| Add or edit career content | The studio, at `https://studio.eggers.dev` |
| Publish the public text | The studio: Profile tab, Public Page, "Publish Saved Text" |
| Stop the public chat | The studio: Profile tab, Public Page, "Take the Chat Offline" |
| Renew the model sign-in | The studio: Profile tab, System (the settings symbol), "Sign In Again" |
| Check or force a backup | The studio: Profile tab, System, "Back Up Now" |
| Deploy code | Push to `main`. GitHub runs the tests and deploys both Workers |

Some work still needs a developer machine:

- Writing code and running the tests.
- The first set-up: creating the buckets, setting the Worker secrets and making the first backup
  (the seed).
- Pulling a copy of the studio's data for local work (`bun cloud/tools/pull.ts`).

## The public site

`site/` is a second Exact project: one public page where a visitor asks questions about the
owner's work, and an assistant answers. It is built as static files and served by a Cloudflare
Worker (`site/worker/`) at `https://eggers.dev`. The same Worker answers the questions at
`POST /ask`.

### The public collection

The assistant answers only from one text, the public collection. The owner writes, saves, checks
and publishes it in the studio, on the Profile tab's Public Page screen:

1. "Start from My Bank" puts a draft of the whole bank into the field. No model writes it. Nothing
   is saved until the owner presses Save.
2. The owner deletes what must not be public and presses Save. The app's server keeps the saved
   text in the data folder as `public/collection.md`.
3. "Lines to check before you publish" lists lines that may hold money, a person or client, a
   link, or inside knowledge. This is advice only. The owner decides what is public.
4. "Publish Saved Text" copies the saved text to the R2 bucket `eggers-site-content` as
   `collection.md`. Only the saved text can be published, and only the text the owner reviewed.
5. "Take the Chat Offline" deletes `collection.md`. The public chat then stops answering. This is
   the emergency stop.

The site's Worker reads `collection.md` at request time and keeps it for 60 seconds
(`site/worker/collection.ts`). So a publish or a take-down shows within about a minute, and a
content change needs no deploy. Each publish also puts a history copy in the studio's private
bucket under `public-history/`. The newest 20 copies are kept. The bucket the public site reads
holds `collection.md` and nothing else.

The server routes are `/public`, `/public/draft`, `/public/notes` and `/public/save`
(`server.ts`, `lib/public.ts`). The studio's Worker does the publishing (`studio/worker/publish.ts`):

- `GET /api/_studio/public` shows what is published now.
- `POST /api/_studio/publish` publishes the saved text.
- `POST /api/_studio/unpublish` takes it down.

The collection is never in git. `bun tools/public.ts` still writes a draft for local work, but it
never writes the collection.

### Limits and set-up

The assistant has three limits on questions. Each visitor may ask 10 questions a minute. Each UTC
day has a total for all visitors together (`MAX_QUESTIONS_PER_DAY`) and a share for each visitor
(`MAX_QUESTIONS_PER_VISITOR_PER_DAY`). Both are settings in `site/wrangler.jsonc`. A Durable Object
counts them (`site/worker/budget.ts`). It stores no addresses.

The assistant answers "The assistant is not set up yet." until two things are true: a collection is
published, and the Worker secret `MODEL_API_KEY` is set. Set the key only after a real collection is
published. In `site/`, set it with `wrangler secret put MODEL_API_KEY`. The model's address and name
are settings in `site/wrangler.jsonc`.

In `site/`, `bun tools/deploy.ts --origin https://eggers.dev` builds the page and deploys the Worker.
It does not take a collection. `bun exact.mjs verify` tests the page against a stand-in endpoint,
and `bun run test:worker` tests the Worker against a fake model.

## The studio at studio.eggers.dev

The studio is this app, reached from any browser at `https://studio.eggers.dev`. Only the owner can
open it. It runs only on Cloudflare. Nothing in it runs on the owner's machine.

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
  much smaller than the last one is refused, unless `EGG_ALLOW_SHRINK=1` is set or the owner just started a
  new record ("Start a new record" below). The bucket keeps
  the newest 30 backups and one for each day of the last 30 days.
- **Sleep.** After about 20 minutes with no request, no work in hand and nothing unsaved, the
  container stops. The keeper backs up anything unsaved before it exits. The next request starts
  the container again. That request waits until the app answers, up to about a minute. Once a
  day, the container starts by itself, so the worker checks the job boards. An open tab does not
  keep it awake: the app asks nothing while no work waits or runs (except once when the studio is
  due to rewrite resumes by itself), and while some does it asks only for the activity list, every
  10 seconds (2 while a reply in Talk is written), and nothing while the tab is hidden
  (`activity.contract`, `lib/activity.ts`).

The limits: a hard crash loses the changes made since the last backup, at most about 5 minutes of
work. The first request after a sleep is slow, because the container restores the data first.

The container reaches the bucket only through the Worker (`studio/worker/backups.ts`). It holds no
storage keys.

### The System screen

The studio's System screen (Profile tab, the settings symbol) shows the last backup, any changes not
yet backed up, the model sign-in and the machine. "Back Up Now" takes a backup at once.

"Sign In Again" renews the model sign-in (the owner's ChatGPT account, through Codex) from the
container (`cloud/lib/codexlogin.ts`). The screen shows a web address and a one-time code. The owner
opens the address on any device, signs in to ChatGPT and types the code. The code expires after 15
minutes. When the sign-in is done, the keeper backs it up at once, so it survives a restart.

The Worker's own controls, behind the same Access check:

- `GET /api/_studio/status` shows the container, the last backup, whether Codex is signed in and
  whether its sandbox starts.
- `POST /api/_studio/backup` takes a backup now.
- `POST /api/_studio/codex/login` starts a Codex sign-in, and `POST /api/_studio/codex/cancel`
  stops one that waits.
- The publishing controls are under "The public collection" above.

### Start a new record

The System screen's "Start a new record" deletes the career record so it can be told again from nothing
(`lib/reset.ts`, `POST /record/reset` with `{"confirm": "start a new record"}`). It deletes every role,
project, fact and source, Talk, the telling sittings, the owner's answers and everything written from the
record: the profile, the questions, the skills list, marks and origins, the lines of "What stands out", `profile.md`, `unslop.md`, `inbox/`,
`repos/` and the `egg.db.before-*` copies. It keeps the owner's details and direction, the job tracker and the
watchlist. A job already sent keeps its resume, links, PDF and versions. A job not yet sent keeps its posting
and tracking, loses its reading, resume, PDF and drafts, and waits until the owner reads it again. Reference
numbers continue above the old ones, so a sent resume never comes to cite a new fact. It is refused while any
work waits or runs. The model sign-in and the public collection are not touched.

In the studio the screen backs up the record first and goes on only when that backup succeeded. Then it backs up
the new record at once and says whether that worked. The keeper's shrink guard would refuse a backup with no
roles or facts, so the reset writes a one-time mark into the database (the `record_resets` table). The guard lets
a smaller backup through only while that mark is newer than the last accepted backup's own mark and the time that
backup was taken. The backup it lets through records the mark in its manifest (`db.resetAt`), so the mark is spent
at once, and a later shrink is refused as before. A mark restored from a backup is never newer than that backup.
If the machine restarts before the new record is backed up, the old record comes back and the reset is lost.

Older backups stay in the bucket under the usual retention, which keeps the newest 30 backups, the newest backup of
each day (UTC) of the last 30 days, and the one to restore (`toPrune` in `cloud/lib/manifest.ts`). A backup of the old
record stays only while it is one of the newest 30 or the newest of its day in the last 30 days. So the last one
taken before the reset goes once 30 newer backups exist, and each older one goes 30 days after its day, unless it is
still among the newest 30.

### Commands

| Command | What it does |
| --- | --- |
| `bun studio/tools/deploy.ts` | Builds the screens and the container image, and deploys both. Needs Docker. `--dry-run` uploads nothing |
| `bun cloud/tools/seed.ts` | Makes the first backup from this machine's `.data/`. `--upload` puts it in the bucket |
| `bun cloud/tools/pull.ts` | Downloads the newest backup into a new folder in `.data.cloud/` and checks it. It never writes to `.data/` |
| `bun test cloud` | Tests the keeper with a fake bucket and small invented databases |

In `studio/`, `bun run test` tests the Worker, the Durable Object's logic, the backup gateway and the
publishing controls with fakes.

### First set-up

This is done once, from a developer machine. Create the studio's bucket:
`wrangler r2 bucket create eggers-studio-data`. The public site's bucket, `eggers-site-content`,
must also exist. Then run `bun cloud/tools/seed.ts --upload`. Add `--codex-home ~/.codex` to
include the Codex sign-in, so the container starts signed in. Later sign-ins are renewed on the
System screen. The seed refuses to run while the app runs on this machine, unless `--live` is given.
It refuses to replace a backup already in the bucket, unless `--replace` is given.

A deploy and the bucket commands from a developer machine need `CLOUDFLARE_ACCOUNT_ID` in the
environment. Set the secrets once with `wrangler secret put` in `studio/`:

- `ACCESS_TEAM_DOMAIN`: the Access team's host name. Required.
- `ACCESS_AUD`: the Access application's audience tag. Required. Without these two, the studio
  answers 503.
- `GH_TOKEN`: a GitHub token for GitHub sources. Optional.

The public site's secret, `MODEL_API_KEY`, is set in `site/` (see "Limits and set-up" above).

## Tests and deploys on GitHub

`.github/workflows/ci.yml` runs on GitHub's machines:

- On every pull request and every push to `main`, the job "test" runs `bun test lib`,
  `bun test cloud`, the studio's Worker tests and the site's Worker tests. Then it runs both deploy
  tools with `--dry-run`, which builds everything and uploads nothing. It does not run
  `bun exact.mjs verify`.
- On a push to `main`, or a manual run on `main`, the job "deploy" then deploys the studio and the
  public site to Cloudflare. It runs in the GitHub environment "production".

The deploy needs two repository secrets: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The
apps build with Exact, which is not an npm package. Both jobs check out the public repository
`expo/exact` beside this repository, at the commit that `EXACT_REF` in the workflow names.
`.github/actions/setup/action.yml` installs the rest.

Both jobs have run on `main`. The token behind `CLOUDFLARE_API_TOKEN` is Cloudflare's "Edit
Cloudflare Workers" template with two account permissions added: Containers Edit and Cloudchamber
Edit.

Deploying from a developer machine still works. From the repository root, run
`bun studio/tools/deploy.ts`. In `site/`, run `bun tools/deploy.ts --origin https://eggers.dev`.
