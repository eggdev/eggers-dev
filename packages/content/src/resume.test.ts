import resumeSource from '@repo/content/public-resume'
import { makePublicResume, validateResume } from '@repo/content/resume'
import { describe, expect, test } from 'vitest'

const validResume = () => {
  const result = validateResume(resumeSource)
  expect(result.errors).toEqual([])
  if (!result.data) throw new Error('Expected the public resume fixture to be valid')
  return structuredClone(result.data)
}

describe('resume content contract', () => {
  test('accepts the checked-in public projection', () => {
    const resume = validResume()
    expect(resume.version).toBe(1)
    expect(resume.experience.length).toBeGreaterThan(0)
  })

  test('removes retired metadata while decoding', () => {
    const legacy = structuredClone(resumeSource) as typeof resumeSource & {
      experience: Array<{ bullets: Array<Record<string, unknown>> }>
    }
    legacy.experience[0].bullets[0].obsolete = 'old value'
    const result = validateResume(legacy)
    expect(result.errors).toEqual([])
    expect(result.data?.experience[0].bullets[0]).not.toHaveProperty('obsolete')
  })

  test('removes hidden content from the public projection', () => {
    const resume = validResume()
    const hiddenBullet = resume.experience[0].bullets[0]
    hiddenBullet.hidden = true
    resume.skills[0].hidden = true
    const projection = makePublicResume(resume)
    expect(projection.experience[0].bullets.some(({ id }) => id === hiddenBullet.id)).toBe(false)
    expect(projection.skills.some(({ id }) => id === resume.skills[0].id)).toBe(false)
  })
})
