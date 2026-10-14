import type {
  RequirementHierarchy,
  RoleLevel,
  RoleTrack,
} from '@repo/domain/requirement-taxonomy-types';
import { roleTrackIds, roleTrackLabels } from '@repo/domain/requirement-taxonomy-types';
import type { Entry } from '@repo/domain/types';
import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';

export type NodeKind = 'concept' | 'capability' | 'entry' | 'track';
export type NodeAttributes = { kind: NodeKind; id: string; label: string; x: number; y: number };
export type EdgeKind = 'membership' | 'story' | 'demand';
export type MapFilter = { track: RoleTrack | ''; level: RoleLevel | 'any' };
export type Capability = RequirementHierarchy['capabilities'][number];
export const nodeKey = (kind: NodeKind, id: string) => `${kind}:${id}`;
export const parseNodeKey = (key: string) => {
  const at = key.indexOf(':');
  return { kind: key.slice(0, at) as NodeKind, id: key.slice(at + 1) };
};

/** Listing IDs that match the current role filter. */
export function matchingListings(map: RequirementHierarchy, filter: MapFilter) {
  return new Set(
    map.listings
      .filter(
        (l) =>
          (!filter.track || l.track === filter.track) &&
          (filter.level === 'any' || l.level === filter.level),
      )
      .map((l) => l.id),
  );
}
/** Distinct listings that ask for a capability within the filtered listings. */
export const demand = (capability: { listingIds: string[] }, listings: Set<string>) =>
  capability.listingIds.reduce((n, id) => n + (listings.has(id) ? 1 : 0), 0);
export function trackBreakdown(map: RequirementHierarchy, capability: Capability) {
  const tracks = new Map(map.listings.map((l) => [l.id, l.track]));
  const counts = new Map<RoleTrack, number>();
  for (const id of capability.listingIds) {
    const track = tracks.get(id);
    if (track) counts.set(track, (counts.get(track) ?? 0) + 1);
  }
  return roleTrackIds
    .filter((t) => counts.has(t))
    .map((t) => ({
      track: t,
      label: roleTrackLabels[t],
      count: counts.get(t) ?? 0,
      total: map.listings.filter((l) => l.track === t).length,
    }))
    .sort((a, b) => b.count / b.total - a.count / a.total);
}
/**
 * Most requested capabilities without a linked story, within the filter. Background and
 * context criteria (kind "other", e.g. location or seniority) are not story prompts.
 */
export function unexplored(map: RequirementHierarchy, filter: MapFilter, limit = 12) {
  const listings = matchingListings(map, filter);
  return map.capabilities
    .filter((c) => !c.entryIds.length && c.kind !== 'other')
    .map((c) => ({ capability: c, count: demand(c, listings) }))
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count || a.capability.label.localeCompare(b.capability.label))
    .slice(0, limit);
}

// Deterministic jitter keeps the layout stable between visits.
function hash(value: string) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10_000) / 10_000;
}
const mean = (points: { x: number; y: number }[]) => ({
  x: points.reduce((s, p) => s + p.x, 0) / points.length,
  y: points.reduce((s, p) => s + p.y, 0) / points.length,
});

/** The structural subset the layout depends on; counts and coverage apply at render time. */
export type GraphInput = {
  concepts: { id: string; label: string }[];
  capabilities: { id: string; label: string; conceptIds: string[]; listingIds: string[] }[];
  listings: { id: string; track: RoleTrack }[];
  entries: { id: string; title: string; capability_ids: string[] }[];
};
export const graphInput = (map: RequirementHierarchy, entries: Entry[]): GraphInput => ({
  concepts: map.concepts.map(({ id, label }) => ({ id, label })),
  capabilities: map.capabilities.map(({ id, label, conceptIds, listingIds }) => ({
    id,
    label,
    conceptIds,
    listingIds,
  })),
  listings: map.listings.map(({ id, track }) => ({ id, track })),
  entries: entries.map(({ id, title, capability_ids }) => ({ id, title, capability_ids })),
});
/**
 * Builds the full graph once: concepts are hubs, capabilities sit between the concepts they
 * belong to, stories settle near what they demonstrate, and role tracks ring the outside.
 * Visibility, size and color are applied later by the renderer for the active filter.
 */
export function buildGraph({ entries, ...map }: GraphInput) {
  const graph = new Graph<NodeAttributes, { kind: EdgeKind; weight: number }>();
  const radius = 100;
  map.concepts.forEach((c, i) => {
    const angle = (2 * Math.PI * i) / Math.max(map.concepts.length, 1);
    graph.addNode(nodeKey('concept', c.id), {
      kind: 'concept',
      id: c.id,
      label: c.label,
      x: radius * Math.cos(angle),
      y: radius * Math.sin(angle),
    });
  });
  for (const cap of map.capabilities) {
    const parents = cap.conceptIds
      .map((id) => nodeKey('concept', id))
      .filter((key) => graph.hasNode(key));
    const center = parents.length
      ? mean(parents.map((key) => graph.getNodeAttributes(key)))
      : { x: 0, y: 0 };
    const key = nodeKey('capability', cap.id);
    graph.addNode(key, {
      kind: 'capability',
      id: cap.id,
      label: cap.label,
      x: center.x + (hash(cap.id) - 0.5) * 40,
      y: center.y + (hash(`${cap.id}y`) - 0.5) * 40,
    });
    for (const parent of parents) graph.addEdge(parent, key, { kind: 'membership', weight: 1 });
  }
  for (const entry of entries) {
    const linked = entry.capability_ids
      .map((id) => nodeKey('capability', id))
      .filter((key) => graph.hasNode(key));
    const center = linked.length
      ? mean(linked.map((key) => graph.getNodeAttributes(key)))
      : { x: 0, y: radius * 1.4 };
    const key = nodeKey('entry', entry.id);
    graph.addNode(key, {
      kind: 'entry',
      id: entry.id,
      label: entry.title,
      x: center.x + (hash(entry.id) - 0.5) * 20,
      y: center.y + (hash(`${entry.id}y`) - 0.5) * 20,
    });
    for (const cap of linked) graph.addEdge(key, cap, { kind: 'story', weight: 1 });
  }
  if (graph.order > 1)
    forceAtlas2.assign(graph, {
      iterations: 300,
      settings: { ...forceAtlas2.inferSettings(graph), gravity: 0.5, scalingRatio: 8 },
    });
  // Role tracks stay out of the force layout; they would otherwise pull everything inward.
  const positions = graph.mapNodes((_, a) => a);
  const center = positions.length ? mean(positions) : { x: 0, y: 0 };
  const outer =
    Math.max(radius, ...positions.map((p) => Math.hypot(p.x - center.x, p.y - center.y))) * 1.15;
  const tracks = roleTrackIds
    .map((track) => {
      const listingIds = new Set(map.listings.filter((l) => l.track === track).map((l) => l.id));
      const caps = map.capabilities
        .map((c) => ({ c, n: demand(c, listingIds) }))
        .filter(({ n }) => n > 0);
      const anchor = caps.length
        ? mean(caps.map(({ c }) => graph.getNodeAttributes(nodeKey('capability', c.id))))
        : center;
      return { track, caps, angle: Math.atan2(anchor.y - center.y, anchor.x - center.x) };
    })
    .filter((t) => t.caps.length)
    .sort((a, b) => a.angle - b.angle);
  tracks.forEach(({ track, caps }, i) => {
    const angle = (2 * Math.PI * i) / tracks.length - Math.PI / 2;
    const key = nodeKey('track', track);
    graph.addNode(key, {
      kind: 'track',
      id: track,
      label: roleTrackLabels[track],
      x: center.x + outer * Math.cos(angle),
      y: center.y + outer * Math.sin(angle),
    });
    for (const { c, n } of caps)
      graph.addEdge(key, nodeKey('capability', c.id), { kind: 'demand', weight: n });
  });
  return graph;
}
