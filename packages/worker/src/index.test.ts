import { applySecurityHeaders, decodeJson, protectedWorkerEffect } from '@repo/worker'
import { Effect, Schema } from 'effect'
import { describe, expect, test } from 'vitest'

describe('Worker HTTP boundary', () => {
  test('rejects cross-origin writes before the API handler runs', async () => {
    let handled = false
    const request = new Request('https://home.eggers.dev/api/preferences', {
      method: 'PUT',
      headers: { Origin: 'https://attacker.example' },
    })

    const response = await Effect.runPromise(
      protectedWorkerEffect({
        request,
        appName: 'home',
        authenticate: Effect.succeed({ email: 'brendan@eggers.dev', local: false }),
        handleApi: () => {
          handled = true
          return Effect.succeed(Response.json({ ok: true }))
        },
        fetchAssets: Effect.succeed(new Response('asset')),
      })
    )

    expect(response.status).toBe(403)
    expect(handled).toBe(false)
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
  })

  test('validates bounded JSON bodies with Effect Schema', async () => {
    const request = new Request('https://studio.eggers.dev/api/example', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    })
    const error = await Effect.runPromise(
      decodeJson(request, Schema.Struct({ name: Schema.String.pipe(Schema.minLength(1)) })).pipe(
        Effect.flip
      )
    )
    expect(error.status).toBe(422)
  })

  test('allows WebAssembly evaluation only when explicitly requested', () => {
    const defaultPolicy = applySecurityHeaders(new Response()).headers.get(
      'Content-Security-Policy'
    )
    const wasmPolicy = applySecurityHeaders(new Response(), { allowWasmEval: true }).headers.get(
      'Content-Security-Policy'
    )

    expect(defaultPolicy).not.toContain("'wasm-unsafe-eval'")
    expect(wasmPolicy).toContain("script-src 'self' 'wasm-unsafe-eval'")
  })
})
