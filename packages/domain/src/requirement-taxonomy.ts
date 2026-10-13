import { createHash } from 'node:crypto';
import type { Database } from '@repo/database';
import { DomainError } from '@repo/domain/errors';
import type {
  RequirementCapability,
  RequirementConcept,
  RequirementEvidence,
  RequirementHierarchy,
} from '@repo/domain/requirement-taxonomy-types';
import type { Listing, Requirement } from '@repo/domain/types';
import { Schema } from 'effect';

const label = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500));
const identifier = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,99}$/));
const prose = Schema.String.check(Schema.isMaxLength(20000));
const ConceptInput = Schema.Struct({
  id: identifier,
  label,
  description: prose,
  expectedRevision: Schema.optional(Schema.Number),
});
const CapabilityInput = Schema.Struct({
  id: identifier,
  label,
  kind: Schema.Literals([
    'technical',
    'collaboration',
    'leadership',
    'product',
    'delivery',
    'other',
  ]),
  description: prose,
  experienceGuide: prose,
  prompts: Schema.Array(label).check(Schema.isMaxLength(12)),
  distinctions: prose,
  conceptIds: Schema.Array(identifier).check(Schema.isMinLength(1), Schema.isMaxLength(10)),
  expectedRevision: Schema.optional(Schema.Number),
});
const LinkInput = Schema.Struct({
  mappings: Schema.Array(
    Schema.Struct({
      listingId: label,
      requirementKey: label,
      capabilityIds: Schema.Array(identifier).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
    }),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(100)),
});
function decode<T>(schema: Schema.Codec<T, any>, raw: unknown): T {
  try {
    return Schema.decodeUnknownSync(schema)(raw);
  } catch {
    throw new DomainError('Some requirement-map fields are missing or invalid.');
  }
}
export const requirementKey = (requirement: Requirement) =>
  createHash('sha256')
    .update(
      JSON.stringify([requirement.label, requirement.kind, requirement.section, requirement.quote]),
    )
    .digest('hex');
const evidenceKey = (listingId: string, key: string) => `${listingId}:${key}`;
type Link = { listing_id: string; requirement_key: string; capability_id: string };
export async function readTaxonomy(db: Database, suppliedListings?: Listing[]) {
  const [concepts, capabilities, memberships, links, listings] = await Promise.all([
    db.query<RequirementConcept>('SELECT * FROM requirement_concepts ORDER BY label'),
    db.query<Omit<RequirementCapability, 'conceptIds'>>(
      'SELECT * FROM requirement_capabilities ORDER BY label',
    ),
    db.query<{ concept_id: string; capability_id: string }>(
      'SELECT * FROM requirement_capability_concepts',
    ),
    db.query<Link>('SELECT * FROM requirement_links'),
    suppliedListings
      ? Promise.resolve(suppliedListings)
      : db.query<Listing>(
          "SELECT id,url,title,company,family,status,duplicate_of,requirements FROM listings WHERE status='ready' AND duplicate_of IS NULL",
        ),
  ]);
  const sources = new Map<string, RequirementEvidence>();
  const eligible = listings.filter((l) => l.status === 'ready' && !l.duplicate_of);
  for (const listing of eligible)
    for (const req of listing.requirements) {
      const key = requirementKey(req);
      sources.set(evidenceKey(listing.id, key), {
        ...req,
        listingId: listing.id,
        requirementKey: key,
        title: listing.title,
        company: listing.company,
        url: listing.url,
        family: listing.family,
      });
    }
  const validLinks = links.filter((l) => sources.has(evidenceKey(l.listing_id, l.requirement_key)));
  const mapped = new Set(validLinks.map((l) => evidenceKey(l.listing_id, l.requirement_key)));
  const caps = capabilities
    .map((cap) => {
      const evidence = validLinks
        .filter((l) => l.capability_id === cap.id)
        .map(
          (l) => sources.get(evidenceKey(l.listing_id, l.requirement_key)) as RequirementEvidence,
        );
      const listingIds = [...new Set(evidence.map((e) => e.listingId))];
      return {
        ...cap,
        conceptIds: memberships.filter((m) => m.capability_id === cap.id).map((m) => m.concept_id),
        count: listingIds.length,
        listingIds,
        families: [...new Set(evidence.map((e) => e.family).filter(Boolean))],
        aliases: [...new Set(evidence.map((e) => e.label))],
      };
    })
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const hierarchy: RequirementHierarchy = {
    concepts: concepts
      .map((concept) => {
        const children = caps.filter((c) => c.conceptIds.includes(concept.id));
        return {
          ...concept,
          capabilityIds: children.map((c) => c.id),
          count: new Set(children.flatMap((c) => c.listingIds)).size,
        };
      })
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    capabilities: caps,
    totalRequirements: sources.size,
    mappedRequirements: mapped.size,
    unmappedRequirements: sources.size - mapped.size,
    listingCount: eligible.length,
  };
  return { hierarchy, sources, links: validLinks, mapped };
}
export function requirementTaxonomy(db: Database) {
  return async (action: string, raw: any): Promise<any> => {
    if (action === 'map.concept.save') {
      const input = decode(ConceptInput, raw);
      const rows = await db.query(
        `INSERT INTO requirement_concepts(id,label,description) VALUES($1,$2,$3)
        ON CONFLICT(id) DO UPDATE SET label=$2,description=$3,revision=requirement_concepts.revision+1
        WHERE requirement_concepts.revision=$4 RETURNING *`,
        [input.id, input.label, input.description, input.expectedRevision ?? null],
      );
      if (!rows.length)
        throw new DomainError('This concept changed. Reload it before saving.', 409);
      return rows[0];
    }
    if (action === 'map.capability.save') {
      const input = decode(CapabilityInput, raw);
      const concepts = await db.query('SELECT id FROM requirement_concepts');
      if (input.conceptIds.some((id) => !concepts.some((c) => c.id === id)))
        throw new DomainError('Choose existing concepts for this capability.');
      const rows = await db.query(
        `WITH saved AS (
        INSERT INTO requirement_capabilities(id,label,kind,description,experience_guide,prompts,distinctions) VALUES($1,$2,$3,$4,$5,$6::text::jsonb,$7)
        ON CONFLICT(id) DO UPDATE SET label=$2,kind=$3,description=$4,experience_guide=$5,prompts=$6::text::jsonb,distinctions=$7,revision=requirement_capabilities.revision+1
        WHERE requirement_capabilities.revision=$8 RETURNING *
      ), removed AS (
        DELETE FROM requirement_capability_concepts WHERE capability_id=$1 AND concept_id NOT IN (SELECT jsonb_array_elements_text($9::text::jsonb)) AND EXISTS(SELECT 1 FROM saved) RETURNING concept_id
      ), added AS (
        INSERT INTO requirement_capability_concepts(capability_id,concept_id) SELECT saved.id, jsonb_array_elements_text($9::text::jsonb) FROM saved ON CONFLICT DO NOTHING RETURNING concept_id
      ) SELECT * FROM saved`,
        [
          input.id,
          input.label,
          input.kind,
          input.description,
          input.experienceGuide,
          JSON.stringify(input.prompts),
          input.distinctions,
          input.expectedRevision ?? null,
          JSON.stringify([...new Set(input.conceptIds)]),
        ],
      );
      if (!rows.length)
        throw new DomainError('This capability changed. Reload it before saving.', 409);
      return rows[0];
    }
    const { hierarchy, sources, links, mapped } = await readTaxonomy(db);
    if (action === 'map.get' || action === 'map.catalog') return hierarchy;
    if (action === 'map.labels') return [...sources.values()].map(({ quote, ...source }) => source);
    if (action === 'map.pending')
      return {
        remaining: hierarchy.unmappedRequirements,
        requirements: [...sources.entries()]
          .filter(([key]) => !mapped.has(key))
          .slice(0, 30)
          .map(([, source]) => source),
      };
    if (action === 'map.capability') {
      const capability = hierarchy.capabilities.find((c) => c.id === raw.id);
      if (!capability) throw new DomainError('Capability not found.', 404);
      return {
        capability,
        evidence: links
          .filter((l) => l.capability_id === raw.id)
          .map((l) => sources.get(evidenceKey(l.listing_id, l.requirement_key))),
      };
    }
    if (action === 'map.link') {
      const input = decode(LinkInput, raw);
      for (const m of input.mappings) {
        if (!sources.has(evidenceKey(m.listingId, m.requirementKey)))
          throw new DomainError(
            'A source requirement changed or is unavailable. Reload the pending requirements.',
            409,
          );
        if (m.capabilityIds.some((id) => !hierarchy.capabilities.some((c) => c.id === id)))
          throw new DomainError('Create capabilities before linking requirements.');
      }
      // Validate every reference before writing, then commit the whole batch together.
      await db.transaction(
        input.mappings.flatMap((m) =>
          [...new Set(m.capabilityIds)].map((capabilityId) => ({
            sql: 'INSERT INTO requirement_links(listing_id,requirement_key,capability_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
            params: [m.listingId, m.requirementKey, capabilityId],
          })),
        ),
      );
      return { linked: input.mappings.length };
    }
    if (action === 'map.unlink') {
      const input = decode(
        Schema.Struct({ listingId: label, requirementKey: label, capabilityId: identifier }),
        raw,
      );
      await db.query(
        'DELETE FROM requirement_links WHERE listing_id=$1 AND requirement_key=$2 AND capability_id=$3',
        [input.listingId, input.requirementKey, input.capabilityId],
      );
      return { ok: true };
    }
    if (action === 'map.capability.delete') {
      const input = decode(Schema.Struct({ id: identifier }), raw);
      await db.query('DELETE FROM requirement_capabilities WHERE id=$1', [input.id]);
      return { ok: true };
    }
    throw new DomainError('Unknown requirement-map operation.', 404);
  };
}
