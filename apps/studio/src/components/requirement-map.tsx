'use client';
import type {
  RequirementCapability,
  RequirementConcept,
  RequirementEvidence,
  RequirementHierarchy,
} from '@repo/domain/requirement-taxonomy-types';
import {
  roleLevelIds,
  roleLevelLabels,
  roleTrackIds,
  roleTrackLabels,
} from '@repo/domain/requirement-taxonomy-types';
import type { Entry } from '@repo/domain/types';
import { Badge, Button, cn, Dialog, Input, Select, Textarea } from '@repo/ui';
import { MarkdownEditor } from '@repo/ui/editor';
import { api } from '@studio/components/api';
import type { GraphController } from '@studio/components/requirement-graph';
import {
  buildGraph,
  type Capability,
  demand,
  graphInput,
  type MapFilter,
  matchingListings,
  nodeKey,
} from '@studio/components/requirement-graph-model';
import { entryInput, RequirementPanel } from '@studio/components/requirement-panel';
import { List, Network } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useMemo, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type Act = (action: string, input?: unknown) => Promise<any>;
type Detail = { capability: RequirementCapability; evidence: RequirementEvidence[] };
type View = 'graph' | 'list';
const RequirementGraph = dynamic(
  () => import('@studio/components/requirement-graph').then((m) => m.RequirementGraph),
  {
    ssr: false,
    loading: () => <p className="p-6 text-sm text-muted-foreground">Drawing the map…</p>,
  },
);
export function RequirementMap({
  map,
  entries,
  act,
  organize,
  explore,
  canOrganize,
}: {
  map: RequirementHierarchy;
  entries: Entry[];
  act: Act;
  organize: () => Promise<void>;
  explore?: (capability: Capability) => void;
  canOrganize: boolean;
}) {
  const [query, setQuery] = useState('');
  const [view, setView] = useState<View>('graph');
  const [filter, setFilter] = useState<MapFilter>({ track: '', level: 'any' });
  const [layers, setLayers] = useState({ tracks: true, stories: true });
  const [selected, setSelected] = useState<string>();
  const controller = useRef<GraphController>(undefined);
  const [detail, setDetail] = useState<Detail>();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<RequirementCapability>();
  const [concept, setConcept] = useState<RequirementConcept>();
  const [unmapped, setUnmapped] = useState<RequirementEvidence[]>();
  // Layout depends only on structure; refreshed counts must not re-run it or reset the camera.
  const structure = useMemo(() => JSON.stringify(graphInput(map, entries)), [map, entries]);
  const graph = useMemo(() => buildGraph(JSON.parse(structure)), [structure]);
  const search = query.toLowerCase().trim();
  const visible = map.capabilities.filter((c) =>
    `${c.label} ${c.description} ${c.aliases.join(' ')} ${c.families.join(' ')}`
      .toLowerCase()
      .includes(search),
  );
  const rank = (label: string) =>
    label.toLowerCase().startsWith(search) ? 0 : label.toLowerCase().includes(search) ? 1 : 2;
  const matches = search
    ? [
        ...map.concepts
          .filter((c) => c.label.toLowerCase().includes(search))
          .map((c) => ({ key: nodeKey('concept', c.id), label: c.label, kind: 'Concept' })),
        ...visible.map((c) => ({
          key: nodeKey('capability', c.id),
          label: c.label,
          kind: 'Capability',
        })),
        ...entries
          .filter((e) => `${e.title} ${e.markdown}`.toLowerCase().includes(search))
          .map((e) => ({ key: nodeKey('entry', e.id), label: e.title, kind: 'Story' })),
      ]
        .sort((a, b) => rank(a.label) - rank(b.label))
        .slice(0, 8)
    : [];
  const select = (key?: string) => {
    setSelected(key);
    if (key) controller.current?.focus(key);
  };
  const open = async (id: string) => {
    setError('');
    setOpening(true);
    try {
      setDetail(await api('map.capability', { id }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOpening(false);
    }
  };
  const mutate = async (action: string, input: unknown) => {
    setBusy(true);
    setError('');
    try {
      return await act(action, input);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      setBusy(false);
    }
  };
  const trackCounts = new Map<string, number>();
  for (const l of map.listings) trackCounts.set(l.track, (trackCounts.get(l.track) ?? 0) + 1);
  return (
    <section aria-label="Requirement map" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {map.concepts.length} concepts · {map.capabilities.length} capabilities ·{' '}
          {map.listingCount} unique listings ·{' '}
          {map.capabilities.filter((c) => c.entryIds.length).length} capabilities with stories
        </p>
        <div className="flex flex-wrap gap-2">
          <fieldset className="flex rounded-md border p-0.5">
            <legend className="sr-only">View</legend>
            {(['graph', 'list'] as const).map((v) => (
              <Button
                key={v}
                size="sm"
                variant="ghost"
                aria-pressed={view === v}
                className={cn('h-7', view === v && 'bg-accent')}
                onClick={() => setView(v)}
              >
                {v === 'graph' ? <Network /> : <List />}
                {v === 'graph' ? 'Graph' : 'List'}
              </Button>
            ))}
          </fieldset>
          <Button
            size="sm"
            variant="outline"
            disabled={!canOrganize || !map.totalRequirements}
            onClick={() => void organize().catch(() => {})}
          >
            Organize with Eve
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {opening && (
        <p role="status" className="text-sm text-muted-foreground">
          Opening capability…
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="relative min-w-60 flex-1">
          <Input
            aria-label="Search requirement concepts and capabilities"
            placeholder="Find a concept, capability, story, or original phrase…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && view === 'graph' && matches[0]) {
                select(matches[0].key);
                setQuery('');
              }
            }}
          />
          {view === 'graph' && matches.length > 0 && (
            <ul
              aria-label="Search results"
              className="absolute top-full right-0 left-0 z-20 mt-1 rounded-md border bg-popover p-1 shadow-md"
            >
              {matches.map((m) => (
                <li key={m.key}>
                  <button
                    type="button"
                    className="flex w-full justify-between gap-3 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => {
                      select(m.key);
                      setQuery('');
                    }}
                  >
                    <span className="truncate">{m.label}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{m.kind}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Select
          aria-label="Role track"
          className="w-auto"
          value={filter.track}
          onChange={(e) => setFilter({ ...filter, track: e.target.value as MapFilter['track'] })}
        >
          <option value="">All roles ({map.listings.length})</option>
          {roleTrackIds
            .filter((t) => trackCounts.has(t))
            .map((t) => (
              <option key={t} value={t}>
                {roleTrackLabels[t]} ({trackCounts.get(t)})
              </option>
            ))}
        </Select>
        <Select
          aria-label="Level"
          className="w-auto"
          value={filter.level}
          onChange={(e) => setFilter({ ...filter, level: e.target.value as MapFilter['level'] })}
        >
          <option value="any">Any level</option>
          {roleLevelIds.map((l) => (
            <option key={l} value={l}>
              {roleLevelLabels[l]}
            </option>
          ))}
        </Select>
        {view === 'graph' && (
          <>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={layers.tracks}
                onChange={(e) => setLayers({ ...layers, tracks: e.target.checked })}
              />
              Role tracks
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={layers.stories}
                onChange={(e) => setLayers({ ...layers, stories: e.target.checked })}
              />
              Stories
            </label>
          </>
        )}
      </div>
      {!map.capabilities.length && (
        <p className="py-4 text-sm text-muted-foreground">
          The source requirements are ready to organize. Eve will group related meanings while
          keeping the original excerpts.
        </p>
      )}
      {view === 'graph' && map.capabilities.length > 0 && (
        <div className="grid overflow-hidden rounded-lg border lg:h-[min(76vh,820px)] lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="h-[62vh] min-h-[420px] lg:h-full">
            <RequirementGraph
              graph={graph}
              map={map}
              filter={filter}
              layers={layers}
              selected={selected && graph.hasNode(selected) ? selected : undefined}
              controller={controller}
              onSelect={setSelected}
            />
          </div>
          <RequirementPanel
            map={map}
            entries={entries}
            filter={filter}
            selected={selected}
            busy={busy}
            select={select}
            setFilter={setFilter}
            openCapability={(id) => void open(id)}
            editConcept={(id) => setConcept(map.concepts.find((c) => c.id === id))}
            linkStory={(entry, capabilityIds) =>
              void mutate('entries.save', entryInput(entry, capabilityIds)).catch(() => {})
            }
            explore={explore}
          />
        </div>
      )}
      {view === 'list' && (
        <RequirementList
          map={map}
          filter={filter}
          search={search}
          visible={visible}
          open={(id) => void open(id)}
          editConcept={setConcept}
        />
      )}
      <p className="text-xs leading-5 text-muted-foreground">
        Counts are distinct listings, so overlapping capabilities do not add up. Experience guides
        are conversation prompts. They do not assess your experience or promise an employer’s
        expectations.
      </p>
      {map.unmappedRequirements > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <p className="text-sm">
            {map.unmappedRequirements} of {map.totalRequirements} source requirements still need
            associations.
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setError('');
              void api<{ requirements: RequirementEvidence[] }>('map.pending')
                .then((r) => setUnmapped(r.requirements))
                .catch((e) => setError(e.message));
            }}
          >
            Show unmapped requirements
          </Button>
        </div>
      )}
      <Dialog
        title={detail?.capability.label ?? 'Capability'}
        description={detail?.capability.description}
        open={!!detail}
        onOpenChange={(v) => {
          if (!v) setDetail(undefined);
        }}
      >
        {detail && (
          <div className="space-y-6">
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {map.concepts
                .filter((c) => detail.capability.conceptIds.includes(c.id))
                .map((c) => (
                  <Badge key={c.id}>{c.label}</Badge>
                ))}
            </div>
            <section aria-label="Experience guide" className="space-y-3">
              <h3 className="font-semibold">Experience to explore</h3>
              <div className="space-y-3 text-sm leading-6 [&_ul]:list-disc [&_ul]:pl-5 [&_p]:my-2">
                <Markdown remarkPlugins={[remarkGfm]}>
                  {detail.capability.experience_guide}
                </Markdown>
              </div>
              {detail.capability.prompts.length > 0 && (
                <>
                  <h4 className="text-sm font-medium">Questions to prompt recall</h4>
                  <ul className="list-disc space-y-2 pl-5 text-sm leading-6">
                    {detail.capability.prompts.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </>
              )}
              {detail.capability.distinctions && (
                <>
                  <h4 className="text-sm font-medium">Keep these distinctions</h4>
                  <p className="text-sm leading-6 text-muted-foreground">
                    {detail.capability.distinctions}
                  </p>
                </>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditing(detail.capability);
                    setDetail(undefined);
                  }}
                >
                  Edit capability & guide
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void mutate('map.capability.delete', { id: detail.capability.id })
                      .then(() => setDetail(undefined))
                      .catch(() => {})
                  }
                >
                  Delete capability
                </Button>
              </div>
            </section>
            <section aria-label="Original requirement evidence" className="space-y-4">
              <h3 className="font-semibold">
                Original requirements · {new Set(detail.evidence.map((e) => e.listingId)).size}{' '}
                listings
              </h3>
              {detail.evidence.map((e) => (
                <article
                  key={`${e.listingId}:${e.requirementKey}`}
                  className="space-y-2 border-t pt-4"
                >
                  <a
                    className="text-sm font-medium underline"
                    href={e.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {e.company} · {e.title} ↗
                  </a>
                  <p className="text-sm">{e.label}</p>
                  <p className="text-xs text-muted-foreground">{e.section}</p>
                  <blockquote className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                    {e.quote}
                  </blockquote>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      void mutate('map.unlink', {
                        listingId: e.listingId,
                        requirementKey: e.requirementKey,
                        capabilityId: detail.capability.id,
                      })
                        .then(() => open(detail.capability.id))
                        .catch(() => {})
                    }
                  >
                    Remove association
                  </Button>
                </article>
              ))}
            </section>
          </div>
        )}
      </Dialog>
      <Dialog
        title="Edit capability & guide"
        description="Keep equivalent meanings together and preserve useful distinctions. Changes also guide Eve’s interviews."
        open={!!editing}
        onOpenChange={(v) => {
          if (!v) setEditing(undefined);
        }}
      >
        {editing && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void mutate('map.capability.save', {
                id: editing.id,
                expectedRevision: editing.revision,
                label: editing.label,
                kind: editing.kind,
                description: editing.description,
                experienceGuide: editing.experience_guide,
                prompts: editing.prompts.map((p) => p.trim()).filter(Boolean),
                distinctions: editing.distinctions,
                conceptIds: editing.conceptIds,
              })
                .then(() => {
                  setEditing(undefined);
                  return open(editing.id);
                })
                .catch(() => {});
            }}
          >
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="space-y-2">
              <label htmlFor="capability-name" className="text-sm">
                Capability name
              </label>
              <Input
                id="capability-name"
                required
                value={editing.label}
                onChange={(e) => setEditing({ ...editing, label: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="capability-kind" className="text-sm">
                Kind
              </label>
              <Select
                id="capability-kind"
                value={editing.kind}
                onChange={(e) => setEditing({ ...editing, kind: e.target.value })}
              >
                {['technical', 'collaboration', 'leadership', 'product', 'delivery', 'other'].map(
                  (k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ),
                )}
              </Select>
            </div>
            <div className="space-y-2">
              <label htmlFor="capability-definition" className="text-sm">
                Definition
              </label>
              <Textarea
                id="capability-definition"
                value={editing.description}
                onChange={(e) => setEditing({ ...editing, description: e.target.value })}
              />
            </div>
            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm">Broader concepts</legend>
              {map.concepts.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={editing.conceptIds.includes(c.id)}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        conceptIds: e.target.checked
                          ? [...editing.conceptIds, c.id]
                          : editing.conceptIds.filter((id) => id !== c.id),
                      })
                    }
                  />
                  {c.label}
                </label>
              ))}
            </fieldset>
            <div className="space-y-2">
              <p className="text-sm">Experience guide</p>
              <MarkdownEditor
                value={editing.experience_guide}
                onChange={(experience_guide) => setEditing({ ...editing, experience_guide })}
                placeholder="Experience guide"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="capability-prompts" className="text-sm">
                Recall questions · one per line
              </label>
              <Textarea
                id="capability-prompts"
                value={editing.prompts.join('\n')}
                onChange={(e) => setEditing({ ...editing, prompts: e.target.value.split('\n') })}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="capability-distinctions" className="text-sm">
                Distinctions
              </label>
              <Textarea
                id="capability-distinctions"
                value={editing.distinctions}
                onChange={(e) => setEditing({ ...editing, distinctions: e.target.value })}
              />
            </div>
            <Button type="submit" disabled={busy || !editing.conceptIds.length}>
              Save capability
            </Button>
          </form>
        )}
      </Dialog>
      <Dialog
        title="Edit concept"
        description="Name the broader theme that connects its capabilities."
        open={!!concept}
        onOpenChange={(v) => {
          if (!v) setConcept(undefined);
        }}
      >
        {concept && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void mutate('map.concept.save', {
                id: concept.id,
                label: concept.label,
                description: concept.description,
                expectedRevision: concept.revision,
              })
                .then(() => setConcept(undefined))
                .catch(() => {});
            }}
          >
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Input
              aria-label="Concept name"
              required
              value={concept.label}
              onChange={(e) => setConcept({ ...concept, label: e.target.value })}
            />
            <Textarea
              aria-label="Concept description"
              value={concept.description}
              onChange={(e) => setConcept({ ...concept, description: e.target.value })}
            />
            <Button disabled={busy}>Save concept</Button>
          </form>
        )}
      </Dialog>
      <Dialog
        title="Unmapped requirements"
        description="These source requirements remain available while their associations are organized. Showing up to 30."
        open={!!unmapped}
        onOpenChange={(v) => {
          if (!v) setUnmapped(undefined);
        }}
      >
        <div className="space-y-4">
          {unmapped?.map((e) => (
            <article key={`${e.listingId}:${e.requirementKey}`} className="space-y-2 border-b pb-4">
              <p className="text-sm font-medium">{e.label}</p>
              <a href={e.url} target="_blank" rel="noreferrer" className="text-xs underline">
                {e.company} · {e.title}
              </a>
              <p className="text-xs text-muted-foreground">{e.section}</p>
              <blockquote className="text-sm leading-6">{e.quote}</blockquote>
            </article>
          ))}
        </div>
      </Dialog>
    </section>
  );
}

function RequirementList({
  map,
  filter,
  search,
  visible,
  open,
  editConcept,
}: {
  map: RequirementHierarchy;
  filter: MapFilter;
  search: string;
  visible: RequirementHierarchy['capabilities'];
  open: (id: string) => void;
  editConcept: (concept: RequirementConcept) => void;
}) {
  const listings = matchingListings(map, filter);
  const concepts = map.concepts.filter(
    (c) =>
      c.label.toLowerCase().includes(search) ||
      c.capabilityIds.some((id) => visible.some((cap) => cap.id === id)),
  );
  return (
    <div className="divide-y rounded-lg border px-5">
      {concepts.map((c) => {
        const children = map.capabilities
          .filter(
            (cap) =>
              c.capabilityIds.includes(cap.id) &&
              (!search ||
                c.label.toLowerCase().includes(search) ||
                visible.some((v) => v.id === cap.id)),
          )
          .map((cap) => ({ cap, count: demand(cap, listings) }))
          .filter(({ count }) => count > 0 || (!filter.track && filter.level === 'any'))
          .sort((a, b) => b.count - a.count || a.cap.label.localeCompare(b.cap.label));
        const listingCount = new Set(
          children.flatMap(({ cap }) => cap.listingIds.filter((id) => listings.has(id))),
        ).size;
        return (
          <details key={c.id} open={search ? true : undefined} className="py-4">
            <summary className="cursor-pointer text-sm font-semibold">
              {c.label}
              <span className="ml-3 font-normal text-muted-foreground">
                {listingCount} listings · {children.length} capabilities
              </span>
            </summary>
            <div className="mt-4 space-y-3 pl-1">
              <p className="text-sm leading-6 text-muted-foreground">{c.description}</p>
              <Button size="sm" variant="ghost" onClick={() => editConcept(c)}>
                Edit concept
              </Button>
              {children.map(({ cap, count }) => (
                <button
                  key={cap.id}
                  type="button"
                  onClick={() => open(cap.id)}
                  className="flex w-full items-start justify-between gap-3 rounded-md border p-3 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{cap.label}</span>
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                      {cap.description}
                    </span>
                    {cap.conceptIds.length > 1 && (
                      <span className="mt-2 block text-xs text-muted-foreground">
                        Also in{' '}
                        {map.concepts
                          .filter((other) => other.id !== c.id && cap.conceptIds.includes(other.id))
                          .map((other) => other.label)
                          .join(', ')}
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <Badge>{count} listings</Badge>
                    <span className="text-xs text-muted-foreground">
                      {cap.entryIds.length
                        ? `${cap.entryIds.length} ${cap.entryIds.length === 1 ? 'story' : 'stories'}`
                        : 'Unexplored'}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </details>
        );
      })}
      {!!search && !concepts.length && (
        <p className="py-4 text-sm text-muted-foreground">No matching concepts or capabilities.</p>
      )}
    </div>
  );
}
