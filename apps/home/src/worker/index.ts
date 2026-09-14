import { type HomeEnv, readHomeAccessConfig } from '@home/env'
import { authenticateRequest, type Identity, makeAccessAuthLayer } from '@repo/auth'
import { makeHomeRepositoryLayer } from '@repo/database/home'
import {
  AppPreferencesSchema,
  addResearchEntry,
  DestinationPlanningUpdateSchema,
  getHomeBootstrap,
  type HomeError,
  ResearchEntryInputSchema,
  updateDestinationPlanning,
  updatePreferences,
} from '@repo/home'
import {
  type ApiProblem,
  assetEffect,
  decodeJson,
  json,
  problem,
  protectedWorkerEffect,
  runWorkerEffect,
} from '@repo/worker'
import { Effect } from 'effect'

const homeProblem = (error: HomeError): ApiProblem =>
  problem(error.message, error.kind === 'conflict' ? 409 : error.kind === 'not-found' ? 404 : 500)

const withRepository = <A>(
  effect: Effect.Effect<A, HomeError, import('@repo/home').HomeRepository>,
  env: HomeEnv
) => effect.pipe(Effect.mapError(homeProblem), Effect.provide(makeHomeRepositoryLayer(env.DB)))

const handleApi = (
  request: Request,
  env: HomeEnv,
  identity: Identity
): Effect.Effect<Response, ApiProblem> => {
  const { pathname } = new URL(request.url)

  if (request.method === 'GET' && pathname === '/api/bootstrap') {
    return withRepository(getHomeBootstrap(identity), env).pipe(Effect.map(json))
  }

  const destinationMatch = pathname.match(/^\/api\/destinations\/([^/]+)\/planning$/)
  if (request.method === 'PUT' && destinationMatch) {
    const id = decodeURIComponent(destinationMatch[1])
    return decodeJson(request, DestinationPlanningUpdateSchema).pipe(
      Effect.flatMap((input) =>
        withRepository(updateDestinationPlanning(identity, id, input), env)
      ),
      Effect.map(json)
    )
  }

  if (request.method === 'POST' && pathname === '/api/research') {
    return decodeJson(request, ResearchEntryInputSchema).pipe(
      Effect.flatMap((input) => withRepository(addResearchEntry(identity, input), env)),
      Effect.map((entry) => json(entry, { status: 201 }))
    )
  }

  if (request.method === 'PUT' && pathname === '/api/preferences') {
    return decodeJson(request, AppPreferencesSchema).pipe(
      Effect.flatMap((input) => withRepository(updatePreferences(identity, input), env)),
      Effect.map(json)
    )
  }

  return Effect.fail(problem('Not found', 404))
}

export default {
  fetch(request: Request, env: HomeEnv): Promise<Response> {
    const config = readHomeAccessConfig(env)
    return runWorkerEffect(
      protectedWorkerEffect({
        request,
        appName: 'home',
        authenticate: config.pipe(
          Effect.flatMap((access) =>
            authenticateRequest(request).pipe(Effect.provide(makeAccessAuthLayer(access)))
          )
        ),
        handleApi: (identity) => handleApi(request, env, identity),
        fetchAssets: assetEffect(env.ASSETS, request),
      })
    )
  },
} satisfies ExportedHandler<HomeEnv>
