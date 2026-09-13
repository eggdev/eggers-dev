import { describe, expect, test } from 'bun:test'
import resumeSource from './public-resume.json'
import { makePublicResume, validateResume } from './schema'

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

  test('silently removes retired bullet metadata', () => {
    const legacy = structuredClone(resumeSource)
    legacy.experience[0].bullets[0] = {
      ...legacy.experience[0].bullets[0],
      obsolete: 'old value',
    }

    const result = validateResume(legacy)
    expect(result.errors).toEqual([])
    expect(result.data?.experience[0].bullets[0]).toEqual({
      id: legacy.experience[0].bullets[0].id,
      text: legacy.experience[0].bullets[0].text,
    })
  })

  test('removes hidden content from the public projection', () => {
    const resume = validResume()
    const hiddenBullet = resume.experience[0].bullets[0]
    hiddenBullet.hidden = true
    resume.skills[0].hidden = true

    const projection = makePublicResume(resume)
    expect(projection.experience[0].bullets.some((bullet) => bullet.id === hiddenBullet.id)).toBe(
      false
    )
    expect(projection.skills.some((row) => row.id === resume.skills[0].id)).toBe(false)
  })
})
