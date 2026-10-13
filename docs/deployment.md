# Vercel cutover (later, explicit action)

Local development is the first release. No cloud resources have been provisioned by this rewrite.

1. Create separate Vercel projects for `apps/web` and `apps/studio`, with Node 24 and Bun.
   Install at workspace root with `bun install --frozen-lockfile`; build each app’s `bun run build`.
   Allow monorepo source outside the project root. Studio’s `withEve` integration owns `/eve/v1`.
2. Provision Neon databases. Use a private Studio database and a separate public signup database.
   The schema is shared, but Web must never get credentials to the private bank. Set each project’s
   `DATABASE_URL`. Migrate each database using `bun run db:migrate` before serving traffic.
3. Enable **Vercel Authentication → All Deployments** on Studio (including production), and
   confirm unauthenticated requests cannot reach pages, API routes or Eve. Only then set
   `STUDIO_DEPLOYMENT_PROTECTED=true`. The flag is a fail-closed deployment assertion, not an
   authentication system. Local Studio accepts loopback requests only.
4. Set a strong random `STUDIO_INTERNAL_TOKEN` and the deployment’s `STUDIO_INTERNAL_URL`.
   Internal Eve callbacks require the token; protected self-requests may additionally need
   `VERCEL_AUTOMATION_BYPASS_SECRET`. Never put these values in NEXT_PUBLIC variables.
5. Remote interviews remain disabled until an authenticated Eve browser channel is implemented
   and tested behind the chosen production gate. Local subscription credentials must not move to
   Vercel. If remote work is enabled later, configure an API/Gateway model connection and its
   budget independently. The current model resolver supports `EVE_MODEL_CONNECTION=gateway`
   for controlled development, but that is not a complete remote-auth rollout.
6. Verify the public signup with its own database. Sending one launch notification is a separate
   explicit launch task; use an email provider, include unsubscribe tokens and record sent_at to
   prevent repeat sends. Do not send launch mail during previews or builds.
7. Disconnect the legacy Cloudflare Git deployment before changing production domains. Assign
   `eggers.dev` to Web and `studio.eggers.dev` to Studio only after access checks pass.

There is no deployment command or migration of old D1/KV content. Existing Cloudflare resources
have not been destroyed. Local PGlite is for one process on the personal computer; it is not a
Vercel persistence strategy. The apps reject missing DATABASE_URL on Vercel.
