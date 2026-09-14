import { AuthError, type Identity } from '@repo/auth'
import { Cause, Data, Effect, ParseResult, Schema } from 'effect'

export class ApiProblem extends Data.TaggedError('ApiProblem')<{
  readonly status: number
  readonly message: string
  readonly details?: ReadonlyArray<string>
}> {}

export class WorkerFailure extends Data.TaggedError('WorkerFailure')<{
  readonly message: string
  readonly cause?: unknown
}> {}

export interface ApiErrorPayload {
  error: string
  details?: ReadonlyArray<string>
}

export const problem = (
  message: string,
  status = 400,
  details?: ReadonlyArray<string>
): ApiProblem => new ApiProblem({ status, message, details })

export const json = (value: unknown, init: ResponseInit = {}): Response => {
  const response = Response.json(value, init)
  response.headers.set('Cache-Control', 'no-store')
  return response
}

export const decodeJson = <A, I>(
  request: Request,
  schema: Schema.Schema<A, I, never>,
  maxBytes = 100_000
): Effect.Effect<A, ApiProblem> => {
  const contentLength = Number(request.headers.get('content-length') ?? '0')
  if (contentLength > maxBytes) return Effect.fail(problem('Request body is too large', 413))

  return Effect.tryPromise({
    try: () => request.json(),
    catch: () => problem('Request body must be valid JSON'),
  }).pipe(
    Effect.flatMap(Schema.decodeUnknown(schema)),
    Effect.mapError((error) =>
      error instanceof ApiProblem
        ? error
        : problem(
            'Request body is invalid',
            422,
            ParseResult.ArrayFormatter.formatErrorSync(error).map(({ path, message }) =>
              path.length > 0 ? `${path.join('.')}: ${message}` : message
            )
          )
    )
  )
}

export const isTrustedOrigin = (request: Request): boolean => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return true
  const origin = request.headers.get('Origin')
  return origin !== null && origin === new URL(request.url).origin
}

export const applySecurityHeaders = (
  response: Response,
  options: { allowInlineScripts?: boolean; local?: boolean; privateApp?: boolean } = {}
): Response => {
  const secured = new Response(response.body, response)
  secured.headers.set('X-Content-Type-Options', 'nosniff')
  secured.headers.set('X-Frame-Options', 'DENY')
  secured.headers.set(
    'Referrer-Policy',
    options.privateApp ? 'no-referrer' : 'strict-origin-when-cross-origin'
  )
  secured.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  if (options.privateApp) secured.headers.set('X-Robots-Tag', 'noindex, nofollow')
  secured.headers.set(
    'Content-Security-Policy',
    `default-src 'self'; script-src 'self'${options.local || options.allowInlineScripts ? " 'unsafe-inline'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'${options.local ? ' ws:' : ''}; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`
  )
  return secured
}

const errorResponse = (error: unknown, appName: string, request: Request): Response => {
  if (error instanceof AuthError) {
    const status = error.kind === 'forbidden' ? 403 : 401
    return json(
      { error: status === 403 ? 'Forbidden' : 'Unauthorized' } satisfies ApiErrorPayload,
      {
        status,
      }
    )
  }
  if (error instanceof ApiProblem) {
    return json({ error: error.message, details: error.details } satisfies ApiErrorPayload, {
      status: error.status,
    })
  }

  console.error(
    JSON.stringify({
      message: `Unhandled ${appName} request error`,
      method: request.method,
      path: new URL(request.url).pathname,
      error: error instanceof Error ? error.message : String(error),
    })
  )
  return json({ error: 'Internal server error' } satisfies ApiErrorPayload, { status: 500 })
}

export interface ProtectedWorkerOptions<E> {
  request: Request
  appName: string
  authenticate: Effect.Effect<Identity, AuthError>
  handleApi: (identity: Identity) => Effect.Effect<Response, E>
  fetchAssets: Effect.Effect<Response, WorkerFailure>
}

export const protectedWorkerEffect = <E>({
  request,
  appName,
  authenticate,
  handleApi,
  fetchAssets,
}: ProtectedWorkerOptions<E>): Effect.Effect<Response> =>
  Effect.gen(function* () {
    const identity = yield* authenticate
    const isApi = new URL(request.url).pathname.startsWith('/api/')
    if (isApi && !isTrustedOrigin(request))
      yield* Effect.fail(problem('Request origin is not allowed', 403))
    const response = yield* isApi ? handleApi(identity) : fetchAssets
    return applySecurityHeaders(response, { local: identity.local, privateApp: true })
  }).pipe(
    Effect.catchAll((error) =>
      Effect.succeed(
        applySecurityHeaders(errorResponse(error, appName, request), { privateApp: true })
      )
    ),
    Effect.catchAllCause((cause) =>
      Effect.succeed(
        applySecurityHeaders(errorResponse(Cause.squash(cause), appName, request), {
          privateApp: true,
        })
      )
    ),
    Effect.withSpan(`worker.${appName}.request`, {
      attributes: { method: request.method, path: new URL(request.url).pathname },
    })
  )

export const runWorkerEffect = <A>(effect: Effect.Effect<A, never, never>): Promise<A> =>
  Effect.runPromise(effect)

export const assetEffect = (
  assets: { fetch(request: Request): Promise<Response> },
  request: Request
) =>
  Effect.tryPromise({
    try: () => assets.fetch(request),
    catch: (cause) => new WorkerFailure({ message: 'Could not serve application assets', cause }),
  })
