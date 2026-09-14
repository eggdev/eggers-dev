import { Context, Data, Effect, Layer, ParseResult, Schema } from 'effect'
import { createRemoteJWKSet, jwtVerify } from 'jose'

export interface Identity {
  email: string
  local: boolean
}

export interface AccessConfig {
  teamDomain: string
  audience: string
  allowedEmails: ReadonlyArray<string>
  allowLocalBypass: boolean
}

export const AccessConfigSchema = Schema.Struct({
  teamDomain: Schema.String.pipe(Schema.minLength(1)),
  audience: Schema.String.pipe(Schema.minLength(1)),
  allowedEmails: Schema.Array(Schema.String.pipe(Schema.minLength(3))),
  allowLocalBypass: Schema.Boolean,
})

export class AuthError extends Data.TaggedError('AuthError')<{
  readonly kind: 'configuration' | 'missing' | 'invalid' | 'forbidden'
  readonly message: string
  readonly cause?: unknown
}> {}

export interface AccessAuthService {
  readonly authenticate: (request: Request) => Effect.Effect<Identity, AuthError>
}

export class AccessAuth extends Context.Tag('@repo/auth/AccessAuth')<
  AccessAuth,
  AccessAuthService
>() {}

const jwksByIssuer = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

const isLoopback = (url: URL): boolean =>
  url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'

const jwksFor = (issuer: string): ReturnType<typeof createRemoteJWKSet> => {
  const existing = jwksByIssuer.get(issuer)
  if (existing) return existing
  const created = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`))
  jwksByIssuer.set(issuer, created)
  return created
}

export const decodeAccessConfig = (value: unknown): Effect.Effect<AccessConfig, AuthError> =>
  Schema.decodeUnknown(AccessConfigSchema)(value).pipe(
    Effect.map((config) => ({
      ...config,
      teamDomain: config.teamDomain.replace(/\/$/, ''),
      allowedEmails: config.allowedEmails.map((email) => email.trim().toLowerCase()),
    })),
    Effect.mapError(
      (error) =>
        new AuthError({
          kind: 'configuration',
          message: ParseResult.TreeFormatter.formatErrorSync(error),
          cause: error,
        })
    ),
    Effect.filterOrFail(
      (config) =>
        !config.teamDomain.includes('REPLACE_') &&
        !config.audience.includes('REPLACE_') &&
        config.allowedEmails.length > 0,
      () =>
        new AuthError({
          kind: 'configuration',
          message: 'Cloudflare Access is not configured',
        })
    )
  )

export const makeAccessAuthLayer = (config: AccessConfig): Layer.Layer<AccessAuth> =>
  Layer.succeed(AccessAuth, {
    authenticate: (request) => {
      const requestUrl = new URL(request.url)
      if (isLoopback(requestUrl) && config.allowLocalBypass) {
        return Effect.succeed({ email: config.allowedEmails[0], local: true })
      }

      const token = request.headers.get('Cf-Access-Jwt-Assertion')
      if (!token) {
        return Effect.fail(new AuthError({ kind: 'missing', message: 'Access token is missing' }))
      }

      const issuer = config.teamDomain.replace(/\/$/, '')
      return Effect.tryPromise({
        try: () => jwtVerify(token, jwksFor(issuer), { audience: config.audience, issuer }),
        catch: (cause) =>
          new AuthError({ kind: 'invalid', message: 'Access token is invalid', cause }),
      }).pipe(
        Effect.flatMap(({ payload }) => {
          const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : undefined
          return email && config.allowedEmails.includes(email)
            ? Effect.succeed({ email, local: false })
            : Effect.fail(
                new AuthError({ kind: 'forbidden', message: 'This identity is not allowed' })
              )
        }),
        Effect.withSpan('auth.cloudflare-access')
      )
    },
  })

export const authenticateRequest = (
  request: Request
): Effect.Effect<Identity, AuthError, AccessAuth> =>
  Effect.flatMap(AccessAuth, ({ authenticate }) => authenticate(request))
