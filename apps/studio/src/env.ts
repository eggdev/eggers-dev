import { type AccessConfig, type AuthError, decodeAccessConfig } from '@repo/auth'
import { Effect } from 'effect'

export type StudioEnv = Cloudflare.Env

export interface StudioConfig {
  access: AccessConfig
  publicSiteUrl: string
}

export const readStudioConfig = (env: StudioEnv): Effect.Effect<StudioConfig, AuthError> =>
  decodeAccessConfig({
    teamDomain: env.ACCESS_TEAM_DOMAIN,
    audience: env.ACCESS_AUD,
    allowedEmails: env.ALLOWED_EMAILS.split(',').map((email) => email.trim()),
    allowLocalBypass: env.ALLOW_LOCAL_AUTH_BYPASS === 'true',
  }).pipe(
    Effect.map((access) => ({
      access,
      publicSiteUrl: new URL(env.PUBLIC_SITE_URL).origin,
    }))
  )
