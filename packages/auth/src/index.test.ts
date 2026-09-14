import {
  AccessAuth,
  authenticateRequest,
  decodeAccessConfig,
  makeAccessAuthLayer,
} from '@repo/auth'
import { Effect } from 'effect'
import { describe, expect, test } from 'vitest'

const config = {
  teamDomain: 'https://example.cloudflareaccess.com',
  audience: 'test-audience',
  allowedEmails: ['brendan@eggers.dev'],
  allowLocalBypass: true,
}

describe('Cloudflare Access authentication', () => {
  test('only bypasses Access for an explicitly allowed loopback request', async () => {
    const local = await Effect.runPromise(
      authenticateRequest(new Request('http://127.0.0.1/api/bootstrap')).pipe(
        Effect.provide(makeAccessAuthLayer(config))
      )
    )
    expect(local).toEqual({ email: 'brendan@eggers.dev', local: true })

    const remote = await Effect.runPromise(
      authenticateRequest(new Request('https://home.eggers.dev/api/bootstrap')).pipe(
        Effect.provide(makeAccessAuthLayer(config)),
        Effect.flip
      )
    )
    expect(remote.kind).toBe('missing')
  })

  test('rejects deployment placeholders', async () => {
    const error = await Effect.runPromise(
      decodeAccessConfig({ ...config, audience: 'REPLACE_WITH_ACCESS_AUD' }).pipe(Effect.flip)
    )
    expect(error.kind).toBe('configuration')
  })

  test('exposes the service through its stable Effect tag', async () => {
    const identity = await Effect.runPromise(
      Effect.flatMap(AccessAuth, ({ authenticate }) =>
        authenticate(new Request('http://localhost/'))
      ).pipe(Effect.provide(makeAccessAuthLayer(config)))
    )
    expect(identity.local).toBe(true)
  })
})
