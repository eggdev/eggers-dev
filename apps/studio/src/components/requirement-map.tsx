'use client';
import type {
  RequirementCapability,
  RequirementConcept,
  RequirementEvidence,
  RequirementHierarchy,
} from '@repo/domain/requirement-taxonomy-types';
import { Badge, Button, Dialog, Input, Select, Textarea } from '@repo/ui';
import { MarkdownEditor } from '@repo/ui/editor';
import { api } from '@studio/components/api';
import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type Act = (action: string, input?: unknown) => Promise<any>;
type Detail = { capability: RequirementCapability; evidence: RequirementEvidence[] };
export function RequirementMap({
  map,
  act,
  organize,
  canOrganize,
}: {
  map: RequirementHierarchy;
  act: Act;
  organize: () => Promise<void>;
  canOrganize: boolean;
}) {
  const [query, setQuery] = useState('');
  const [detail, setDetail] = useState<Detail>();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<RequirementCapability>();
  const [concept, setConcept] = useState<RequirementConcept>();
  const [unmapped, setUnmapped] = useState<RequirementEvidence[]>();
  const search = query.toLowerCase().trim();
  const visible = map.capabilities.filter((c) =>
    `${c.label} ${c.description} ${c.aliases.join(' ')} ${c.families.join(' ')}`
      .toLowerCase()
      .includes(search),
  );
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
  return (
    <section aria-label="Requirement map" className="space-y-5 rounded-lg border p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold">Requirement map</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {map.concepts.length} concepts · {map.capabilities.length} capabilities ·{' '}
            {map.listingCount} unique listings
          </p>
        </div>
        <Button
          variant="outline"
          disabled={!canOrganize || !map.totalRequirements}
          onClick={() => void organize().catch(() => {})}
        >
          Organize with Eve
        </Button>
      </div>
      <p className="text-sm leading-6 text-muted-foreground">
        Explore related capabilities, the experience that could demonstrate them, and the original
        job requirements. Counts are distinct listings; overlapping capabilities do not add up.
      </p>
      <p className="text-xs text-muted-foreground">
        Experience guides are conversation prompts, not assessments of your experience or promises
        about an employer’s expectations.
      </p>
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
      <Input
        aria-label="Search requirement concepts and capabilities"
        placeholder="Find a concept, capability, or original phrase…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {!map.capabilities.length && (
        <p className="py-4 text-sm text-muted-foreground">
          The source requirements are ready to organize. Eve will group related meanings while
          keeping the original excerpts.
        </p>
      )}
      <div className="divide-y">
        {map.concepts
          .filter(
            (c) =>
              c.label.toLowerCase().includes(search) ||
              c.capabilityIds.some((id) => visible.some((cap) => cap.id === id)),
          )
          .map((c) => {
            const children = map.capabilities.filter(
              (cap) =>
                c.capabilityIds.includes(cap.id) &&
                (!search ||
                  c.label.toLowerCase().includes(search) ||
                  visible.some((v) => v.id === cap.id)),
            );
            return (
              <details key={c.id} open={search ? true : undefined} className="py-4">
                <summary className="cursor-pointer text-sm font-semibold">
                  {c.label}
                  <span className="ml-3 font-normal text-muted-foreground">
                    {c.count} listings · {c.capabilityIds.length} capabilities
                  </span>
                </summary>
                <div className="mt-4 space-y-3 pl-1">
                  <p className="text-sm leading-6 text-muted-foreground">{c.description}</p>
                  <Button size="sm" variant="ghost" onClick={() => setConcept(c)}>
                    Edit concept
                  </Button>
                  {children.map((cap) => (
                    <button
                      key={cap.id}
                      type="button"
                      onClick={() => void open(cap.id)}
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
                              .filter(
                                (other) => other.id !== c.id && cap.conceptIds.includes(other.id),
                              )
                              .map((other) => other.label)
                              .join(', ')}
                          </span>
                        )}
                      </span>
                      <Badge className="shrink-0">{cap.count} listings</Badge>
                    </button>
                  ))}
                </div>
              </details>
            );
          })}
      </div>
      {!!search &&
        !map.concepts.some(
          (c) =>
            c.label.toLowerCase().includes(search) ||
            c.capabilityIds.some((id) => visible.some((v) => v.id === id)),
        ) && <p className="text-sm text-muted-foreground">No matching concepts or capabilities.</p>}
      {map.unmappedRequirements > 0 && (
        <div className="space-y-2 border-t pt-4">
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
