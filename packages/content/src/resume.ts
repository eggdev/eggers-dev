import { Either, ParseResult, Schema } from 'effect'

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
  location?: string
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

const text = (maxLength: number) => Schema.String.pipe(Schema.maxLength(maxLength))
const optionalText = (maxLength: number) =>
  Schema.optional(Schema.String.pipe(Schema.maxLength(maxLength)))
const id = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(80))

export const ResumeLinkSchema = Schema.Struct({
  id,
  label: text(80),
  href: text(300),
})

export const ResumeBulletSchema = Schema.Struct({
  id,
  text: text(800),
  hidden: Schema.optional(Schema.Boolean),
})

export const ResumeExperienceSchema = Schema.Struct({
  id,
  role: text(120),
  organization: text(120),
  location: optionalText(120),
  period: text(80),
  note: optionalText(300),
  bullets: Schema.mutable(Schema.Array(ResumeBulletSchema).pipe(Schema.maxItems(20))),
  hidden: Schema.optional(Schema.Boolean),
})

export const ResumeRowSchema = Schema.Struct({
  id,
  label: text(80),
  value: text(800),
  trailing: optionalText(80),
  hidden: Schema.optional(Schema.Boolean),
})

export const ResumeContentSchema = Schema.Struct({
  version: Schema.Literal(1),
  density: Schema.Literal(...resumeDensities),
  profile: Schema.Struct({
    name: text(100),
    headline: text(160),
    location: text(120),
    email: text(200),
    summary: text(1_200),
    links: Schema.mutable(Schema.Array(ResumeLinkSchema).pipe(Schema.maxItems(12))),
  }),
  experience: Schema.mutable(Schema.Array(ResumeExperienceSchema).pipe(Schema.maxItems(30))),
  skills: Schema.mutable(Schema.Array(ResumeRowSchema).pipe(Schema.maxItems(20))),
  education: Schema.mutable(Schema.Array(ResumeRowSchema).pipe(Schema.maxItems(20))),
})

export const formatSchemaErrors = (error: ParseResult.ParseError): string[] =>
  ParseResult.ArrayFormatter.formatErrorSync(error).map(({ path, message }) =>
    path.length > 0 ? `${path.join('.')}: ${message}` : message
  )

export function validateResume(value: unknown): ValidationResult<ResumeContent> {
  const decoded = Schema.decodeUnknownEither(ResumeContentSchema)(value)
  return Either.isRight(decoded)
    ? { data: decoded.right as ResumeContent, errors: [] }
    : { errors: formatSchemaErrors(decoded.left) }
}

export function makePublicResume(resume: ResumeContent): ResumeContent {
  const clean = (value: string): string => value.trim()
  const cleanOptional = (value: string | undefined): string | undefined => {
    const cleaned = value?.trim()
    return cleaned ? cleaned : undefined
  }

  return {
    ...resume,
    profile: {
      name: clean(resume.profile.name),
      headline: clean(resume.profile.headline),
      location: clean(resume.profile.location),
      email: clean(resume.profile.email),
      summary: clean(resume.profile.summary),
      links: resume.profile.links
        .map((link) => ({ ...link, label: clean(link.label), href: clean(link.href) }))
        .filter((link) => link.label.length > 0 && link.href.length > 0),
    },
    experience: resume.experience
      .filter((entry) => !entry.hidden)
      .map(({ hidden: _entryHidden, ...entry }) => ({
        ...entry,
        role: clean(entry.role),
        organization: clean(entry.organization),
        location: cleanOptional(entry.location),
        period: clean(entry.period),
        note: cleanOptional(entry.note),
        bullets: entry.bullets
          .filter((bullet) => !bullet.hidden)
          .map(({ hidden: _bulletHidden, ...bullet }) => ({ ...bullet, text: clean(bullet.text) }))
          .filter((bullet) => bullet.text.length > 0),
      }))
      .filter(
        (entry) =>
          entry.role.length > 0 ||
          entry.organization.length > 0 ||
          Boolean(entry.location) ||
          entry.period.length > 0 ||
          Boolean(entry.note) ||
          entry.bullets.length > 0
      ),
    skills: resume.skills
      .filter((row) => !row.hidden)
      .map(({ hidden: _hidden, ...row }) => ({
        ...row,
        label: clean(row.label),
        value: clean(row.value),
        trailing: cleanOptional(row.trailing),
      }))
      .filter((row) => row.label.length > 0 || row.value.length > 0 || Boolean(row.trailing)),
    education: resume.education
      .filter((row) => !row.hidden)
      .map(({ hidden: _hidden, ...row }) => ({
        ...row,
        label: clean(row.label),
        value: clean(row.value),
        trailing: cleanOptional(row.trailing),
      }))
      .filter((row) => row.label.length > 0 || row.value.length > 0 || Boolean(row.trailing)),
  }
}
