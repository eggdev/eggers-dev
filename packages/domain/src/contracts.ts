import { roleLevelIds, roleTrackIds } from '@repo/domain/requirement-taxonomy-types';
import { Schema } from 'effect';

export const Track = Schema.Literals(roleTrackIds);
export const Level = Schema.Literals(roleLevelIds);
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
  capabilityIds: Schema.optional(Schema.Array(Schema.String).check(Schema.isMaxLength(40))),
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
  track: Track,
  seniority: Schema.String,
  level: Level,
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
export const ClassifyInput = Schema.Struct({
  id: label,
  track: Track,
  level: Level,
});
