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
}
export interface RequirementHierarchy {
  concepts: (RequirementConcept & { count: number; capabilityIds: string[] })[];
  capabilities: (RequirementCapability & {
    count: number;
    families: string[];
    aliases: string[];
    listingIds: string[];
  })[];
  totalRequirements: number;
  mappedRequirements: number;
  unmappedRequirements: number;
  listingCount: number;
}
