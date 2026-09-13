export const resumeDensities = ['comfortable', 'compact', 'tight'] as const
export type ResumeDensity = (typeof resumeDensities)[number]

export interface ResumeLink {
  id: string
  label: string
  href: string
}

export interface ResumeProfile {
  name: string
  headline: string
  location: string
  email: string
  summary: string
  links: ResumeLink[]
}

export interface ResumeBullet {
  id: string
  text: string
  hidden?: boolean
}

export interface ResumeExperience {
  id: string
  role: string
  organization: string
  period: string
  note?: string
  bullets: ResumeBullet[]
  hidden?: boolean
}

export interface ResumeRow {
  id: string
  label: string
  value: string
  trailing?: string
  hidden?: boolean
}

export interface ResumeContent {
  version: 1
  density: ResumeDensity
  profile: ResumeProfile
  experience: ResumeExperience[]
  skills: ResumeRow[]
  education: ResumeRow[]
}

export interface ValidationResult<T> {
  data?: T
  errors: string[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const optionalString = (
  value: unknown,
  path: string,
  errors: string[],
  maxLength: number
): string | undefined => {
  if (value === undefined) return undefined
  if (typeof value !== 'string') {
    errors.push(`${path} must be a string`)
    return undefined
  }
  const trimmed = value.trim()
  if (trimmed.length > maxLength) errors.push(`${path} must be ${maxLength} characters or fewer`)
  return trimmed || undefined
}

const requiredString = (
  value: unknown,
  path: string,
  errors: string[],
  maxLength: number
): string => {
  const parsed = optionalString(value, path, errors, maxLength)
  if (!parsed) errors.push(`${path} is required`)
  return parsed ?? ''
}

const optionalBoolean = (value: unknown, path: string, errors: string[]): boolean | undefined => {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') {
    errors.push(`${path} must be a boolean`)
    return undefined
  }
  return value
}

const parseLink = (value: unknown, path: string, errors: string[]): ResumeLink => {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`)
    return { id: '', label: '', href: '' }
  }
  const id = requiredString(value.id, `${path}.id`, errors, 80)
  const label = requiredString(value.label, `${path}.label`, errors, 40)
  const href = requiredString(value.href, `${path}.href`, errors, 300)
  if (href) {
    try {
      const url = new URL(href)
      if (!['https:', 'mailto:'].includes(url.protocol)) {
        errors.push(`${path}.href must use https or mailto`)
      }
    } catch {
      errors.push(`${path}.href must be a valid URL`)
    }
  }
  return { id, label, href }
}

const parseBullet = (value: unknown, path: string, errors: string[]): ResumeBullet => {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`)
    return { id: '', text: '' }
  }
  return {
    id: requiredString(value.id, `${path}.id`, errors, 80),
    text: requiredString(value.text, `${path}.text`, errors, 800),
    hidden: optionalBoolean(value.hidden, `${path}.hidden`, errors),
  }
}

const parseExperience = (value: unknown, path: string, errors: string[]): ResumeExperience => {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`)
    return { id: '', role: '', organization: '', period: '', bullets: [] }
  }
  const bullets = Array.isArray(value.bullets)
    ? value.bullets.map((bullet, index) => parseBullet(bullet, `${path}.bullets[${index}]`, errors))
    : []
  if (!Array.isArray(value.bullets)) errors.push(`${path}.bullets must be an array`)
  if (bullets.length > 20) errors.push(`${path}.bullets may contain at most 20 items`)
  return {
    id: requiredString(value.id, `${path}.id`, errors, 80),
    role: requiredString(value.role, `${path}.role`, errors, 120),
    organization: requiredString(value.organization, `${path}.organization`, errors, 120),
    period: requiredString(value.period, `${path}.period`, errors, 80),
    note: optionalString(value.note, `${path}.note`, errors, 300),
    bullets,
    hidden: optionalBoolean(value.hidden, `${path}.hidden`, errors),
  }
}

const parseRow = (value: unknown, path: string, errors: string[]): ResumeRow => {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`)
    return { id: '', label: '', value: '' }
  }
  return {
    id: requiredString(value.id, `${path}.id`, errors, 80),
    label: requiredString(value.label, `${path}.label`, errors, 80),
    value: requiredString(value.value, `${path}.value`, errors, 800),
    trailing: optionalString(value.trailing, `${path}.trailing`, errors, 80),
    hidden: optionalBoolean(value.hidden, `${path}.hidden`, errors),
  }
}

export function validateResume(value: unknown): ValidationResult<ResumeContent> {
  const errors: string[] = []
  if (!isRecord(value)) return { errors: ['resume must be an object'] }

  if (value.version !== 1) errors.push('version must be 1')
  const density = resumeDensities.includes(value.density as ResumeDensity)
    ? (value.density as ResumeDensity)
    : 'comfortable'
  if (!resumeDensities.includes(value.density as ResumeDensity)) {
    errors.push('density must be comfortable, compact, or tight')
  }

  const rawProfile = value.profile
  const profile: ResumeProfile = isRecord(rawProfile)
    ? {
        name: requiredString(rawProfile.name, 'profile.name', errors, 100),
        headline: requiredString(rawProfile.headline, 'profile.headline', errors, 160),
        location: requiredString(rawProfile.location, 'profile.location', errors, 120),
        email: requiredString(rawProfile.email, 'profile.email', errors, 200),
        summary: requiredString(rawProfile.summary, 'profile.summary', errors, 1_200),
        links: Array.isArray(rawProfile.links)
          ? rawProfile.links.map((link, index) =>
              parseLink(link, `profile.links[${index}]`, errors)
            )
          : [],
      }
    : { name: '', headline: '', location: '', email: '', summary: '', links: [] }
  if (!isRecord(rawProfile)) errors.push('profile must be an object')
  if (!Array.isArray(rawProfile && isRecord(rawProfile) ? rawProfile.links : undefined)) {
    errors.push('profile.links must be an array')
  }

  const experience = Array.isArray(value.experience)
    ? value.experience.map((entry, index) => parseExperience(entry, `experience[${index}]`, errors))
    : []
  const skills = Array.isArray(value.skills)
    ? value.skills.map((row, index) => parseRow(row, `skills[${index}]`, errors))
    : []
  const education = Array.isArray(value.education)
    ? value.education.map((row, index) => parseRow(row, `education[${index}]`, errors))
    : []
  if (!Array.isArray(value.experience)) errors.push('experience must be an array')
  if (!Array.isArray(value.skills)) errors.push('skills must be an array')
  if (!Array.isArray(value.education)) errors.push('education must be an array')
  if (experience.length > 30) errors.push('experience may contain at most 30 entries')
  if (skills.length > 20) errors.push('skills may contain at most 20 rows')
  if (education.length > 20) errors.push('education may contain at most 20 rows')

  return {
    data: { version: 1, density, profile, experience, skills, education },
    errors,
  }
}

export function makePublicResume(resume: ResumeContent): ResumeContent {
  return {
    ...resume,
    experience: resume.experience
      .filter((entry) => !entry.hidden)
      .map((entry) => ({
        ...entry,
        hidden: undefined,
        bullets: entry.bullets
          .filter((bullet) => !bullet.hidden)
          .map(({ hidden: _hidden, ...bullet }) => bullet),
      })),
    skills: resume.skills.filter((row) => !row.hidden).map(({ hidden: _hidden, ...row }) => row),
    education: resume.education
      .filter((row) => !row.hidden)
      .map(({ hidden: _hidden, ...row }) => row),
  }
}
