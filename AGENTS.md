<!-- exact:begin (exact new writes this block; bun exact.mjs update rewrites it) -->
# eggdev: an Exact app

`app.contract` is the view, `app.ts` the data module, `app.test.contract` the tests, `app.json`
the manifest: set `app.name` and `app.id` before building. The app uses Exact at
`../exact` by path (`EXACT` overrides it).

This file is already in your instructions. Start from the nearest pattern: `bun exact.mjs
pattern` lists them and `pattern <name>` writes one, tested. ../exact/docs/start-here-site.md (a site) or
../exact/docs/start-here.md is the only required reading. `bun exact.mjs contract vocab <name>` answers a
name (none: the card); `bun exact.mjs docs <heading words>` a guide's
section. Run `bun exact.mjs verify` when the features work, and `verify ios|android` at the end for a
phone app. When an iPhone app is ready to try, run `bun exact.mjs share` and send its link;
repeat for each change the person should see. `bun exact.mjs help` lists the verbs, including
app.json's `"commands"`.
`bun exact.mjs update` refreshes files. Native verbs (`ios`, `mac`, `linux`, `android`, `windows`)
name their platform in app.json on first use and build in a generated workspace;
`update --without <platform>` stops shipping it.
`bun ../exact/scripts/exact.mjs setup --check` names what a native build lacks.
Shared data: `exact new <path> --snapback`, or `bun exact.mjs snapback` here.
Install `snapback4@0.4.33` above; ../exact/snapback4/README.md has setup and server commands.

Generated, so don't edit: `exact.mjs` and this block.

## Feedback (required)

When a doc was wrong or missing, a workaround was needed, something took several tries or a
command confused you, record it: `bun exact.mjs feedback note "<what happened>"`. It attaches
exact2's commit and the last exit code, never output or code. `bun exact.mjs feedback status` says
whether notes are sent and whether to keep a diary; under `never`, skip all of this.
<!-- exact:end -->

## This repository

This repository holds the studio (this Exact app with its server and worker) and the public site in
`site/`. `main` is the branch that runs in production.

- The repository is public on GitHub. Nothing about the owner's career goes into git: no bank
  content, resumes, job targets, conversations, database files, host names or secrets. All of that
  lives in `.data/`, which is ignored. Tests and fixtures use invented people and companies.
- Use conventional commits. Do not push, merge to `main` or deploy unless asked. A push to `main`
  runs the tests and then deploys the studio and the public site (README, "Tests and deploys on GitHub").
- The server has no sign-in. It listens on this machine and is reached only over the tailnet.
  Never expose it to the public internet.
- A model is asked only through `ask()` in `lib/llm.ts` (headless Claude Code under this machine's
  login), and only from the worker. Do not add API keys or a model SDK.
- What the person says about their own work is taken as true and written to the bank with no
  review step. Nothing may invent, round up or infer a number.
- `DESIGN.md` and `PRODUCT.md` record the design and product intent.
- While a dev session is running, run `verify` and `test` from a copy of the project. They share
  `target/` with the dev loop and build the app against the test server's address.
