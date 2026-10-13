import { Schema } from 'effect';

const text = Schema.String.check(Schema.isMaxLength(100_000));
const label = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500));
export const RoleInput = Schema.Struct({
  title: label,
  company: Schema.optional(Schema.String),
  dates: Schema.optional(Schema.String),
  context: Schema.optional(text),
});
export const ThreadInput = Schema.Struct({
  title: label,
  roleId: Schema.optional(Schema.NullOr(Schema.String)),
});
export const EntryInputSchema = Schema.Struct({
  id: Schema.optional(Schema.String),
  roleId: Schema.optional(Schema.NullOr(Schema.String)),
  title: label,
  markdown: text,
  skills: Schema.Array(Schema.String),
  sourceMessageIds: Schema.Array(Schema.String),
  expectedRevision: Schema.optional(Schema.Number),
});
export const TopicInput = Schema.Struct({
  id: Schema.optional(Schema.String),
  roleId: Schema.optional(Schema.NullOr(Schema.String)),
  label,
  status: Schema.Literals(['unexplored', 'exploring', 'sufficient', 'revisit']),
  notes: Schema.optional(text),
});
export const SettingsInput = Schema.Struct({
  reviewRequired: Schema.Boolean,
  interviewModel: label,
  extractionModel: label,
});
export const ImportInput = Schema.Struct({
  urls: Schema.Array(Schema.String).check(Schema.isMaxLength(1000)),
  family: Schema.optional(Schema.String),
});
export const ExtractionInput = Schema.Struct({
  title: label,
  company: Schema.String,
  family: Schema.String,
  seniority: Schema.String,
  location: Schema.String,
  arrangement: Schema.String,
  requirements: Schema.Array(
    Schema.Struct({
      label,
      kind: Schema.Literals([
        'technical',
        'collaboration',
        'leadership',
        'product',
        'delivery',
        'other',
      ]),
      section: Schema.String,
      quote: text,
    }),
  ),
});
