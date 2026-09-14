import { env } from 'cloudflare:workers'
import { type AccessConfig, type AuthError, decodeAccessConfig } from '@repo/auth'
import type { Effect } from 'effect'

export const webEnv: Cloudflare.Env = env

export const readWebAccessConfig = (): Effect.Effect<AccessConfig, AuthError> =>
  decodeAccessConfig({
    teamDomain: webEnv.ACCESS_TEAM_DOMAIN,
    audience: webEnv.ACCESS_AUD,
    allowedEmails: webEnv.ALLOWED_EMAILS.split(',').map((email) => email.trim()),
    allowLocalBypass: webEnv.ALLOW_LOCAL_AUTH_BYPASS === 'true',
  })
