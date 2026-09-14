import { authenticateRequest, type Identity, makeAccessAuthLayer } from '@repo/auth'
import {
  CmsError,
  createSitePreview,
  getCmsBootstrap,
  makePublicationStoreLayer,
  publishSite,
  saveSiteDraft,
} from '@repo/cms'
import { PublicSiteContentSchema } from '@repo/content'
import { makeCmsRepositoryLayer } from '@repo/database/cms'
import {
  ApiProblem,
  assetEffect,
  decodeJson,
  json,
  problem,
  protectedWorkerEffect,
  runWorkerEffect,
} from '@repo/worker'
import { readStudioConfig, type StudioConfig, type StudioEnv } from '@studio/env'
import { Effect, Layer, Schema } from 'effect'

const SaveDraftSchema = Schema.Struct({
  content: PublicSiteContentSchema,
  revision: Schema.Number.pipe(Schema.int(), Schema.positive()),
})

const cmsProblem = (error: CmsError): ApiProblem =>
  problem(
    error.message,
    error.kind === 'conflict'
      ? 409
      : error.kind === 'not-found'
        ? 404
        : error.kind === 'invalid'
          ? 422
          : 500,
    error.details
  )

const handleApi = (
  request: Request,
  env: StudioEnv,
  config: StudioConfig,
  identity: Identity
): Effect.Effect<Response, ApiProblem> => {
  const { pathname } = new URL(request.url)
  const layer = Layer.merge(
    makeCmsRepositoryLayer(env.DB),
    makePublicationStoreLayer(env.PUBLIC_CONTENT)
  )

  if (request.method === 'GET' && pathname === '/api/bootstrap') {
    return getCmsBootstrap(identity).pipe(
      Effect.map(json),
      Effect.mapError(cmsProblem),
      Effect.provide(layer)
    )
  }

  if (request.method === 'PUT' && pathname === '/api/site-draft') {
    return decodeJson(request, SaveDraftSchema, 1_000_000).pipe(
      Effect.flatMap(({ content, revision }) => saveSiteDraft(content, revision, identity.email)),
      Effect.map(json),
      Effect.mapError((error) => (error instanceof CmsError ? cmsProblem(error) : error)),
      Effect.provide(layer)
    )
  }

  if (request.method === 'POST' && pathname === '/api/preview') {
    return createSitePreview(identity.email).pipe(
      Effect.map(({ id, expiresInSeconds }) =>
        json({
          id,
          expiresInSeconds,
          url: `${config.publicSiteUrl}/preview/${encodeURIComponent(id)}`,
        })
      ),
      Effect.mapError(cmsProblem),
      Effect.provide(layer)
    )
  }

  if (request.method === 'POST' && pathname === '/api/publish') {
    return publishSite(identity.email).pipe(
      Effect.map((snapshot) =>
        json({
          revision: snapshot.revision,
          publishedAt: snapshot.publishedAt,
          publishedBy: snapshot.publishedBy,
        })
      ),
      Effect.mapError(cmsProblem),
      Effect.provide(layer)
    )
  }

  return Effect.fail(problem('Not found', 404))
}

export default {
  fetch(request: Request, env: StudioEnv): Promise<Response> {
    const configEffect = readStudioConfig(env)
    const authenticate = configEffect.pipe(
      Effect.flatMap((config) =>
        authenticateRequest(request).pipe(Effect.provide(makeAccessAuthLayer(config.access)))
      )
    )
    const program = protectedWorkerEffect({
      request,
      appName: 'studio',
      authenticate,
      handleApi: (identity) =>
        configEffect.pipe(
          Effect.flatMap((config) => handleApi(request, env, config, identity)),
          Effect.mapError((error) =>
            error instanceof ApiProblem ? error : problem(error.message, 500)
          )
        ),
      fetchAssets: assetEffect(env.ASSETS, request),
    })
    return runWorkerEffect(program)
  },
} satisfies ExportedHandler<StudioEnv>
