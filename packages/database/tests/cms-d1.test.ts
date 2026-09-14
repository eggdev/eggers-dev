import { env } from 'cloudflare:workers'
import {
  CmsRepository,
  makePublicationStoreLayer,
  PUBLISHED_CONTENT_KEY,
  publishSite,
} from '@repo/cms'
import { publicContentSeed } from '@repo/content/seed'
import { makeCmsRepositoryLayer } from '@repo/database/cms'
import { Effect, Layer } from 'effect'
import { describe, expect, test } from 'vitest'

describe('CMS D1 repository', () => {
  test('seeds, revisions, and audits a whole-site draft', async () => {
    const program = Effect.gen(function* () {
      const repository = yield* CmsRepository
      const initial = yield* repository.getDraft
      const updated = yield* repository.saveDraft(
        { ...publicContentSeed, footer: { ...publicContentSeed.footer, note: 'Updated' } },
        initial.revision,
        'brendan@eggers.dev'
      )
      yield* repository.recordPublication({
        schemaVersion: 1,
        revision: updated.revision,
        publishedAt: '2026-09-14T12:00:00.000Z',
        publishedBy: 'brendan@eggers.dev',
        content: updated.content,
      })
      return {
        initial,
        updated,
        publication: yield* repository.getLatestPublication,
      }
    }).pipe(Effect.provide(makeCmsRepositoryLayer(env.DB)))

    const result = await Effect.runPromise(program)
    expect(result.initial.revision).toBe(1)
    expect(result.updated.revision).toBe(2)
    expect(result.updated.content.footer.note).toBe('Updated')
    expect(result.publication).toMatchObject({
      revision: 2,
      publishedBy: 'brendan@eggers.dev',
    })
  })

  test('publishes one complete snapshot through real D1 and KV bindings', async () => {
    const layer = Layer.merge(
      makeCmsRepositoryLayer(env.DB),
      makePublicationStoreLayer(env.PUBLIC_CONTENT)
    )
    const snapshot = await Effect.runPromise(
      publishSite('brendan@eggers.dev').pipe(Effect.provide(layer))
    )
    const stored = await env.PUBLIC_CONTENT.get(PUBLISHED_CONTENT_KEY, 'json')

    expect(stored).toEqual(snapshot)
    expect(snapshot.content.seo.title).toBe(publicContentSeed.seo.title)
    expect(snapshot.content.resume.experience.length).toBeGreaterThan(0)
  })

  test('promotes the retained canonical résumé when creating the whole-site draft', async () => {
    const legacyResume = structuredClone(publicContentSeed.resume)
    legacyResume.profile.headline = 'Recovered canonical résumé'
    const now = '2026-09-14T12:00:00.000Z'

    await env.DB.batch([
      env.DB.prepare("DELETE FROM cms_site_drafts WHERE id = 'site'"),
      env.DB.prepare('DELETE FROM resumes'),
      env.DB.prepare(`INSERT INTO resumes
        (id, title, data_json, is_canonical, revision, created_at, updated_at)
        VALUES (?, ?, ?, 1, 263, ?, ?)`).bind(
        'resume-canonical',
        'Canonical résumé',
        JSON.stringify(legacyResume),
        now,
        now
      ),
    ])

    const initial = await Effect.runPromise(
      CmsRepository.pipe(
        Effect.flatMap((repository) => repository.getDraft),
        Effect.provide(makeCmsRepositoryLayer(env.DB))
      )
    )

    expect(initial.revision).toBe(1)
    expect(initial.content.resume.profile.headline).toBe('Recovered canonical résumé')
  })
})
