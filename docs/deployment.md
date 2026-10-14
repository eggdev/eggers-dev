# Vercel deployments

Deployed October 13, 2026 to the personal `brendan-eggers-projects` workspace.

| App | Production URL | Project root | Neon resource |
| --- | --- | --- | --- |
| Web | https://eggers-web.vercel.app | `apps/web` | `eggers-web-signups` |
| Studio | https://eggers-studio.vercel.app | `apps/studio` | `eggers-studio-bank` |

Both projects use Next.js, Node 24, Bun, and workspace dependencies outside their app root.
Studio's `withEve` integration builds Next and Eve together in one Vercel deployment.
Both Neon resources use the existing Free integration, in `iad1`, with separate credentials.
Schemas are applied. No historical D1/KV content was imported.

## Access and environment

Studio uses **Vercel Authentication → All Deployments**, including production. Keep this enabled.
`STUDIO_DEPLOYMENT_PROTECTED=true` is an assertion checked by the app, not an authentication system.
Anonymous access to Studio pages, APIs, and `/eve/v1` has been checked. Internal callbacks also
require `STUDIO_INTERNAL_TOKEN`; the project has an automation bypass for protected self-requests.
No subscription credentials or public-prefixed secrets are deployed.

Each app's ignored `.env.local` contains its Neon development connection. Local Studio therefore
works against the same career bank as deployed Studio. Start it with `bun run dev:studio`; the
launcher supplies a local internal token and loopback callback URL to Next and Eve. Do not use
the production environment file to launch local Eve.

Interviews and model extraction still run locally using the Codex subscription. Remote Studio
supports reading conversations and editing the bank, research, job tracker, and settings. While local Eve
sessions exist, delete career material from local Studio so its runtime context is purged too;
remote Studio explains this instead of leaving deleted material in the local runtime.
Remote interviews, voice, public Eve, and API-model budgets remain later work.

`LOCAL_DATA_DIR` selects an isolated local store and overrides the app-local Neon connection in
the development launcher. Playwright uses this to keep tests out of the real databases.
The apps reject missing `DATABASE_URL` on Vercel. `.vercelignore` excludes credentials, local
databases, sessions, and private source directories from deployment uploads.

## Git deployments and previews

Both projects deploy from `eggdev/eggers-dev`. A merge to `main` deploys production. Other
branches deploy previews behind Vercel Authentication. `.vercelignore` removes `.git` from the
build checkout, so build-skip commands cannot use `git diff`.

Each preview uses its own Neon branch of that app's production database. A branch is a
copy-on-write copy of production data at its creation, not mock data. Pending migrations run on
the branch, not on production. Writes in a preview stay in that branch and never return to
production, so edit real career material only in production or local Studio.

A manual production deployment remains available from the repository root:

```sh
bunx vercel deploy --project eggers-web --scope brendan-eggers-projects --prod --yes
bunx vercel deploy --project eggers-studio --scope brendan-eggers-projects --prod --yes
```

To refresh an app's local connection:

```sh
bunx vercel env pull .env.local --cwd apps/studio --scope brendan-eggers-projects
# Replace apps/studio with apps/web for the public signup database.
```

To apply migrations with production credentials, without printing them:

```sh
bunx vercel env pull .vercel/.env.production.local --environment production --yes --cwd apps/studio
bun --env-file=apps/studio/.vercel/.env.production.local run db:migrate
# Repeat for apps/web when shared schema migrations change.
```

## Domains and launch mail

`eggers.dev` and `studio.eggers.dev` have not been moved. The legacy Cloudflare resources and
Git deployment connection remain in place. Disconnect that deployment connection before a
domain cutover, then assign the domains to the corresponding Vercel projects and recheck access.
Do not merge into or push `main` assuming the old production wiring is inert.

The public signup persists one launch-email subscription per address. A live signup write/read
was verified and its test row removed. No mail was sent. Sending the single launch notification
is a separate explicit launch task: configure a mail provider, honor unsubscribe tokens, and
record `sent_at` to avoid duplicate sends.
