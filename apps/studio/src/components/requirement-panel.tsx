'use client';
import type { RequirementHierarchy, RoleTrack } from '@repo/domain/requirement-taxonomy-types';
import { roleTrackLabels } from '@repo/domain/requirement-taxonomy-types';
import type { Entry, EntryInput } from '@repo/domain/types';
import { Badge, Button, Select } from '@repo/ui';
import { coverageColor, graphPalettes, useDarkMode } from '@studio/components/requirement-graph';
import {
  type Capability,
  demand,
  type MapFilter,
  matchingListings,
  nodeKey,
  parseNodeKey,
  trackBreakdown,
  unexplored,
} from '@studio/components/requirement-graph-model';
import { MessagesSquare, X } from 'lucide-react';

type Props = {
  map: RequirementHierarchy;
  entries: Entry[];
  filter: MapFilter;
  selected?: string;
  busy: boolean;
  select: (key?: string) => void;
  setFilter: (filter: MapFilter) => void;
  openCapability: (id: string) => void;
  editConcept: (id: string) => void;
  linkStory: (entry: Entry, capabilityIds: string[]) => void;
  explore?: (capability: Capability) => void;
};
export const entryInput = (entry: Entry, capabilityIds: string[]): EntryInput => ({
  id: entry.id,
  roleId: entry.role_id,
  title: entry.title,
  markdown: entry.markdown,
  skills: entry.skills,
  sourceMessageIds: entry.source_message_ids ?? [],
  capabilityIds,
  expectedRevision: entry.revision,
});
const stories = (n: number) => (n === 0 ? 'Unexplored' : n === 1 ? '1 story' : `${n} stories`);

export function RequirementPanel(props: Props) {
  const { map, selected, select } = props;
  const node = selected ? parseNodeKey(selected) : undefined;
  return (
    <aside
      aria-label="Map details"
      className="flex min-h-0 flex-col overflow-y-auto border-t p-5 lg:border-t-0 lg:border-l"
    >
      {node && (
        <Button
          size="sm"
          variant="ghost"
          className="mb-2 self-start"
          onClick={() => select(undefined)}
        >
          <X />
          Clear selection
        </Button>
      )}
      {node?.kind === 'concept' && <ConceptDetail {...props} id={node.id} />}
      {node?.kind === 'capability' && <CapabilityDetail {...props} id={node.id} />}
      {node?.kind === 'entry' && <StoryDetail {...props} id={node.id} />}
      {node?.kind === 'track' && <TrackDetail {...props} id={node.id as RoleTrack} />}
      {!node && <Overview {...props} />}
      {!!map.capabilities.length && <Legend />}
    </aside>
  );
}

function CapabilityRow({
  capability,
  count,
  select,
}: {
  capability: Capability;
  count: number;
  select: (key: string) => void;
}) {
  const dark = useDarkMode();
  const palette = dark ? graphPalettes.dark : graphPalettes.light;
  return (
    <li>
      <button
        type="button"
        onClick={() => select(nodeKey('capability', capability.id))}
        className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span
          aria-hidden
          className="size-2.5 shrink-0 rounded-full"
          style={{ background: coverageColor(palette, capability.entryIds.length) }}
        />
        <span className="min-w-0 flex-1 truncate">{capability.label}</span>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {count} · {stories(capability.entryIds.length)}
        </span>
      </button>
    </li>
  );
}

function Overview({ map, filter, select }: Props) {
  const listings = matchingListings(map, filter);
  const requested = map.capabilities.filter((c) => demand(c, listings) > 0);
  const explored = requested.filter((c) => c.entryIds.length > 0).length;
  const gaps = unexplored(map, filter);
  return (
    <div className="space-y-5">
      <div>
        <h3 className="font-semibold">
          {filter.track ? roleTrackLabels[filter.track] : 'All roles'}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {listings.size} listings · {explored} of {requested.length} requested capabilities have a
          linked story
        </p>
      </div>
      {gaps.length > 0 && (
        <section aria-label="Most requested, still unexplored" className="space-y-2">
          <h4 className="text-sm font-medium">Most requested, still unexplored</h4>
          <p className="text-xs leading-5 text-muted-foreground">
            Unexplored is not unskilled. Each capability is a prompt for the next conversation.
          </p>
          <ul className="-mx-2">
            {gaps.map(({ capability, count }) => (
              <CapabilityRow
                key={capability.id}
                capability={capability}
                count={count}
                select={select}
              />
            ))}
          </ul>
        </section>
      )}
      {!gaps.length && !!requested.length && (
        <p className="text-sm text-muted-foreground">
          Every requested capability in this view has at least one linked story.
        </p>
      )}
    </div>
  );
}

function ConceptDetail({ map, filter, id, select, editConcept }: Props & { id: string }) {
  const concept = map.concepts.find((c) => c.id === id);
  if (!concept) return <p className="text-sm text-muted-foreground">This concept was removed.</p>;
  const listings = matchingListings(map, filter);
  const children = map.capabilities
    .filter((c) => concept.capabilityIds.includes(c.id))
    .map((capability) => ({ capability, count: demand(capability, listings) }))
    .sort((a, b) => b.count - a.count || a.capability.label.localeCompare(b.capability.label));
  const explored = children.filter((c) => c.capability.entryIds.length).length;
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-medium text-muted-foreground">Concept</p>
        <h3 className="mt-1 font-semibold">{concept.label}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {concept.count} listings · {explored} of {children.length} capabilities have a linked
          story
        </p>
      </div>
      {concept.description && <p className="text-sm leading-6">{concept.description}</p>}
      <Button size="sm" variant="outline" onClick={() => editConcept(concept.id)}>
        Edit concept
      </Button>
      <ul className="-mx-2">
        {children.map(({ capability, count }) => (
          <CapabilityRow
            key={capability.id}
            capability={capability}
            count={count}
            select={select}
          />
        ))}
      </ul>
    </div>
  );
}

function CapabilityDetail(props: Props & { id: string }) {
  const { map, entries, id, select, busy, openCapability, linkStory, explore } = props;
  const capability = map.capabilities.find((c) => c.id === id);
  if (!capability)
    return <p className="text-sm text-muted-foreground">This capability was removed.</p>;
  const linked = entries.filter((e) => capability.entryIds.includes(e.id));
  const available = entries.filter((e) => !capability.entryIds.includes(e.id));
  const tracks = trackBreakdown(map, capability);
  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-medium text-muted-foreground">Capability · {capability.kind}</p>
        <h3 className="mt-1 font-semibold">{capability.label}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {capability.count} listings · {stories(linked.length)}
        </p>
      </div>
      <p className="text-sm leading-6">{capability.description}</p>
      <div className="flex flex-wrap gap-1.5">
        {map.concepts
          .filter((c) => capability.conceptIds.includes(c.id))
          .map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => select(nodeKey('concept', c.id))}
              className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Badge className="hover:bg-accent">{c.label}</Badge>
            </button>
          ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => openCapability(capability.id)}>
          Guide & evidence
        </Button>
        {explore && (
          <Button size="sm" onClick={() => explore(capability)}>
            <MessagesSquare />
            Explore with Eve
          </Button>
        )}
      </div>
      {tracks.length > 0 && (
        <section aria-label="Requested by role" className="space-y-2">
          <h4 className="text-sm font-medium">Requested by role</h4>
          <ul className="space-y-2">
            {tracks.map((t) => (
              <li key={t.track} className="text-xs">
                <div className="flex justify-between gap-2">
                  <span>{t.label}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {t.count} of {t.total} listings
                  </span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-foreground/70"
                    style={{ width: `${(100 * t.count) / t.total}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section aria-label="Linked stories" className="space-y-2">
        <h4 className="text-sm font-medium">Linked stories</h4>
        {!linked.length && (
          <p className="text-xs leading-5 text-muted-foreground">
            No stories link here yet. Link one you already told, or explore it with Eve.
          </p>
        )}
        <ul className="space-y-1">
          {linked.map((entry) => (
            <li key={entry.id} className="flex items-center justify-between gap-2 text-sm">
              <button
                type="button"
                className="min-w-0 truncate text-left underline-offset-4 hover:underline"
                onClick={() => select(nodeKey('entry', entry.id))}
              >
                {entry.title}
              </button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                aria-label={`Unlink ${entry.title}`}
                onClick={() =>
                  linkStory(
                    entry,
                    entry.capability_ids.filter((c) => c !== capability.id),
                  )
                }
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
        {available.length > 0 && (
          <Select
            aria-label="Link a story"
            value=""
            disabled={busy}
            onChange={(e) => {
              const entry = available.find((x) => x.id === e.target.value);
              if (entry) linkStory(entry, [...entry.capability_ids, capability.id]);
            }}
          >
            <option value="">Link a story…</option>
            {available.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
              </option>
            ))}
          </Select>
        )}
      </section>
    </div>
  );
}

function StoryDetail({ map, entries, id, select, busy, linkStory }: Props & { id: string }) {
  const entry = entries.find((e) => e.id === id);
  if (!entry) return <p className="text-sm text-muted-foreground">This story was removed.</p>;
  const linked = map.capabilities.filter((c) => entry.capability_ids.includes(c.id));
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-medium text-muted-foreground">Story</p>
        <h3 className="mt-1 font-semibold">{entry.title}</h3>
      </div>
      <p className="line-clamp-6 text-sm leading-6 text-muted-foreground">
        {entry.markdown.replace(/[#*_`>]/g, '')}
      </p>
      <section aria-label="Demonstrates" className="space-y-2">
        <h4 className="text-sm font-medium">Linked capabilities</h4>
        {!linked.length && (
          <p className="text-xs text-muted-foreground">
            No capabilities yet. Link them from a capability or the knowledge bank.
          </p>
        )}
        <ul className="space-y-1">
          {linked.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
              <button
                type="button"
                className="min-w-0 truncate text-left underline-offset-4 hover:underline"
                onClick={() => select(nodeKey('capability', c.id))}
              >
                {c.label}
              </button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                aria-label={`Unlink ${c.label}`}
                onClick={() =>
                  linkStory(
                    entry,
                    entry.capability_ids.filter((x) => x !== c.id),
                  )
                }
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function TrackDetail({ map, filter, setFilter, select, id }: Props & { id: RoleTrack }) {
  const scoped = { track: id, level: filter.level };
  const listings = matchingListings(map, scoped);
  const top = map.capabilities
    .map((capability) => ({ capability, count: demand(capability, listings) }))
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count || a.capability.label.localeCompare(b.capability.label));
  const explored = top.filter((c) => c.capability.entryIds.length).length;
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-medium text-muted-foreground">Role track</p>
        <h3 className="mt-1 font-semibold">{roleTrackLabels[id]}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {listings.size} listings · {explored} of {top.length} requested capabilities have a linked
          story
        </p>
      </div>
      {filter.track !== id && (
        <Button size="sm" variant="outline" onClick={() => setFilter(scoped)}>
          Focus the map on this role
        </Button>
      )}
      <h4 className="text-sm font-medium">Most requested</h4>
      <ul className="-mx-2">
        {top.slice(0, 15).map(({ capability, count }) => (
          <CapabilityRow
            key={capability.id}
            capability={capability}
            count={count}
            select={select}
          />
        ))}
      </ul>
    </div>
  );
}

function Legend() {
  const dark = useDarkMode();
  const p = dark ? graphPalettes.dark : graphPalettes.light;
  const items = [
    [p.ink, 'Concept'],
    [p.unexplored, 'Capability, unexplored'],
    [p.one, 'Capability, 1 story'],
    [p.many, 'Capability, 2+ stories'],
    [p.story, 'Story'],
    [p.track, 'Role track'],
  ];
  return (
    <section aria-label="Legend" className="mt-auto space-y-2 border-t pt-4">
      <h4 className="text-xs font-medium text-muted-foreground">Legend</h4>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        {items.map(([color, label]) => (
          <li key={label} className="flex items-center gap-2">
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-full"
              style={{ background: color }}
            />
            {label}
          </li>
        ))}
      </ul>
      <p className="text-xs leading-5 text-muted-foreground">
        Size shows how many listings in the current view ask for a capability.
      </p>
    </section>
  );
}
