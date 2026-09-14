import {
  type CmsDraft,
  CmsRepository,
  createSitePreview,
  PublicationStore,
  publishSite,
} from '@repo/cms'
import { publicContentSeed } from '@repo/content/seed'
import { Effect, Layer } from 'effect'
import { describe, expect, test } from 'vitest'

const draft: CmsDraft = {
  id: 'site',
  content: publicContentSeed,
  revision: 4,
  createdAt: '2026-09-14T10:00:00.000Z',
  updatedAt: '2026-09-14T11:00:00.000Z',
  updatedBy: 'brendan@eggers.dev',
}

describe('CMS publication workflow', () => {
  test('publishes a single validated snapshot and records its audit', async () => {
    const published: unknown[] = []
    const audited: unknown[] = []
    const layer = Layer.merge(
      Layer.succeed(CmsRepository, {
        getDraft: Effect.succeed(draft),
        saveDraft: () => Effect.succeed(draft),
        getLatestPublication: Effect.succeed(undefined),
        recordPublication: (snapshot) =>
          Effect.sync(() => audited.push(snapshot)).pipe(Effect.asVoid),
      }),
      Layer.succeed(PublicationStore, {
        publish: (snapshot) => Effect.sync(() => published.push(snapshot)).pipe(Effect.asVoid),
        putPreview: () => Effect.void,
        getPublished: Effect.succeed(undefined),
        getPreview: () => Effect.succeed(undefined),
      })
    )

    const snapshot = await Effect.runPromise(
      publishSite('brendan@eggers.dev').pipe(Effect.provide(layer))
    )
    expect(snapshot.revision).toBe(4)
    expect(published).toEqual([snapshot])
    expect(audited).toEqual([snapshot])
  })

  test('creates an expiring preview without publishing it', async () => {
    const previewIds: string[] = []
    const layer = Layer.merge(
      Layer.succeed(CmsRepository, {
        getDraft: Effect.succeed(draft),
        saveDraft: () => Effect.succeed(draft),
        getLatestPublication: Effect.succeed(undefined),
        recordPublication: () => Effect.void,
      }),
      Layer.succeed(PublicationStore, {
        publish: () => Effect.void,
        putPreview: (id) => Effect.sync(() => previewIds.push(id)).pipe(Effect.asVoid),
        getPublished: Effect.succeed(undefined),
        getPreview: () => Effect.succeed(undefined),
      })
    )

    const preview = await Effect.runPromise(
      createSitePreview('brendan@eggers.dev').pipe(Effect.provide(layer))
    )
    expect(preview.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(previewIds).toEqual([preview.id])
  })
})
