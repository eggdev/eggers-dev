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

const text = (maxLength: number) =>
  Schema.String.pipe(Schema.minLength(1), Schema.maxLength(maxLength))
const optionalText = (maxLength: number) =>
  Schema.optional(Schema.String.pipe(Schema.maxLength(maxLength)))
const id = text(80)

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
  return {
    ...resume,
    experience: resume.experience
      .filter((entry) => !entry.hidden)
      .map(({ hidden: _entryHidden, ...entry }) => ({
        ...entry,
        bullets: entry.bullets
          .filter((bullet) => !bullet.hidden)
          .map(({ hidden: _bulletHidden, ...bullet }) => bullet),
      })),
    skills: resume.skills.filter((row) => !row.hidden).map(({ hidden: _hidden, ...row }) => row),
    education: resume.education
      .filter((row) => !row.hidden)
      .map(({ hidden: _hidden, ...row }) => row),
  }
}
