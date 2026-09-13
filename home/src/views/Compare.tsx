import type {
  Destination,
  Hotel,
  PointAccount,
  ScoreKey,
  TransferPath,
  TripMode,
} from '../../shared'
import { scoreKeys } from '../../shared'
import {
  hotelCoverage,
  hotelFundingReadiness,
  hotelsForDestination,
  rankableScore,
  scoreLabels,
  titleCase,
} from '../planning'

interface CompareProps {
  destinations: Destination[]
  comparedIds: string[]
  hotels: Hotel[]
  pointAccounts: PointAccount[]
  transferPaths: TransferPath[]
  mode: TripMode
  stylePosition: number
  weights: Record<ScoreKey, number>
  onRemove: (id: string) => void
  onOpenDestinations: () => void
  onOpenHotel: (hotel: Hotel) => void
}

export function Compare({
  destinations,
  comparedIds,
  hotels,
  pointAccounts,
  transferPaths,
  mode,
  stylePosition,
  weights,
  onRemove,
  onOpenDestinations,
  onOpenHotel,
}: CompareProps) {
  const compared = comparedIds
    .map((id) => destinations.find((destination) => destination.id === id))
    .filter((destination): destination is Destination => Boolean(destination))

  return (
    <div className="view-stack">
      <header className="view-header">
        <div>
          <p className="eyebrow">Honeymoon / compare</p>
          <h1>Tradeoffs, lined up.</h1>
          <p>Unknowns stay unknown. The planner will not manufacture cash or award numbers.</p>
        </div>
        <button type="button" className="button" onClick={onOpenDestinations}>
          {compared.length < 2 ? 'Choose destinations' : 'Edit selection'}
        </button>
      </header>

      {compared.length < 2 ? (
        <section className="empty-state empty-state--large">
          <strong>Select at least two destinations.</strong>
          <p>You can compare up to four side by side.</p>
          <button type="button" className="button button--primary" onClick={onOpenDestinations}>
            Open destination board
          </button>
        </section>
      ) : (
        <div className="compare-scroll">
          <section
            className="compare-grid"
            style={{ '--compare-count': compared.length } as React.CSSProperties}
          >
            {compared.map((destination) => {
              const destinationHotels = hotelsForDestination(hotels, destination.id)
              const coverage = hotelCoverage(destination, hotels)
              const score = rankableScore(destination, hotels, weights, stylePosition)
              const hotelFunding = destinationHotels.map((hotel) => ({
                hotel,
                readiness: hotelFundingReadiness(hotel, pointAccounts, transferPaths),
              }))
              const fullPointsReady = hotelFunding.filter(
                (item) => item.readiness.state === 'fully_fundable'
              ).length
              return (
                <article key={destination.id} className="compare-column">
                  <header>
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => onRemove(destination.id)}
                      aria-label={`Remove ${destination.name}`}
                    >
                      ×
                    </button>
                    <p>{destination.region}</p>
                    <h2>{destination.name}</h2>
                    <div className="compare-score">
                      <strong>{score ?? '—'}</strong>
                      <span>{score === undefined ? 'not rankable' : '/100 now'}</span>
                    </div>
                    <span
                      className={
                        coverage.complete ? 'coverage-pill' : 'coverage-pill coverage-pill--needs'
                      }
                    >
                      {coverage.complete
                        ? `${coverage.researchedCount} hotels · route covered`
                        : `Missing ${coverage.missing.join(', ') || 'hotel depth'}`}
                    </span>
                  </header>

                  <div className="compare-cell compare-cell--concept">
                    <span>{titleCase(mode)} concept</span>
                    <p>{destination.tripModes[mode]}</p>
                  </div>

                  <div className="compare-cell">
                    <span>Timing</span>
                    <strong>{destination.bestWindow}</strong>
                    <p>{destination.weatherNote}</p>
                  </div>

                  <div className="compare-cell compare-cell--economics">
                    <span>Cash economics</span>
                    <strong>{titleCase(destination.cashLeakage)} expected leakage</strong>
                    <dl>
                      <div>
                        <dt>Air taxes</dt>
                        <dd>Not researched</dd>
                      </div>
                      <div>
                        <dt>Lodging</dt>
                        <dd>
                          {fullPointsReady}/{destinationHotels.length} leads fully points-fundable
                        </dd>
                      </div>
                      <div>
                        <dt>Food</dt>
                        <dd>Not researched</dd>
                      </div>
                      <div>
                        <dt>Activities</dt>
                        <dd>Not researched</dd>
                      </div>
                      <div>
                        <dt>Transfers</dt>
                        <dd>Not researched</dd>
                      </div>
                    </dl>
                  </div>

                  <div className="compare-cell">
                    <span>Points paths</span>
                    <div className="tag-list tag-list--compact">
                      {destination.pointsAngle.slice(0, 6).map((item) => (
                        <span key={item}>{item}</span>
                      ))}
                    </div>
                  </div>

                  <div className="compare-cell">
                    <span>Signal profile</span>
                    <dl className="compare-signals">
                      {scoreKeys
                        .filter((key) => key !== 'logistics_ease')
                        .map((key) => (
                          <div key={key}>
                            <dt>{scoreLabels[key]}</dt>
                            <dd>{destination.scores[key]}/5</dd>
                          </div>
                        ))}
                    </dl>
                  </div>

                  <div className="compare-cell">
                    <span>Hotel leads</span>
                    {destinationHotels.length > 0 ? (
                      <div className="compare-hotels">
                        {hotelFunding.map(({ hotel, readiness }) => (
                          <button type="button" key={hotel.id} onClick={() => onOpenHotel(hotel)}>
                            <strong>{hotel.name}</strong>
                            <small>
                              {hotel.analysis.funding.pointsPercent}% points · {readiness.label}
                            </small>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="not-researched">No hotel candidate attached</p>
                    )}
                  </div>

                  <footer>
                    <span
                      className={
                        destination.sourceIds.length > 0
                          ? 'confidence'
                          : 'confidence confidence--needs'
                      }
                    >
                      {destination.sourceIds.length > 0
                        ? `${destination.sourceIds.length} linked sources`
                        : 'Needs live verification'}
                    </span>
                  </footer>
                </article>
              )
            })}
          </section>
        </div>
      )}
    </div>
  )
}
