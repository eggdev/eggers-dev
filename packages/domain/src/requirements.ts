import type { Listing } from '@repo/domain/types';
export function requirementMap(listings: Listing[]) {
  const map = new Map<
    string,
    { label: string; kind: string; count: number; families: string[]; listingIds: string[] }
  >();
  for (const listing of listings.filter((l) => l.status === 'ready' && !l.duplicate_of)) {
    const seen = new Set<string>();
    for (const requirement of listing.requirements) {
      const key = requirement.label.toLowerCase().trim();
      if (seen.has(key)) continue;
      seen.add(key);
      const row = map.get(key) ?? {
        label: requirement.label,
        kind: requirement.kind,
        count: 0,
        families: [],
        listingIds: [],
      };
      row.count++;
      row.listingIds.push(listing.id);
      if (listing.family && !row.families.includes(listing.family))
        row.families.push(listing.family);
      map.set(key, row);
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
