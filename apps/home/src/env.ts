import { type AccessConfig, type AuthError, decodeAccessConfig } from '@repo/auth'
import type { Effect } from 'effect'

export type HomeEnv = Cloudflare.Env

export const readHomeAccessConfig = (env: HomeEnv): Effect.Effect<AccessConfig, AuthError> =>
  decodeAccessConfig({
    teamDomain: env.ACCESS_TEAM_DOMAIN,
    audience: env.ACCESS_AUD,
    allowedEmails: env.ALLOWED_EMAILS.split(',').map((email) => email.trim()),
    allowLocalBypass: env.ALLOW_LOCAL_AUTH_BYPASS === 'true',
  })
