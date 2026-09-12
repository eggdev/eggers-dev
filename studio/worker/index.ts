import {
  getUnverifiedClaims,
  makePublicResume,
  type ResumeContent,
  validateResume,
} from '@career/schema'
import {
  type ApiErrorPayload,
  type CareerDocument,
  documentKinds,
  documentVisibilities,
} from '../shared'
import { authenticate, type StudioIdentity } from './auth'
import {
  archiveDocument,
  cloneResume,
  createDocument,
  ensureSeeded,
  getResume,
  listDocuments,
  listResumes,
  recordPublish,
  updateDocument,
  updateResume,
} from './db'
import { publishResumeToGitHub } from './github'

class ApiProblem extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly details?: string[]
  ) {
    super(message)
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const json = (value: unknown, init: ResponseInit = {}): Response => {
  const response = Response.json(value, init)
  response.headers.set('Cache-Control', 'no-store')
  return response
}

const boundedJson = async (request: Request): Promise<unknown> => {
  const length = Number(request.headers.get('content-length') ?? '0')
  if (length > 1_000_000) throw new ApiProblem('Request body is too large', 413)
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
  const text = value.trim()
  if (text.length > maxLength) throw new ApiProblem(`${label} is too long`)
  return text
}

const optionalText = (value: unknown, label: string, maxLength: number): string => {
  if (typeof value !== 'string') throw new ApiProblem(`${label} must be text`)
  if (value.length > maxLength) throw new ApiProblem(`${label} is too long`)
  return value
}

const parseTags = (value: unknown): string[] => {
  if (!Array.isArray(value) || !value.every((tag) => typeof tag === 'string')) {
    throw new ApiProblem('Tags must be an array of text values')
  }
  if (value.length > 30 || value.some((tag) => tag.length > 40)) {
    throw new ApiProblem('Use at most 30 tags of 40 characters each')
  }
  return [...new Set(value.map((tag) => tag.trim().toLowerCase()).filter(Boolean))]
}

const parseDocument = (value: unknown, id?: string): CareerDocument => {
  if (!isRecord(value)) throw new ApiProblem('Document must be an object')
  const kind = value.kind
  const visibility = value.visibility
  if (!documentKinds.includes(kind as CareerDocument['kind'])) {
    throw new ApiProblem('Document kind must be inbox or note')
  }
  if (!documentVisibilities.includes(visibility as CareerDocument['visibility'])) {
    throw new ApiProblem('Document visibility is invalid')
  }
  return {
    id: id ?? '',
    title: requiredText(value.title, 'Title', 200),
    kind: kind as CareerDocument['kind'],
    visibility: visibility as CareerDocument['visibility'],
    tags: parseTags(value.tags),
    bodyMarkdown: optionalText(value.bodyMarkdown, 'Body', 250_000),
    revision: typeof value.revision === 'number' ? value.revision : 0,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : '',
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '',
  }
}

const parseResumeUpdate = (value: unknown): { title: string; data: ResumeContent } => {
  if (!isRecord(value)) throw new ApiProblem('Résumé must be an object')
  const title = requiredText(value.title, 'Title', 200)
  const result = validateResume(value.data)
  if (!result.data || result.errors.length > 0) {
    throw new ApiProblem('Résumé validation failed', 422, result.errors)
  }
  return { title, data: result.data }
}

async function handleApi(request: Request, env: Env, identity: StudioIdentity): Promise<Response> {
  const { pathname } = new URL(request.url)

  if (request.method === 'GET' && pathname === '/api/bootstrap') {
    await ensureSeeded(env)
    const [documents, resumes] = await Promise.all([listDocuments(env), listResumes(env)])
    return json({ identity, documents, resumes })
  }

  if (request.method === 'POST' && pathname === '/api/documents') {
    const document = parseDocument(await boundedJson(request))
    return json(await createDocument(env, document), { status: 201 })
  }

  const documentMatch = pathname.match(/^\/api\/documents\/([^/]+)$/)
  if (documentMatch && request.method === 'PUT') {
    const document = parseDocument(await boundedJson(request), decodeURIComponent(documentMatch[1]))
    return json(await updateDocument(env, document))
  }
  if (documentMatch && request.method === 'DELETE') {
    await archiveDocument(env, decodeURIComponent(documentMatch[1]))
    return new Response(null, { status: 204 })
  }

  const resumeMatch = pathname.match(/^\/api\/resumes\/([^/]+)$/)
  if (resumeMatch && request.method === 'PUT') {
    const id = decodeURIComponent(resumeMatch[1])
    const input = parseResumeUpdate(await boundedJson(request))
    return json(await updateResume(env, id, input.title, input.data))
  }

  const cloneMatch = pathname.match(/^\/api\/resumes\/([^/]+)\/clone$/)
  if (cloneMatch && request.method === 'POST') {
    return json(await cloneResume(env, decodeURIComponent(cloneMatch[1])), { status: 201 })
  }

  const publishMatch = pathname.match(/^\/api\/resumes\/([^/]+)\/publish$/)
  if (publishMatch && request.method === 'POST') {
    const resume = await getResume(env, decodeURIComponent(publishMatch[1]))
    if (!resume) throw new ApiProblem('Résumé not found', 404)
    if (!resume.isCanonical) {
      throw new ApiProblem('Only the canonical résumé can be published', 409)
    }
    const unverified = getUnverifiedClaims(resume.data)
    if (unverified.length > 0) {
      throw new ApiProblem(
        'Resolve unverified claims before publishing',
        422,
        unverified.map((claim) => claim.text)
      )
    }
    const publicResume = makePublicResume(resume.data)
    const commit = await publishResumeToGitHub(env, resume.title, publicResume)
    const publishedAt = await recordPublish(env, resume.id, commit.sha, commit.url)
    return json({ commitSha: commit.sha, commitUrl: commit.url, publishedAt })
  }

  throw new ApiProblem('Not found', 404)
}

const applySecurityHeaders = (response: Response, local = false): Response => {
  const secured = new Response(response.body, response)
  secured.headers.set('X-Content-Type-Options', 'nosniff')
  secured.headers.set('X-Frame-Options', 'DENY')
  secured.headers.set('Referrer-Policy', 'no-referrer')
  secured.headers.set('X-Robots-Tag', 'noindex, nofollow')
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
      const problem = error instanceof ApiProblem ? error : null
      if (!problem) {
        console.error(
          JSON.stringify({
            message: 'Unhandled studio request error',
            method: request.method,
            path: url.pathname,
            error: error instanceof Error ? error.message : String(error),
          })
        )
      }
      const payload: ApiErrorPayload = {
        error: problem?.message ?? 'Internal server error',
        details: problem?.details,
      }
      return applySecurityHeaders(json(payload, { status: problem?.status ?? 500 }), identity.local)
    }
  },
} satisfies ExportedHandler<Env>
