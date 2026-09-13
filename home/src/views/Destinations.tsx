import { useMemo, useState } from 'react'
import type {
  Destination,
  Hotel,
  PointAccount,
  ScoreKey,
  ScoringSchema,
  TransferPath,
  TripMode,
} from '../../shared'
import { WeightEditor } from '../components/WeightEditor'
import {
  hotelCoverage,
  hotelFundingReadiness,
  hotelsForDestination,
  rankableScore,
  scoreLabels,
  titleCase,
} from '../planning'

interface DestinationsProps {
  destinations: Destination[]
  hotels: Hotel[]
  pointAccounts: PointAccount[]
  transferPaths: TransferPath[]
  comparedIds: string[]
  mode: TripMode
  stylePosition: number
  weights: Record<ScoreKey, number>
  scoringSchema?: ScoringSchema
  onWeightsChange: (weights: Record<ScoreKey, number>) => void
  onResetWeights: () => void
  onOpen: (destination: Destination) => void
  onToggleCompare: (id: string) => void
}

export function Destinations({
  destinations,
  hotels,
  pointAccounts,
  transferPaths,
  comparedIds,
  mode,
  stylePosition,
  weights,
  scoringSchema,
  onWeightsChange,
  onResetWeights,
  onOpen,
  onToggleCompare,
}: DestinationsProps) {
  const [query, setQuery] = useState('')
  const [region, setRegion] = useState('all')
  const [status, setStatus] = useState('all')
  const regions = [...new Set(destinations.map((destination) => destination.region))].sort()
  const visible = useMemo(
    () =>
      destinations
        .filter(
          (destination) =>
            (region === 'all' || destination.region === region) &&
            (status === 'all' || destination.planningStatus === status) &&
            `${destination.name} ${destination.region} ${destination.pointsAngle.join(' ')}`
              .toLowerCase()
              .includes(query.toLowerCase())
        )
        .sort((a, b) => {
          const scoreA = rankableScore(a, hotels, weights, stylePosition)
          const scoreB = rankableScore(b, hotels, weights, stylePosition)
          if (scoreA === undefined && scoreB === undefined) return a.name.localeCompare(b.name)
          if (scoreA === undefined) return 1
          if (scoreB === undefined) return -1
          return scoreB - scoreA
        }),
    [destinations, hotels, query, region, status, stylePosition, weights]
  )

  return (
    <div className="view-stack">
      <header className="view-header">
        <div>
          <p className="eyebrow">Honeymoon / destination board</p>
          <h1>Keep every good option in play.</h1>
          <p>The rhythm changes emphasis and rank. It never hides a destination.</p>
        </div>
        <div className="compare-count">
          <strong>{comparedIds.length}</strong>
          <span>of 4 in compare</span>
        </div>
      </header>

      <section className="filter-bar" aria-label="Destination filters">
        <label className="search-field">
          <span>Search</span>
          <input
            type="search"
            value={query}
            placeholder="Destination or points program"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label>
          Region
          <select value={region} onChange={(event) => setRegion(event.target.value)}>
            <option value="all">All regions</option>
            {regions.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">All statuses</option>
            <option value="exploring">Exploring</option>
            <option value="shortlist">Shortlist</option>
            <option value="finalist">Finalist</option>
            <option value="parked">Parked</option>
          </select>
        </label>
      </section>

      {scoringSchema ? (
        <WeightEditor
          schema={scoringSchema}
          weights={weights}
          onChange={onWeightsChange}
          onReset={onResetWeights}
        />
      ) : null}

      <section className="destination-board" aria-label={`${visible.length} destinations`}>
        <div className="destination-board__head" aria-hidden="true">
          <span>Rank</span>
          <span>Destination &amp; current concept</span>
          <span>Signals</span>
          <span>Cash</span>
          <span>Compare</span>
        </div>
        {visible.map((destination, index) => {
          const compared = comparedIds.includes(destination.id)
          const coverage = hotelCoverage(destination, hotels)
          const score = rankableScore(destination, hotels, weights, stylePosition)
          const destinationFunding = hotelsForDestination(hotels, destination.id).map((hotel) =>
            hotelFundingReadiness(hotel, pointAccounts, transferPaths)
          )
          const fullyFundable = destinationFunding.filter(
            (item) => item.state === 'fully_fundable'
          ).length
          const constrained = destinationFunding.length - fullyFundable
          return (
            <article key={destination.id} className="destination-row">
              <button
                type="button"
                className="destination-row__main"
                onClick={() => onOpen(destination)}
                aria-label={`Open ${destination.name}`}
              >
                <span className="destination-rank">
                  <strong>{score === undefined ? '—' : String(index + 1).padStart(2, '0')}</strong>
                  <small>{score ?? 'NR'}</small>
                </span>
                <span className="destination-title">
                  <span className="destination-title__line">
                    <strong>{destination.name}</strong>
                    {destination.isFavorite ? <span title="Saved choice">●</span> : null}
                  </span>
                  <small>{destination.region}</small>
                  <p>{destination.tripModes[mode]}</p>
                  <span className="destination-title__meta">
                    <span className={`status status--${destination.planningStatus}`}>
                      {titleCase(destination.planningStatus)}
                    </span>
                    <span
                      className={
                        coverage.complete ? 'coverage-pill' : 'coverage-pill coverage-pill--needs'
                      }
                    >
                      {coverage.complete
                        ? `${coverage.researchedCount} researched · ${fullyFundable} full-points ready · ${constrained} split/cash`
                        : `Unrankable · ${coverage.missing.join(', ') || '3 hotels required'}`}
                    </span>
                  </span>
                </span>
                <span className="signal-list">
                  {(['points_fit', 'food', 'beach_water', 'hotel_wow'] as ScoreKey[]).map((key) => (
                    <span key={key}>
                      <small>{scoreLabels[key]}</small>
                      <strong>{destination.scores[key]}</strong>
                    </span>
                  ))}
                </span>
                <span className={`cash-band cash-band--${destination.cashLeakage}`}>
                  {titleCase(destination.cashLeakage)}
                </span>
              </button>
              <button
                type="button"
                className={compared ? 'compare-toggle compare-toggle--active' : 'compare-toggle'}
                onClick={() => onToggleCompare(destination.id)}
                aria-pressed={compared}
              >
                {compared ? 'Added' : 'Add'}
              </button>
            </article>
          )
        })}
      </section>
      {visible.length === 0 ? (
        <p className="empty-state">No destinations match those filters.</p>
      ) : null}
    </div>
  )
}
