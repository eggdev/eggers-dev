import { describe, expect, test } from 'bun:test'
import resumeSource from './public-resume.json'
import { getUnverifiedClaims, makePublicResume, validateResume } from './schema'

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

  test('finds only visible unverified claims', () => {
    const resume = validResume()
    resume.experience[0].bullets[0].status = 'unverified'
    resume.experience[0].bullets[1].status = 'unverified'
    resume.experience[0].bullets[1].hidden = true
    expect(getUnverifiedClaims(resume).map((claim) => claim.id)).toEqual([
      resume.experience[0].bullets[0].id,
    ])
  })

  test('removes hidden and private fields from the public projection', () => {
    const resume = validResume()
    const hiddenBullet = resume.experience[0].bullets[0]
    hiddenBullet.hidden = true
    hiddenBullet.evidence = 'Private source note'
    hiddenBullet.sourceDocumentId = 'private-document'
    resume.experience[0].bullets[1].evidence = 'Private source note'
    resume.skills[0].hidden = true

    const projection = makePublicResume(resume)
    expect(projection.experience[0].bullets.some((bullet) => bullet.id === hiddenBullet.id)).toBe(
      false
    )
    expect(projection.experience[0].bullets[0].evidence).toBeUndefined()
    expect(projection.experience[0].bullets[0].sourceDocumentId).toBeUndefined()
    expect(projection.skills.some((row) => row.id === resume.skills[0].id)).toBe(false)
  })
})
