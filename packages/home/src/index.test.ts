import { AppPreferencesSchema, DestinationPlanningUpdateSchema } from '@repo/home'
import { Effect, Schema } from 'effect'
import { describe, expect, test } from 'vitest'

const weights = {
  points_fit: 10,
  beach_water: 10,
  food: 10,
  relaxation: 10,
  adventure: 10,
  spring_weather: 10,
  hotel_wow: 10,
  cash_efficiency: 10,
  logistics_ease: 20,
}

describe('Home input contracts', () => {
  test('accepts a complete preference payload', async () => {
    const decoded = await Effect.runPromise(
      Schema.decodeUnknown(AppPreferencesSchema)({ stylePosition: 50, weights })
    )
    expect(decoded.weights.logistics_ease).toBe(20)
  })

  test('rejects stale or malformed planning revisions', async () => {
    const result = await Effect.runPromise(
      Schema.decodeUnknown(DestinationPlanningUpdateSchema)({
        isFavorite: true,
        planningStatus: 'shortlist',
        personalNote: 'Strong fit',
        revision: -1,
      }).pipe(Effect.either)
    )
    expect(result._tag).toBe('Left')
  })
})
