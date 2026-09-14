import { api } from '@home/api'
import {
  compactNumber,
  hotelFundingReadiness,
  readableDate,
  styleLabel,
  weightedScore,
} from '@home/planning'
import type {
  BootstrapPayload,
  Confidence,
  Destination,
  PlanningStatus,
  ResearchEntryInput,
  ScoreKey,
} from '@repo/home'
import { Alert } from '@repo/ui/alert'
import { Badge } from '@repo/ui/badge'
import { Button } from '@repo/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/card'
import { Input } from '@repo/ui/input'
import { Label } from '@repo/ui/label'
import { Select } from '@repo/ui/select'
import { Separator } from '@repo/ui/separator'
import { Textarea } from '@repo/ui/textarea'
import { useEffect, useMemo, useState } from 'react'

type View = 'overview' | 'destinations' | 'stays' | 'research'
const views: ReadonlyArray<{ id: View; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'destinations', label: 'Destinations' },
  { id: 'stays', label: 'Stays' },
  { id: 'research', label: 'Research' },
]

const planningStatuses: PlanningStatus[] = [
  'exploring',
  'shortlist',
  'finalist',
  'booked',
  'parked',
]

export function App() {
  const [data, setData] = useState<BootstrapPayload>()
  const [view, setView] = useState<View>('overview')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [stylePosition, setStylePosition] = useState(50)
  const [weights, setWeights] = useState<Record<ScoreKey, number>>()

  useEffect(() => {
    api
      .bootstrap()
      .then((payload) => {
        setData(payload)
        setStylePosition(payload.preferences?.stylePosition ?? 50)
        setWeights(payload.preferences?.weights ?? payload.scoringSchema?.defaultWeightingPercent)
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'Home could not load'))
  }, [])

  const ranked = useMemo(() => {
    if (!data || !weights) return []
    return [...data.destinations]
      .map((destination) => ({
        destination,
        score: weightedScore(destination, weights, stylePosition),
      }))
      .sort((left, right) => right.score - left.score)
  }, [data, stylePosition, weights])

  const saveStyle = async (next: number) => {
    setStylePosition(next)
    if (!weights) return
    try {
      const saved = await api.savePreferences({ stylePosition: next, weights })
      setData((current) => (current ? { ...current, preferences: saved } : current))
      setNotice('Trip style saved')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save trip style')
    }
  }

  const updateDestination = async (
    destination: Destination,
    planningStatus: PlanningStatus,
    personalNote: string,
    isFavorite: boolean
  ) => {
    try {
      const saved = await api.updateDestination(destination.id, {
        planningStatus,
        personalNote,
        isFavorite,
        revision: destination.revision,
      })
      setData((current) =>
        current
          ? {
              ...current,
              destinations: current.destinations.map((item) =>
                item.id === saved.id ? saved : item
              ),
            }
          : current
      )
      setNotice(`${saved.name} saved`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save destination')
    }
  }

  if (!data) {
    return (
      <main className="mx-auto grid min-h-dvh max-w-xl place-items-center p-6">
        <Alert className={error ? 'border-destructive text-destructive' : ''}>
          {error || 'Opening Home…'}
        </Alert>
      </main>
    )
  }

  if (!data.seeded || !weights) {
    return (
      <main className="mx-auto grid min-h-dvh max-w-2xl place-items-center p-6">
        <Card>
          <CardHeader>
            <Badge className="w-fit">Private D1 is ready</Badge>
            <CardTitle className="text-2xl">Bring in the honeymoon handoff.</CardTitle>
            <CardDescription>
              The shared database is empty until the private research export is imported.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <code className="block overflow-x-auto rounded-md bg-muted p-4 text-xs">
              bun run --cwd apps/home db:import -- /path/to/honeymoon-handoff.zip --local
            </code>
          </CardContent>
        </Card>
      </main>
    )
  }

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-3 sm:px-6">
          <div className="mr-auto">
            <h1 className="text-lg font-bold">Home</h1>
            <p className="text-xs text-muted-foreground">Private Eggers family workspace</p>
          </div>
          <Badge variant="secondary">
            {data.identity.local ? 'Local session' : 'Access protected'}
          </Badge>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[13rem_1fr]">
        <aside>
          <nav className="flex gap-1 overflow-x-auto lg:flex-col" aria-label="Home areas">
            {views.map((item) => (
              <Button
                key={item.id}
                variant={view === item.id ? 'secondary' : 'ghost'}
                className="justify-start"
                onClick={() => setView(item.id)}
              >
                {item.label}
              </Button>
            ))}
          </nav>
          <Separator className="my-4 hidden lg:block" />
          <Label className="hidden lg:grid">
            Trip style: {styleLabel(stylePosition)}
            <Input
              type="range"
              min={0}
              max={100}
              value={stylePosition}
              onChange={(event) => void saveStyle(Number(event.target.value))}
            />
          </Label>
        </aside>

        <main className="min-w-0">
          {error && <Alert className="mb-5 border-destructive text-destructive">{error}</Alert>}
          {notice && <Alert className="mb-5 border-primary text-primary">{notice}</Alert>}

          {view === 'overview' && (
            <div className="grid gap-5">
              <header>
                <p className="text-sm text-muted-foreground">
                  {data.travelerProfile?.project ?? 'Honeymoon planning'}
                </p>
                <h2 className="text-3xl font-bold tracking-tight">Decision room</h2>
              </header>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <Metric
                  label="Destinations"
                  value={String(data.destinations.length)}
                  note={`${data.destinations.filter(({ isFavorite }) => isFavorite).length} favorites`}
                />
                <Metric
                  label="Points planned"
                  value={compactNumber(
                    data.pointsWallet?.totalPlannedPoints ??
                      data.pointAccounts.reduce((sum, account) => sum + account.points, 0)
                  )}
                  note={
                    data.pointsWallet?.asOf
                      ? `As of ${readableDate(data.pointsWallet.asOf)}`
                      : 'Current wallet'
                  }
                />
                <Metric
                  label="Research"
                  value={String(data.researchEntries.length)}
                  note={
                    data.latestResearchRun
                      ? `Updated ${readableDate(data.latestResearchRun.sourceDate)}`
                      : 'No import recorded'
                  }
                />
              </div>
              <Card>
                <CardHeader>
                  <CardTitle>Leading destinations</CardTitle>
                  <CardDescription>
                    Weighted for {styleLabel(stylePosition).toLowerCase()}.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3">
                  {ranked.slice(0, 6).map(({ destination, score }, index) => (
                    <div
                      key={destination.id}
                      className="grid grid-cols-[2rem_1fr_auto] items-center gap-3 border-b pb-3 last:border-0 last:pb-0"
                    >
                      <span className="text-sm tabular-nums text-muted-foreground">
                        {index + 1}
                      </span>
                      <div>
                        <strong>{destination.name}</strong>
                        <p className="text-xs text-muted-foreground">
                          {destination.region} · {destination.planningStatus}
                        </p>
                      </div>
                      <Badge variant="outline">{score}</Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          )}

          {view === 'destinations' && (
            <div className="grid gap-5">
              <header>
                <h2 className="text-3xl font-bold tracking-tight">Destinations</h2>
                <p className="text-muted-foreground">
                  Shortlist, annotate, and compare the researched options.
                </p>
              </header>
              {ranked.map(({ destination, score }) => (
                <DestinationEditor
                  key={destination.id}
                  destination={destination}
                  score={score}
                  onSave={updateDestination}
                />
              ))}
            </div>
          )}

          {view === 'stays' && (
            <div className="grid gap-5">
              <header>
                <h2 className="text-3xl font-bold tracking-tight">Stays</h2>
                <p className="text-muted-foreground">
                  Award fit, room reality, and the tradeoffs that matter.
                </p>
              </header>
              <div className="grid gap-4 xl:grid-cols-2">
                {data.hotels.map((hotel) => {
                  const destination = data.destinations.find(({ id }) => id === hotel.destinationId)
                  const funding = hotelFundingReadiness(
                    hotel,
                    data.pointAccounts,
                    data.transferPaths
                  )
                  return (
                    <Card key={hotel.id}>
                      <CardHeader>
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="secondary">{hotel.program}</Badge>
                          <Badge variant="outline">{funding.label}</Badge>
                        </div>
                        <CardTitle>{hotel.name}</CardTitle>
                        <CardDescription>
                          {destination?.name ?? hotel.analysis.location}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="grid gap-3 text-sm">
                        <p>{hotel.actualRoomHighlight}</p>
                        <p className="text-muted-foreground">{hotel.analysis.bestFor}</p>
                        <div className="flex flex-wrap gap-2">
                          {hotel.analysis.fit.vibeTags.map((tag) => (
                            <Badge key={tag} variant="outline">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            </div>
          )}

          {view === 'research' && (
            <ResearchView
              data={data}
              onCreated={(entry) =>
                setData((current) =>
                  current
                    ? { ...current, researchEntries: [entry, ...current.researchEntries] }
                    : current
                )
              }
              onNotice={setNotice}
              onError={setError}
            />
          )}
        </main>
      </div>
    </div>
  )
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-3xl tabular-nums">{value}</CardTitle>
        <p className="text-xs text-muted-foreground">{note}</p>
      </CardHeader>
    </Card>
  )
}

function DestinationEditor({
  destination,
  score,
  onSave,
}: {
  destination: Destination
  score: number
  onSave: (
    destination: Destination,
    status: PlanningStatus,
    note: string,
    favorite: boolean
  ) => Promise<void>
}) {
  const [status, setStatus] = useState(destination.planningStatus)
  const [note, setNote] = useState(destination.personalNote)
  const [favorite, setFavorite] = useState(destination.isFavorite)
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>{destination.name}</CardTitle>
            <CardDescription>
              {destination.region} · {destination.bestWindow}
            </CardDescription>
          </div>
          <Badge>{score}</Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="text-sm">{destination.weatherNote}</p>
        <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
          <Label>
            Status
            <Select
              value={status}
              onChange={(event) => setStatus(event.target.value as PlanningStatus)}
            >
              {planningStatuses.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </Select>
          </Label>
          <Label>
            Private note
            <Textarea value={note} onChange={(event) => setNote(event.target.value)} />
          </Label>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant={favorite ? 'secondary' : 'outline'}
            onClick={() => setFavorite((current) => !current)}
          >
            {favorite ? 'Favorited' : 'Add favorite'}
          </Button>
          <Button onClick={() => void onSave(destination, status, note, favorite)}>Save</Button>
        </div>
      </CardContent>
    </Card>
  )
}

function ResearchView({
  data,
  onCreated,
  onNotice,
  onError,
}: {
  data: BootstrapPayload
  onCreated: (entry: BootstrapPayload['researchEntries'][number]) => void
  onNotice: (notice: string) => void
  onError: (error: string) => void
}) {
  const [input, setInput] = useState<ResearchEntryInput>({
    entityType: 'general',
    title: '',
    summary: '',
    confidence: 'needs_live_verification',
  })
  const create = async () => {
    try {
      const saved = await api.createResearch(input)
      onCreated(saved)
      setInput({
        entityType: 'general',
        title: '',
        summary: '',
        confidence: 'needs_live_verification',
      })
      onNotice('Research finding saved')
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Could not save research')
    }
  }
  return (
    <div className="grid gap-5">
      <header>
        <h2 className="text-3xl font-bold tracking-tight">Research</h2>
        <p className="text-muted-foreground">
          Record a sourced finding without losing its confidence level.
        </p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>Add finding</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Label>
              Type
              <Select
                value={input.entityType}
                onChange={(event) =>
                  setInput((current) => ({
                    ...current,
                    entityType: event.target.value as ResearchEntryInput['entityType'],
                  }))
                }
              >
                {['general', 'destination', 'hotel', 'flight', 'trip'].map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </Select>
            </Label>
            <Label>
              Confidence
              <Select
                value={input.confidence}
                onChange={(event) =>
                  setInput((current) => ({
                    ...current,
                    confidence: event.target.value as Confidence,
                  }))
                }
              >
                {[
                  'verified_current',
                  'source_backed_general',
                  'estimate',
                  'needs_live_verification',
                ].map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </Select>
            </Label>
          </div>
          <Label>
            Title
            <Input
              value={input.title}
              onChange={(event) =>
                setInput((current) => ({ ...current, title: event.target.value }))
              }
            />
          </Label>
          <Label>
            Finding
            <Textarea
              value={input.summary}
              onChange={(event) =>
                setInput((current) => ({ ...current, summary: event.target.value }))
              }
            />
          </Label>
          <Label>
            Source URL
            <Input
              type="url"
              value={input.sourceUrl ?? ''}
              onChange={(event) =>
                setInput((current) => ({ ...current, sourceUrl: event.target.value || undefined }))
              }
            />
          </Label>
          <Button className="w-fit" onClick={() => void create()}>
            Save finding
          </Button>
        </CardContent>
      </Card>
      <div className="grid gap-3">
        {data.researchEntries.map((entry) => (
          <Card key={entry.id}>
            <CardHeader>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{entry.entityType}</Badge>
                <Badge variant="secondary">{entry.confidence.replaceAll('_', ' ')}</Badge>
              </div>
              <CardTitle>{entry.title}</CardTitle>
              <CardDescription>{readableDate(entry.verifiedAt ?? entry.createdAt)}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm">{entry.summary}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
