import type {
  ApiErrorPayload,
  AppPreferences,
  Confidence,
  DestinationPlanningUpdate,
  PlanningStatus,
  ResearchEntryInput,
  ScoreKey,
} from '../shared'
import { scoreKeys } from '../shared'
import { authenticate, type HomeIdentity } from './auth'
import { createResearchEntry, getBootstrap, saveDestinationPlanning, savePreferences } from './db'

class ApiProblem extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly details?: string[]
  ) {
    super(message)
  }
}

const planningStatuses: PlanningStatus[] = [
  'exploring',
  'shortlist',
  'finalist',
  'booked',
  'parked',
]
const confidenceLevels: Confidence[] = [
  'verified_current',
  'source_backed_general',
  'estimate',
  'needs_live_verification',
]
const entityTypes: ResearchEntryInput['entityType'][] = [
  'general',
  'destination',
  'hotel',
  'flight',
  'trip',
]

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const json = (value: unknown, init: ResponseInit = {}): Response => {
  const response = Response.json(value, init)
  response.headers.set('Cache-Control', 'no-store')
  return response
}

const boundedJson = async (request: Request): Promise<unknown> => {
  const length = Number(request.headers.get('content-length') ?? '0')
  if (length > 100_000) throw new ApiProblem('Request body is too large', 413)
  try {
    return await request.json()
  } catch {
    throw new ApiProblem('Request body must be valid JSON')
  }
}

const requiredText = (value: unknown, label: string, maxLength: number): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ApiProblem(`${label} is required`)
  }
  const trimmed = value.trim()
  if (trimmed.length > maxLength) throw new ApiProblem(`${label} is too long`)
  return trimmed
}

const optionalText = (value: unknown, label: string, maxLength: number): string | undefined => {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') throw new ApiProblem(`${label} must be text`)
  const trimmed = value.trim()
  if (trimmed.length > maxLength) throw new ApiProblem(`${label} is too long`)
  return trimmed || undefined
}

const parseDestinationUpdate = (value: unknown): DestinationPlanningUpdate => {
  if (!isRecord(value)) throw new ApiProblem('Destination update must be an object')
  if (typeof value.isFavorite !== 'boolean') throw new ApiProblem('Favorite must be true or false')
  if (!planningStatuses.includes(value.planningStatus as PlanningStatus)) {
    throw new ApiProblem('Planning status is invalid')
  }
  if (typeof value.revision !== 'number' || !Number.isInteger(value.revision)) {
    throw new ApiProblem('Revision is invalid')
  }
  return {
    isFavorite: value.isFavorite,
    planningStatus: value.planningStatus as PlanningStatus,
    personalNote: optionalText(value.personalNote, 'Personal note', 5_000) ?? '',
    revision: value.revision,
  }
}

const parseResearchEntry = (value: unknown): ResearchEntryInput => {
  if (!isRecord(value)) throw new ApiProblem('Research entry must be an object')
  if (!entityTypes.includes(value.entityType as ResearchEntryInput['entityType'])) {
    throw new ApiProblem('Research entity type is invalid')
  }
  if (!confidenceLevels.includes(value.confidence as Confidence)) {
    throw new ApiProblem('Confidence is invalid')
  }
  const sourceUrl = optionalText(value.sourceUrl, 'Source URL', 2_000)
  if (sourceUrl) {
    let parsed: URL
    try {
      parsed = new URL(sourceUrl)
    } catch {
      throw new ApiProblem('Source URL is invalid')
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new ApiProblem('Source URL must use HTTP or HTTPS')
    }
  }
  return {
    entityType: value.entityType as ResearchEntryInput['entityType'],
    entityId: optionalText(value.entityId, 'Related item', 200),
    title: requiredText(value.title, 'Title', 200),
    summary: requiredText(value.summary, 'Finding', 5_000),
    sourceUrl,
    verifiedAt: optionalText(value.verifiedAt, 'Verification date', 30),
    confidence: value.confidence as Confidence,
  }
}

const parsePreferences = (value: unknown): AppPreferences => {
  if (!isRecord(value) || !isRecord(value.weights)) {
    throw new ApiProblem('Preferences must include score weights')
  }
  const rawWeights = value.weights
  if (
    typeof value.stylePosition !== 'number' ||
    !Number.isInteger(value.stylePosition) ||
    value.stylePosition < 0 ||
    value.stylePosition > 100
  ) {
    throw new ApiProblem('Trip style must be between 0 and 100')
  }
  const parsedWeights = Object.fromEntries(
    scoreKeys.map((key) => {
      const weight = rawWeights[key]
      if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0 || weight > 100) {
        throw new ApiProblem(`Weight for ${key} is invalid`)
      }
      return [key, weight]
    })
  ) as Record<ScoreKey, number>
  if (Object.values(parsedWeights).reduce((total, weight) => total + weight, 0) <= 0) {
    throw new ApiProblem('At least one score weight must be greater than zero')
  }
  return { stylePosition: value.stylePosition, weights: parsedWeights }
}

const applySecurityHeaders = (response: Response, local = false): Response => {
  const secured = new Response(response.body, response)
  secured.headers.set('X-Content-Type-Options', 'nosniff')
  secured.headers.set('X-Frame-Options', 'DENY')
  secured.headers.set('Referrer-Policy', 'no-referrer')
  secured.headers.set('X-Robots-Tag', 'noindex, nofollow')
  secured.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  secured.headers.set(
    'Content-Security-Policy',
    `default-src 'self'; script-src 'self'${local ? " 'unsafe-inline'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'${local ? ' ws:' : ''}; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`
  )
  return secured
}

const hasTrustedOrigin = (request: Request): boolean => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return true
  const origin = request.headers.get('Origin')
  return origin !== null && origin === new URL(request.url).origin
}

async function handleApi(request: Request, env: Env, identity: HomeIdentity): Promise<Response> {
  const { pathname } = new URL(request.url)

  if (request.method === 'GET' && pathname === '/api/bootstrap') {
    return json(await getBootstrap(env, identity))
  }

  const destinationMatch = pathname.match(/^\/api\/destinations\/([^/]+)\/planning$/)
  if (request.method === 'PUT' && destinationMatch) {
    const id = decodeURIComponent(destinationMatch[1])
    return json(
      await saveDestinationPlanning(
        env,
        identity,
        id,
        parseDestinationUpdate(await boundedJson(request))
      )
    )
  }

  if (request.method === 'POST' && pathname === '/api/research') {
    return json(
      await createResearchEntry(env, identity, parseResearchEntry(await boundedJson(request))),
      {
        status: 201,
      }
    )
  }

  if (request.method === 'PUT' && pathname === '/api/preferences') {
    return json(await savePreferences(env, identity, parsePreferences(await boundedJson(request))))
  }

  throw new ApiProblem('Not found', 404)
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const identity = await authenticate(request, env)
    if (!identity) {
      return applySecurityHeaders(
        json({ error: 'Unauthorized' } satisfies ApiErrorPayload, { status: 401 })
      )
    }

    try {
      if (url.pathname.startsWith('/api/') && !hasTrustedOrigin(request)) {
        throw new ApiProblem('Request origin is not allowed', 403)
      }
      const response = url.pathname.startsWith('/api/')
        ? await handleApi(request, env, identity)
        : await env.ASSETS.fetch(request)
      return applySecurityHeaders(response, identity.local)
    } catch (error) {
      const conflict =
        error instanceof Error && error.message.includes('changed elsewhere')
          ? new ApiProblem(error.message, 409)
          : null
      const problem = error instanceof ApiProblem ? error : conflict
      if (!problem) {
        console.error(
          JSON.stringify({
            message: 'Unhandled Home request error',
            method: request.method,
            path: url.pathname,
            error: error instanceof Error ? error.message : String(error),
          })
        )
      }
      return applySecurityHeaders(
        json(
          { error: problem?.message ?? 'Internal server error', details: problem?.details },
          { status: problem?.status ?? 500 }
        ),
        identity.local
      )
    }
  },
} satisfies ExportedHandler<Env>
