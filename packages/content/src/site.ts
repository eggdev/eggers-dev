import { formatSchemaErrors, type ResumeContent, ResumeContentSchema } from '@repo/content/resume'
import { Either, Schema } from 'effect'

const text = (maxLength: number) =>
  Schema.String.pipe(Schema.minLength(1), Schema.maxLength(maxLength))
const optionalUrl = Schema.optional(Schema.String.pipe(Schema.maxLength(2_000)))

export const LinkSchema = Schema.Struct({
  label: text(80),
  href: text(2_000),
  handle: Schema.optional(text(120)),
})

export const WorkStorySchema = Schema.Struct({
  id: text(80),
  title: text(120),
  role: text(160),
  period: text(80),
  opening: text(4_000),
  detail: text(2_000),
  links: Schema.mutable(Schema.Array(LinkSchema).pipe(Schema.maxItems(8))),
})

export const PublicSiteContentSchema = Schema.Struct({
  version: Schema.Literal(1),
  seo: Schema.Struct({
    title: text(200),
    description: text(500),
    ogAlt: text(200),
  }),
  identity: Schema.Struct({
    name: text(100),
    siteLabel: text(80),
    email: text(200),
    role: text(160),
    summary: text(1_200),
    location: text(120),
    socials: Schema.mutable(Schema.Array(LinkSchema).pipe(Schema.maxItems(12))),
  }),
  navigation: Schema.mutable(
    Schema.Array(Schema.Struct({ href: text(120), label: text(80), shortLabel: text(20) })).pipe(
      Schema.maxItems(12)
    )
  ),
  work: Schema.Struct({
    stories: Schema.mutable(Schema.Array(WorkStorySchema).pipe(Schema.maxItems(20))),
  }),
  process: Schema.Struct({
    heading: text(120),
    introduction: text(2_000),
    points: Schema.mutable(
      Schema.Array(Schema.Struct({ heading: text(120), body: text(1_000) })).pipe(
        Schema.maxItems(12)
      )
    ),
    harnessCode: text(8_000),
    harnessCaption: text(500),
    harnessUrl: optionalUrl,
    diagramCaption: text(500),
  }),
  about: Schema.Struct({
    heading: text(120),
    paragraphs: Schema.mutable(
      Schema.Array(text(4_000)).pipe(Schema.minItems(1), Schema.maxItems(12))
    ),
  }),
  contact: Schema.Struct({
    heading: text(120),
    introduction: text(500),
  }),
  footer: Schema.Struct({ note: text(160), backToTopLabel: text(80) }),
  resume: ResumeContentSchema,
})

export type PublicSiteContent = Omit<typeof PublicSiteContentSchema.Type, 'resume'> & {
  resume: ResumeContent
}

export const PublishedSnapshotSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  revision: Schema.Number.pipe(Schema.int(), Schema.positive()),
  publishedAt: text(80),
  publishedBy: text(200),
  content: PublicSiteContentSchema,
})

export type PublishedSnapshot = Omit<typeof PublishedSnapshotSchema.Type, 'content'> & {
  content: PublicSiteContent
}

export const validatePublicSiteContent = (value: unknown) => {
  const decoded = Schema.decodeUnknownEither(PublicSiteContentSchema)(value)
  return Either.isRight(decoded)
    ? { data: decoded.right as PublicSiteContent, errors: [] }
    : { errors: formatSchemaErrors(decoded.left) }
}

export const validatePublishedSnapshot = (value: unknown) => {
  const decoded = Schema.decodeUnknownEither(PublishedSnapshotSchema)(value)
  return Either.isRight(decoded)
    ? { data: decoded.right as PublishedSnapshot, errors: [] }
    : { errors: formatSchemaErrors(decoded.left) }
}
