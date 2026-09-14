import { D1Client } from '@effect/sql-d1'
import { type CmsDraft, CmsError, CmsRepository } from '@repo/cms'
import {
  type PublicSiteContent,
  type PublishedSnapshot,
  validatePublicSiteContent,
  validatePublishedSnapshot,
  validateResume,
} from '@repo/content'
import { publicContentSeed } from '@repo/content/seed'
import { Effect, Layer } from 'effect'

interface DraftRow {
  id: 'site'
  content_json: string
  revision: number
  created_at: string
  updated_at: string
  updated_by: string
}

interface PublicationRow {
  draft_revision: number
  published_at: string
  published_by: string
  snapshot_json: string
}

interface LegacyResumeRow {
  data_json: string
}

const storageError = (message: string, cause?: unknown) =>
  new CmsError({ kind: 'storage', message, cause })

const initialDraftContent = (
  legacyResume: LegacyResumeRow | undefined
): Effect.Effect<PublicSiteContent, CmsError> => {
  if (!legacyResume) return Effect.succeed(publicContentSeed)

  return Effect.try({
    try: () => JSON.parse(legacyResume.data_json) as unknown,
    catch: (cause) => storageError('The retained canonical résumé is malformed', cause),
  }).pipe(
    Effect.flatMap((candidate) => {
      const result = validateResume(candidate)
      return result.data
        ? Effect.succeed(result.data)
        : Effect.fail(
            new CmsError({
              kind: 'invalid',
              message: 'The retained canonical résumé is invalid',
              details: result.errors,
            })
          )
    }),
    Effect.map((resume) => ({ ...publicContentSeed, resume }))
  )
}

const mapDraft = (row: DraftRow): Effect.Effect<CmsDraft, CmsError> =>
  Effect.try({
    try: () => JSON.parse(row.content_json) as unknown,
    catch: (cause) => storageError('Stored CMS draft is malformed', cause),
  }).pipe(
    Effect.flatMap((candidate) => {
      const result = validatePublicSiteContent(candidate)
      return result.data
        ? Effect.succeed(result.data)
        : Effect.fail(
            new CmsError({
              kind: 'invalid',
              message: 'Stored CMS draft is invalid',
              details: result.errors,
            })
          )
    }),
    Effect.map((content) => ({
      id: row.id,
      content,
      revision: row.revision,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by,
    }))
  )

export const makeCmsRepositoryLayer = (db: D1Database): Layer.Layer<CmsRepository> => {
  const repositoryLayer = Layer.effect(
    CmsRepository,
    Effect.gen(function* () {
      const sql = yield* D1Client.D1Client

      const getDraft = Effect.gen(function* () {
        let rows =
          yield* sql<DraftRow>`SELECT id, content_json, revision, created_at, updated_at, updated_by
          FROM cms_site_drafts WHERE id = 'site' LIMIT 1`
        if (rows.length === 0) {
          const now = new Date().toISOString()
          const legacyResumes = yield* sql<LegacyResumeRow>`SELECT data_json FROM resumes
              WHERE is_canonical = 1 ORDER BY updated_at DESC LIMIT 1`
          const content = yield* initialDraftContent(legacyResumes[0])
          const contentJson = JSON.stringify(content)
          yield* sql`INSERT INTO cms_site_drafts
            (id, content_json, revision, created_at, updated_at, updated_by)
            VALUES ('site', ${contentJson}, 1, ${now}, ${now}, 'seed')
            ON CONFLICT(id) DO NOTHING`
          rows =
            yield* sql<DraftRow>`SELECT id, content_json, revision, created_at, updated_at, updated_by
            FROM cms_site_drafts WHERE id = 'site' LIMIT 1`
        }
        const row = rows[0]
        if (!row) {
          return yield* Effect.fail(
            new CmsError({ kind: 'not-found', message: 'CMS draft was not found' })
          )
        }
        return yield* mapDraft(row)
      }).pipe(
        Effect.mapError((error) =>
          error instanceof CmsError ? error : storageError('Could not load CMS draft', error)
        ),
        Effect.withSpan('database.cms.draft.get')
      )

      return CmsRepository.of({
        getDraft,
        saveDraft: (content: PublicSiteContent, expectedRevision: number, actor: string) => {
          const now = new Date().toISOString()
          const contentJson = JSON.stringify(content)
          return sql<DraftRow>`UPDATE cms_site_drafts
            SET content_json = ${contentJson}, revision = revision + 1,
                updated_at = ${now}, updated_by = ${actor}
            WHERE id = 'site' AND revision = ${expectedRevision}
            RETURNING id, content_json, revision, created_at, updated_at, updated_by`.pipe(
            Effect.flatMap((rows) =>
              rows[0]
                ? mapDraft(rows[0])
                : Effect.fail(
                    new CmsError({
                      kind: 'conflict',
                      message: 'The site draft changed elsewhere; refresh and try again',
                    })
                  )
            ),
            Effect.mapError((error) =>
              error instanceof CmsError ? error : storageError('Could not save CMS draft', error)
            ),
            Effect.withSpan('database.cms.draft.save')
          )
        },
        getLatestPublication: sql<PublicationRow>`SELECT draft_revision, published_at, published_by,
            snapshot_json FROM cms_publications ORDER BY published_at DESC LIMIT 1`.pipe(
          Effect.flatMap((rows) => {
            const row = rows[0]
            if (!row) return Effect.succeed(undefined)
            return Effect.try({
              try: () => JSON.parse(row.snapshot_json) as unknown,
              catch: (cause) => storageError('Stored publication is malformed', cause),
            }).pipe(
              Effect.flatMap((candidate) => {
                const result = validatePublishedSnapshot(candidate)
                return result.data
                  ? Effect.succeed(result.data)
                  : Effect.fail(
                      new CmsError({
                        kind: 'invalid',
                        message: 'Stored publication is invalid',
                        details: result.errors,
                      })
                    )
              }),
              Effect.map((snapshot) => ({
                revision: snapshot.revision,
                publishedAt: snapshot.publishedAt,
                publishedBy: snapshot.publishedBy,
              }))
            )
          }),
          Effect.mapError((error) =>
            error instanceof CmsError
              ? error
              : storageError('Could not load publication history', error)
          )
        ),
        recordPublication: (snapshot: PublishedSnapshot) => {
          const id = crypto.randomUUID()
          const snapshotJson = JSON.stringify(snapshot)
          return sql`INSERT INTO cms_publications
            (id, draft_revision, published_at, published_by, snapshot_json)
            VALUES (${id}, ${snapshot.revision}, ${snapshot.publishedAt}, ${snapshot.publishedBy}, ${snapshotJson})`.pipe(
            Effect.asVoid,
            Effect.mapError((error) => storageError('Could not record publication', error)),
            Effect.withSpan('database.cms.publication.record')
          )
        },
      })
    })
  )

  return repositoryLayer.pipe(Layer.provide(D1Client.layer({ db })), Layer.orDie)
}
