import { CmsError, makePublicationStoreLayer, PublicationStore } from '@repo/cms'
import type { PublicSiteContent } from '@repo/content'
import { publicContentSeed } from '@repo/content/seed'
import { runWorkerEffect } from '@repo/worker'
import { webEnv } from '@web/env'
import { Effect } from 'effect'

const publicationLayer = () => makePublicationStoreLayer(webEnv.PUBLIC_CONTENT)

export const loadPublishedContent = (): Promise<PublicSiteContent> =>
  runWorkerEffect(
    Effect.gen(function* () {
      const store = yield* PublicationStore
      const snapshot = yield* store.getPublished
      return snapshot?.content ?? publicContentSeed
    }).pipe(
      Effect.provide(publicationLayer()),
      Effect.catchAll((error) =>
        Effect.logWarning('Using checked-in public content fallback').pipe(
          Effect.annotateLogs({ error: error.message }),
          Effect.as(publicContentSeed)
        )
      )
    )
  )

export const loadPreviewContent = (id: string): Promise<PublicSiteContent> =>
  Effect.gen(function* () {
    const store = yield* PublicationStore
    const snapshot = yield* store.getPreview(id)
    if (!snapshot) {
      return yield* Effect.fail(
        new CmsError({ kind: 'not-found', message: 'This preview has expired or does not exist' })
      )
    }
    return snapshot.content
  }).pipe(Effect.provide(publicationLayer()), Effect.runPromise)
