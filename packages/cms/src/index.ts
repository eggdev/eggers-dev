import {
  makePublicResume,
  type PublicSiteContent,
  type PublishedSnapshot,
  validatePublicSiteContent,
  validatePublishedSnapshot,
} from '@repo/content'
import { Context, Data, Effect, Layer } from 'effect'

export const PUBLISHED_CONTENT_KEY = 'site:published:v1'
export const PREVIEW_CONTENT_PREFIX = 'site:preview:v1:'
export const PREVIEW_TTL_SECONDS = 60 * 60

export interface CmsDraft {
  id: 'site'
  content: PublicSiteContent
  revision: number
  createdAt: string
  updatedAt: string
  updatedBy: string
}

export interface CmsBootstrap {
  identity: { email: string; local: boolean }
  draft: CmsDraft
  published?: { revision: number; publishedAt: string; publishedBy: string }
}

export class CmsError extends Data.TaggedError('CmsError')<{
  readonly kind: 'conflict' | 'invalid' | 'not-found' | 'storage'
  readonly message: string
  readonly details?: ReadonlyArray<string>
  readonly cause?: unknown
}> {}

export interface CmsRepositoryService {
  readonly getDraft: Effect.Effect<CmsDraft, CmsError>
  readonly saveDraft: (
    content: PublicSiteContent,
    expectedRevision: number,
    actor: string
  ) => Effect.Effect<CmsDraft, CmsError>
  readonly getLatestPublication: Effect.Effect<
    { revision: number; publishedAt: string; publishedBy: string } | undefined,
    CmsError
  >
  readonly recordPublication: (snapshot: PublishedSnapshot) => Effect.Effect<void, CmsError>
}

export class CmsRepository extends Context.Tag('@repo/cms/CmsRepository')<
  CmsRepository,
  CmsRepositoryService
>() {}

export interface PublicationStoreService {
  readonly publish: (snapshot: PublishedSnapshot) => Effect.Effect<void, CmsError>
  readonly putPreview: (id: string, snapshot: PublishedSnapshot) => Effect.Effect<void, CmsError>
  readonly getPublished: Effect.Effect<PublishedSnapshot | undefined, CmsError>
  readonly getPreview: (id: string) => Effect.Effect<PublishedSnapshot | undefined, CmsError>
}

export class PublicationStore extends Context.Tag('@repo/cms/PublicationStore')<
  PublicationStore,
  PublicationStoreService
>() {}

export interface KeyValueNamespace {
  readonly get: (key: string, options?: { type: 'json' }) => Promise<unknown>
  readonly put: (
    key: string,
    value: string,
    options?: { expirationTtl?: number; metadata?: unknown }
  ) => Promise<void>
}

const storageFailure = (message: string, cause: unknown) =>
  new CmsError({ kind: 'storage', message, cause })

const decodeSnapshot = (value: unknown): Effect.Effect<PublishedSnapshot, CmsError> => {
  const result = validatePublishedSnapshot(value)
  return result.data
    ? Effect.succeed(result.data)
    : Effect.fail(
        new CmsError({
          kind: 'invalid',
          message: 'Stored public content is invalid',
          details: result.errors,
        })
      )
}

export const makePublicationStoreLayer = (
  namespace: KeyValueNamespace
): Layer.Layer<PublicationStore> =>
  Layer.succeed(PublicationStore, {
    publish: (snapshot) =>
      Effect.tryPromise({
        try: () => namespace.put(PUBLISHED_CONTENT_KEY, JSON.stringify(snapshot)),
        catch: (cause) => storageFailure('Could not publish public content', cause),
      }),
    putPreview: (id, snapshot) =>
      Effect.tryPromise({
        try: () =>
          namespace.put(`${PREVIEW_CONTENT_PREFIX}${id}`, JSON.stringify(snapshot), {
            expirationTtl: PREVIEW_TTL_SECONDS,
          }),
        catch: (cause) => storageFailure('Could not create preview', cause),
      }),
    getPublished: Effect.tryPromise({
      try: () => namespace.get(PUBLISHED_CONTENT_KEY, { type: 'json' }),
      catch: (cause) => storageFailure('Could not read public content', cause),
    }).pipe(
      Effect.flatMap((value) =>
        value === null ? Effect.succeed(undefined) : decodeSnapshot(value)
      )
    ),
    getPreview: (id) =>
      Effect.tryPromise({
        try: () => namespace.get(`${PREVIEW_CONTENT_PREFIX}${id}`, { type: 'json' }),
        catch: (cause) => storageFailure('Could not read preview', cause),
      }).pipe(
        Effect.flatMap((value) =>
          value === null ? Effect.succeed(undefined) : decodeSnapshot(value)
        )
      ),
  })

const validatedContent = (content: unknown): Effect.Effect<PublicSiteContent, CmsError> => {
  const result = validatePublicSiteContent(content)
  return result.data
    ? Effect.succeed(result.data)
    : Effect.fail(
        new CmsError({
          kind: 'invalid',
          message: 'The site draft is not publishable',
          details: result.errors,
        })
      )
}

const publicProjection = (content: PublicSiteContent): PublicSiteContent => ({
  ...content,
  resume: makePublicResume(content.resume),
})

const snapshotFor = (
  draft: CmsDraft,
  actor: string,
  publishedAt = new Date().toISOString()
): PublishedSnapshot => ({
  schemaVersion: 1,
  revision: draft.revision,
  publishedAt,
  publishedBy: actor,
  content: publicProjection(draft.content),
})

export const getCmsBootstrap = (identity: {
  email: string
  local: boolean
}): Effect.Effect<CmsBootstrap, CmsError, CmsRepository> =>
  Effect.gen(function* () {
    const repository = yield* CmsRepository
    const [draft, published] = yield* Effect.all([
      repository.getDraft,
      repository.getLatestPublication,
    ])
    return { identity, draft, published }
  })

export const saveSiteDraft = (
  content: unknown,
  expectedRevision: number,
  actor: string
): Effect.Effect<CmsDraft, CmsError, CmsRepository> =>
  Effect.gen(function* () {
    const validated = yield* validatedContent(content)
    const repository = yield* CmsRepository
    return yield* repository.saveDraft(validated, expectedRevision, actor)
  })

export const publishSite = (
  actor: string
): Effect.Effect<PublishedSnapshot, CmsError, CmsRepository | PublicationStore> =>
  Effect.gen(function* () {
    const repository = yield* CmsRepository
    const publicationStore = yield* PublicationStore
    const draft = yield* repository.getDraft
    const validated = yield* validatedContent(draft.content)
    const snapshot = snapshotFor({ ...draft, content: validated }, actor)
    yield* publicationStore.publish(snapshot)
    yield* repository
      .recordPublication(snapshot)
      .pipe(
        Effect.catchAll((error) =>
          Effect.logError('Published site content, but could not append D1 history').pipe(
            Effect.annotateLogs({ revision: snapshot.revision, actor, error: error.message })
          )
        )
      )
    yield* Effect.logInfo('Published public site content').pipe(
      Effect.annotateLogs({ revision: snapshot.revision, actor })
    )
    return snapshot
  })

export const createSitePreview = (
  actor: string
): Effect.Effect<
  { id: string; expiresInSeconds: number },
  CmsError,
  CmsRepository | PublicationStore
> =>
  Effect.gen(function* () {
    const repository = yield* CmsRepository
    const publicationStore = yield* PublicationStore
    const draft = yield* repository.getDraft
    const validated = yield* validatedContent(draft.content)
    const id = crypto.randomUUID()
    yield* publicationStore.putPreview(id, snapshotFor({ ...draft, content: validated }, actor))
    return { id, expiresInSeconds: PREVIEW_TTL_SECONDS }
  })
