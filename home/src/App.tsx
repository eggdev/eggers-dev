import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  BootstrapPayload,
  DestinationPlanningUpdate,
  Hotel,
  ResearchEntryInput,
  ScoreKey,
} from '../shared'
import { api } from './api'
import { DestinationDetail } from './components/DestinationDetail'
import { HotelDetail } from './components/HotelDetail'
import { TripStyleControl } from './components/TripStyleControl'
import { styleMode } from './planning'
import { Compare } from './views/Compare'
import { Destinations } from './views/Destinations'
import { Overview } from './views/Overview'
import { Research } from './views/Research'

type View = 'overview' | 'destinations' | 'compare' | 'research'

const viewLabels: Record<View, string> = {
  overview: 'Today',
  destinations: 'Destinations',
  compare: 'Compare',
  research: 'Research',
}

const storedComparison = (): string[] => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem('home.honeymoon.compare') ?? '[]')
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string').slice(0, 4)
      : []
  } catch {
    return []
  }
}

export default function App() {
  const [data, setData] = useState<BootstrapPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<View>('overview')
  const [selectedDestinationId, setSelectedDestinationId] = useState<string>()
  const [selectedHotel, setSelectedHotel] = useState<Hotel>()
  const [comparedIds, setComparedIds] = useState<string[]>(storedComparison)
  const [stylePosition, setStylePosition] = useState(50)
  const [weights, setWeights] = useState<Record<ScoreKey, number>>()
  const [notice, setNotice] = useState<string>()
  const preferenceTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    api
      .bootstrap()
      .then((payload) => {
        if (cancelled) return
        setData(payload)
        setStylePosition(payload.preferences?.stylePosition ?? 50)
        setWeights(
          payload.preferences?.weights ??
            payload.scoringSchema?.defaultWeightingPercent ??
            undefined
        )
      })
      .catch((error: unknown) => {
        if (!cancelled) setNotice(error instanceof Error ? error.message : 'Home could not load')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    localStorage.setItem('home.honeymoon.compare', JSON.stringify(comparedIds))
  }, [comparedIds])

  useEffect(() => {
    if (view) window.scrollTo({ top: 0, behavior: 'instant' })
  }, [view])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(undefined), 5000)
    return () => window.clearTimeout(timer)
  }, [notice])

  const selectedDestination = useMemo(
    () => data?.destinations.find((destination) => destination.id === selectedDestinationId),
    [data?.destinations, selectedDestinationId]
  )

  const queuePreferences = (
    nextStyle: number,
    nextWeights: Record<ScoreKey, number> | undefined
  ) => {
    setStylePosition(nextStyle)
    setWeights(nextWeights)
    if (!nextWeights) return
    window.clearTimeout(preferenceTimer.current)
    preferenceTimer.current = window.setTimeout(() => {
      void api
        .savePreferences({ stylePosition: nextStyle, weights: nextWeights })
        .catch((error: unknown) =>
          setNotice(error instanceof Error ? error.message : 'Could not save ranking preferences')
        )
    }, 500)
  }

  const toggleCompare = (id: string) => {
    setComparedIds((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id)
      if (current.length >= 4) {
        setNotice('Comparison is limited to four destinations')
        return current
      }
      return [...current, id]
    })
  }

  const saveDestination = async (id: string, update: DestinationPlanningUpdate) => {
    const saved = await api.updateDestination(id, update)
    setData((current) =>
      current
        ? {
            ...current,
            destinations: current.destinations.map((destination) =>
              destination.id === saved.id ? saved : destination
            ),
          }
        : current
    )
    setNotice(`${saved.name} updated`)
  }

  const createResearch = async (entry: ResearchEntryInput) => {
    const saved = await api.createResearch(entry)
    setData((current) =>
      current ? { ...current, researchEntries: [saved, ...current.researchEntries] } : current
    )
    setNotice('Research finding saved')
  }

  if (loading) {
    return (
      <main className="loading-screen">
        <div className="brand-mark">E</div>
        <p>Opening Home…</p>
      </main>
    )
  }

  if (!data) {
    return (
      <main className="loading-screen loading-screen--error">
        <div className="brand-mark">E</div>
        <h1>Home could not open.</h1>
        <p>{notice ?? 'The API did not return planning data.'}</p>
        <button type="button" className="button" onClick={() => window.location.reload()}>
          Try again
        </button>
      </main>
    )
  }

  if (!data.seeded || !weights) {
    return (
      <main className="setup-screen">
        <div className="setup-card">
          <div className="brand-mark">E</div>
          <p className="eyebrow">Private D1 is ready</p>
          <h1>Bring in the honeymoon handoff.</h1>
          <p>
            The app is intentionally empty until the private ZIP is imported. The command applies
            the schema and records the handoff as the first immutable research run.
          </p>
          <code>bun run --cwd home db:import -- /path/to/honeymoon-handoff.zip --local</code>
          <small>
            Use <strong>--remote</strong> after the production D1 binding is configured.
          </small>
        </div>
      </main>
    )
  }

  const mode = styleMode(stylePosition)

  return (
    <div className="app-shell">
      <aside className="app-rail">
        <div className="home-brand">
          <span className="brand-mark">E</span>
          <div>
            <strong>Home</strong>
            <small>Eggers family</small>
          </div>
        </div>

        <nav className="module-list" aria-label="Home areas">
          <div className="module-item module-item--active">
            <span className="module-glyph module-glyph--honeymoon">H</span>
            <span>
              <strong>Honeymoon</strong>
              <small>Planning now</small>
            </span>
          </div>
          <div className="module-item module-item--soon" aria-disabled="true">
            <span className="module-glyph">$</span>
            <span>
              <strong>Finances</strong>
              <small>Later</small>
            </span>
          </div>
          <div className="module-item module-item--soon" aria-disabled="true">
            <span className="module-glyph">M</span>
            <span>
              <strong>Meals</strong>
              <small>Later</small>
            </span>
          </div>
        </nav>

        <div className="rail-footer">
          <span className="user-avatar">BE</span>
          <span>
            <strong>Brendan</strong>
            <small>{data.identity.local ? 'Local session' : 'Access protected'}</small>
          </span>
        </div>
      </aside>

      <main className="app-main">
        <header className="topbar">
          <nav aria-label="Honeymoon planner">
            {(Object.keys(viewLabels) as View[]).map((item) => (
              <button
                type="button"
                key={item}
                className={view === item ? 'topbar__active' : ''}
                onClick={() => setView(item)}
              >
                {viewLabels[item]}
                {item === 'compare' && comparedIds.length > 0 ? (
                  <span>{comparedIds.length}</span>
                ) : null}
              </button>
            ))}
          </nav>
          <TripStyleControl
            compact
            value={stylePosition}
            onChange={(nextStyle) => queuePreferences(nextStyle, weights)}
          />
        </header>

        <div className="view-frame">
          {view === 'overview' ? (
            <Overview
              destinations={data.destinations}
              hotels={data.hotels}
              pointAccounts={data.pointAccounts}
              pointsWallet={data.pointsWallet}
              profile={data.travelerProfile}
              transferPaths={data.transferPaths}
              activity={data.activity}
              researchEntries={data.researchEntries}
              weights={weights}
              stylePosition={stylePosition}
              mode={mode}
              onOpenDestination={(destination) => setSelectedDestinationId(destination.id)}
              onOpenHotel={setSelectedHotel}
              onNavigate={setView}
            />
          ) : null}
          {view === 'destinations' ? (
            <Destinations
              destinations={data.destinations}
              hotels={data.hotels}
              pointAccounts={data.pointAccounts}
              transferPaths={data.transferPaths}
              comparedIds={comparedIds}
              mode={mode}
              stylePosition={stylePosition}
              weights={weights}
              scoringSchema={data.scoringSchema}
              onWeightsChange={(nextWeights) => queuePreferences(stylePosition, nextWeights)}
              onResetWeights={() =>
                queuePreferences(
                  stylePosition,
                  data.scoringSchema?.defaultWeightingPercent ?? weights
                )
              }
              onOpen={(destination) => setSelectedDestinationId(destination.id)}
              onToggleCompare={toggleCompare}
            />
          ) : null}
          {view === 'compare' ? (
            <Compare
              destinations={data.destinations}
              comparedIds={comparedIds}
              hotels={data.hotels}
              pointAccounts={data.pointAccounts}
              transferPaths={data.transferPaths}
              mode={mode}
              stylePosition={stylePosition}
              weights={weights}
              onRemove={toggleCompare}
              onOpenDestinations={() => setView('destinations')}
              onOpenHotel={setSelectedHotel}
            />
          ) : null}
          {view === 'research' ? (
            <Research
              entries={data.researchEntries}
              sources={data.sources}
              destinations={data.destinations}
              hotels={data.hotels}
              sourceDate={data.latestResearchRun?.sourceDate}
              onCreate={createResearch}
            />
          ) : null}
        </div>
      </main>

      {selectedDestination ? (
        <DestinationDetail
          destination={selectedDestination}
          hotels={data.hotels.filter((hotel) =>
            hotel.destinationIds.includes(selectedDestination.id)
          )}
          pointAccounts={data.pointAccounts}
          transferPaths={data.transferPaths}
          mode={mode}
          compared={comparedIds.includes(selectedDestination.id)}
          onClose={() => setSelectedDestinationId(undefined)}
          onToggleCompare={() => toggleCompare(selectedDestination.id)}
          onSave={(update) => saveDestination(selectedDestination.id, update)}
          onOpenHotel={setSelectedHotel}
        />
      ) : null}

      {selectedHotel ? (
        <HotelDetail
          hotel={selectedHotel}
          sources={data.sources}
          pointAccounts={data.pointAccounts}
          transferPaths={data.transferPaths}
          onClose={() => setSelectedHotel(undefined)}
        />
      ) : null}

      {notice ? (
        <div className="toast" role="status">
          {notice}
        </div>
      ) : null}
    </div>
  )
}
