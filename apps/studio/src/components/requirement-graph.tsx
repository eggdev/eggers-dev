'use client';
import type { RequirementHierarchy } from '@repo/domain/requirement-taxonomy-types';
import { Button } from '@repo/ui';
import {
  demand,
  type EdgeKind,
  type MapFilter,
  matchingListings,
  type NodeAttributes,
  parseNodeKey,
} from '@studio/components/requirement-graph-model';
import type Graph from 'graphology';
import { Maximize, Minus, Plus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type Sigma from 'sigma';
import type { Settings } from 'sigma/settings';
import type { EdgeDisplayData, NodeDisplayData } from 'sigma/types';

// Coverage is ordinal (no stories, one, several) on one blue ramp; validated in both modes.
export const graphPalettes = {
  light: {
    ink: '#0a0a0a',
    label: '#262626',
    edge: '#d4d4d4',
    edgeActive: '#737373',
    faded: '#ececec',
    unexplored: '#a3a3a3',
    one: '#86b6ef',
    many: '#1c5cab',
    story: '#eb6834',
    track: '#1baf7a',
    popover: '#ffffff',
    border: '#e5e5e5',
  },
  dark: {
    ink: '#fafafa',
    label: '#e5e5e5',
    edge: '#383838',
    edgeActive: '#a3a3a3',
    faded: '#262626',
    unexplored: '#737373',
    one: '#256abf',
    many: '#86b6ef',
    story: '#d95926',
    track: '#199e70',
    popover: '#171717',
    border: '#2e2e2e',
  },
};
type Palette = (typeof graphPalettes)['light'];
export const coverageColor = (palette: Palette, stories: number) =>
  stories === 0 ? palette.unexplored : stories === 1 ? palette.one : palette.many;
type Layers = { tracks: boolean; stories: boolean };
export type GraphController = { focus: (key: string) => void };
type Props = {
  graph: Graph<NodeAttributes, { kind: EdgeKind; weight: number }>;
  map: RequirementHierarchy;
  filter: MapFilter;
  layers: Layers;
  selected?: string;
  controller: { current?: GraphController };
  onSelect: (key?: string) => void;
};
const darkQuery = '(prefers-color-scheme: dark)';
function subscribeTheme(change: () => void) {
  const media = window.matchMedia(darkQuery);
  media.addEventListener('change', change);
  return () => media.removeEventListener('change', change);
}
export const useDarkMode = () =>
  useSyncExternalStore(
    subscribeTheme,
    () => window.matchMedia(darkQuery).matches,
    () => false,
  );
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function RequirementGraph({
  graph,
  map,
  filter,
  layers,
  selected,
  controller,
  onSelect,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const renderer = useRef<Sigma<NodeAttributes, { kind: EdgeKind; weight: number }>>(undefined);
  const [failed, setFailed] = useState(false);
  const view = useMemo(() => {
    const listings = matchingListings(map, filter);
    const demands = new Map(map.capabilities.map((c) => [c.id, demand(c, listings)]));
    const stories = new Map(map.capabilities.map((c) => [c.id, c.entryIds.length]));
    const concepts = new Map(
      map.concepts.map((c) => [
        c.id,
        new Set(
          map.capabilities
            .filter((cap) => c.capabilityIds.includes(cap.id))
            .flatMap((cap) => cap.listingIds.filter((id) => listings.has(id))),
        ).size,
      ]),
    );
    return {
      demands,
      stories,
      concepts,
      maxDemand: Math.max(1, ...demands.values()),
      maxConcept: Math.max(1, ...concepts.values()),
    };
  }, [map, filter]);
  const dark = useDarkMode();
  // Sigma reads these from reducers on every frame; refs avoid recreating the renderer.
  const state = useRef({ view, filter, layers, selected, onSelect });
  const palette = useRef<Palette>(graphPalettes.light);
  const hovered = useRef<string>(undefined);
  // Keep the imperative renderer in step with React state.
  useEffect(() => {
    state.current = { view, filter, layers, selected, onSelect };
    palette.current = dark ? graphPalettes.dark : graphPalettes.light;
    renderer.current?.setSetting('labelColor', { color: palette.current.label });
    renderer.current?.refresh({ skipIndexation: true });
  }, [view, filter, layers, selected, onSelect, dark]);

  // Mount the WebGL renderer for this graph.
  useEffect(() => {
    let cancelled = false;
    let instance: Sigma<NodeAttributes, { kind: EdgeKind; weight: number }> | undefined;
    const nodeReducer = (key: string, data: NodeAttributes): Partial<NodeDisplayData> => {
      const p = palette.current;
      const { view, filter, layers, selected } = state.current;
      const out: Partial<NodeDisplayData> = { ...data, zIndex: 1 };
      if (data.kind === 'concept') {
        const n = view.concepts.get(data.id) ?? 0;
        out.size = 6 + 6 * Math.sqrt(n / view.maxConcept);
        out.color = n ? p.ink : p.faded;
        out.forceLabel = true;
        out.zIndex = 2;
      } else if (data.kind === 'capability') {
        const n = view.demands.get(data.id) ?? 0;
        out.size = n ? 2.5 + 8 * Math.sqrt(n / view.maxDemand) : 2;
        out.color = n ? coverageColor(p, view.stories.get(data.id) ?? 0) : p.faded;
        if (!n) out.label = '';
      } else if (data.kind === 'entry') {
        out.hidden = !layers.stories;
        out.size = 5;
        out.color = p.story;
        out.zIndex = 2;
      } else {
        out.hidden = !layers.tracks;
        out.size = 9;
        out.color = !filter.track || filter.track === data.id ? p.track : p.faded;
        out.forceLabel = true;
        out.zIndex = 2;
      }
      const active = hovered.current ?? selected;
      if (active && graph.hasNode(active)) {
        if (key === active) {
          out.highlighted = true;
          out.forceLabel = true;
          out.zIndex = 3;
        } else if (graph.areNeighbors(key, active)) {
          out.forceLabel = !!out.label;
          out.zIndex = 2;
        } else {
          out.color = p.faded;
          out.forceLabel = false;
          out.label = data.kind === 'concept' ? data.label : '';
          out.zIndex = 0;
        }
      }
      return out;
    };
    const edgeReducer = (
      edge: string,
      data: { kind: EdgeKind; weight: number },
    ): Partial<EdgeDisplayData> => {
      const p = palette.current;
      const { view, layers, selected } = state.current;
      const active = hovered.current ?? selected;
      const [source, target] = graph.extremities(edge);
      const touches = active === source || active === target;
      const capability = parseNodeKey(target);
      const live = capability.kind !== 'capability' || (view.demands.get(capability.id) ?? 0) > 0;
      const out: Partial<EdgeDisplayData> = { color: live ? p.edge : p.faded, size: 0.6 };
      // Role-demand edges would hide the structure, so they appear only for the focused node.
      if (data.kind === 'demand') out.hidden = !layers.tracks || !touches;
      if (data.kind === 'story') out.hidden = !layers.stories;
      if (active) {
        out.color = touches ? p.edgeActive : p.faded;
        out.size = touches
          ? data.kind === 'demand'
            ? 0.5 + 0.4 * Math.sqrt(data.weight)
            : 1
          : 0.4;
        out.zIndex = touches ? 1 : 0;
      }
      return out;
    };
    const drawHover: Settings['defaultDrawNodeHover'] = (context, data, settings) => {
      const p = palette.current;
      const size = settings.labelSize;
      context.font = `${settings.labelWeight} ${size}px ${settings.labelFont}`;
      const label = data.label ?? '';
      const width = context.measureText(label).width + 12;
      const x = data.x + data.size + 4;
      const y = data.y - size / 2 - 5;
      context.fillStyle = p.popover;
      context.strokeStyle = p.border;
      context.lineWidth = 1;
      context.beginPath();
      context.roundRect(x - 4, y, width, size + 10, 4);
      context.fill();
      context.stroke();
      context.beginPath();
      context.arc(data.x, data.y, data.size + 2, 0, Math.PI * 2);
      context.fillStyle = p.popover;
      context.fill();
      context.beginPath();
      context.arc(data.x, data.y, data.size, 0, Math.PI * 2);
      context.fillStyle = data.color;
      context.fill();
      context.fillStyle = p.ink;
      context.fillText(label, x + 2, data.y + size / 3);
    };
    void import('sigma')
      .then(({ default: SigmaRenderer }) => {
        if (cancelled || !container.current) return;
        instance = new SigmaRenderer(graph, container.current, {
          nodeReducer,
          edgeReducer,
          defaultDrawNodeHover: drawHover,
          labelFont: '"Geist Variable", system-ui, sans-serif',
          labelSize: 12,
          labelWeight: '500',
          labelColor: { color: palette.current.label },
          labelRenderedSizeThreshold: 9,
          labelDensity: 0.5,
          zIndex: true,
          stagePadding: 90,
          minCameraRatio: 0.08,
          maxCameraRatio: 3,
        });
        renderer.current = instance;
        instance.on('enterNode', ({ node }) => {
          hovered.current = node;
          if (container.current) container.current.style.cursor = 'pointer';
          instance?.refresh({ skipIndexation: true });
        });
        instance.on('leaveNode', () => {
          hovered.current = undefined;
          if (container.current) container.current.style.cursor = '';
          instance?.refresh({ skipIndexation: true });
        });
        instance.on('clickNode', ({ node }) => state.current.onSelect(node));
        instance.on('clickStage', () => state.current.onSelect(undefined));
        controller.current = {
          focus: (key) => {
            const position = graph.hasNode(key) ? instance?.getNodeDisplayData(key) : undefined;
            if (position)
              void instance
                ?.getCamera()
                .animate(
                  { x: position.x, y: position.y, ratio: 0.7 },
                  { duration: reducedMotion() ? 0 : 450 },
                );
          },
        };
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
      controller.current = undefined;
      instance?.kill();
      renderer.current = undefined;
    };
  }, [graph, controller]);

  const camera = (action: 'in' | 'out' | 'reset') => {
    const c = renderer.current?.getCamera();
    const duration = reducedMotion() ? 0 : 250;
    if (action === 'in') void c?.animatedZoom({ duration });
    if (action === 'out') void c?.animatedUnzoom({ duration });
    if (action === 'reset') void c?.animatedReset({ duration });
  };
  if (failed)
    return (
      <p role="alert" className="p-6 text-sm text-muted-foreground">
        The graph could not start in this browser. Use the list view instead.
      </p>
    );
  return (
    <div className="relative h-full min-h-[420px] w-full">
      <div
        ref={container}
        role="img"
        aria-label={`Network of ${map.concepts.length} concepts and ${map.capabilities.length} capabilities. The panel and list view offer the same details by keyboard.`}
        className="absolute inset-0"
        data-testid="requirement-graph"
      />
      <div className="absolute right-3 bottom-3 flex flex-col gap-1 rounded-md border bg-background/90 p-1 shadow-sm">
        <Button size="icon" variant="ghost" aria-label="Zoom in" onClick={() => camera('in')}>
          <Plus />
        </Button>
        <Button size="icon" variant="ghost" aria-label="Zoom out" onClick={() => camera('out')}>
          <Minus />
        </Button>
        <Button size="icon" variant="ghost" aria-label="Fit graph" onClick={() => camera('reset')}>
          <Maximize />
        </Button>
      </div>
    </div>
  );
}
