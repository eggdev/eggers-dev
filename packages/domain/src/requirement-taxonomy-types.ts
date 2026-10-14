export const roleTrackIds = [
  'software',
  'frontend',
  'full_stack',
  'platform',
  'forward_deployed',
  'product',
  'technical_product',
  'other',
] as const;
export type RoleTrack = (typeof roleTrackIds)[number];
export const roleTrackLabels: Record<RoleTrack, string> = {
  software: 'Software engineering',
  frontend: 'Frontend',
  full_stack: 'Full stack',
  platform: 'Platform & infrastructure',
  forward_deployed: 'Forward deployed',
  product: 'Product management',
  technical_product: 'Technical product management',
  other: 'Other',
};
export const roleLevelIds = ['', 'early', 'mid', 'senior', 'staff', 'principal'] as const;
export type RoleLevel = (typeof roleLevelIds)[number];
export const roleLevelLabels: Record<RoleLevel, string> = {
  '': 'Unspecified',
  early: 'Early career',
  mid: 'Mid-level',
  senior: 'Senior',
  staff: 'Staff',
  principal: 'Principal',
};
export interface RequirementConcept {
  id: string;
  label: string;
  description: string;
  revision: number;
}
export interface RequirementCapability {
  id: string;
  label: string;
  kind: string;
  description: string;
  experience_guide: string;
  prompts: string[];
  distinctions: string;
  revision: number;
  conceptIds: string[];
}
export interface RequirementEvidence {
  listingId: string;
  requirementKey: string;
  label: string;
  kind: string;
  section: string;
  quote: string;
  title: string;
  company: string;
  url: string;
  family: string;
  track: RoleTrack;
  level: RoleLevel;
}
export interface RequirementHierarchy {
  concepts: (RequirementConcept & { count: number; capabilityIds: string[] })[];
  capabilities: (RequirementCapability & {
    count: number;
    families: string[];
    aliases: string[];
    listingIds: string[];
    entryIds: string[];
  })[];
  listings: { id: string; title: string; company: string; track: RoleTrack; level: RoleLevel }[];
  totalRequirements: number;
  mappedRequirements: number;
  unmappedRequirements: number;
  listingCount: number;
}
