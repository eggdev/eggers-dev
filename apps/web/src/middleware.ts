import { defineMiddleware } from 'astro:middleware'
import { authenticateRequest, makeAccessAuthLayer } from '@repo/auth'
import { applySecurityHeaders, json } from '@repo/worker'
import { readWebAccessConfig } from '@web/env'
import { Effect } from 'effect'

export const onRequest = defineMiddleware(async (context, next) => {
  const preview = context.url.pathname.startsWith('/preview/')
  if (preview) {
    const authenticated = await Effect.runPromise(
      readWebAccessConfig().pipe(
        Effect.flatMap((config) =>
          authenticateRequest(context.request).pipe(Effect.provide(makeAccessAuthLayer(config)))
        ),
        Effect.match({ onFailure: () => false, onSuccess: () => true })
      )
    )
    if (!authenticated) {
      return applySecurityHeaders(json({ error: 'Unauthorized' }, { status: 401 }), {
        privateApp: true,
      })
    }
  }

  const response = await next()
  response.headers.set(
    'Cache-Control',
    preview ? 'private, no-store' : 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600'
  )
  return applySecurityHeaders(response, {
    allowInlineScripts: true,
    allowWasmEval: context.url.pathname === '/resume',
    privateApp: preview,
  })
})
