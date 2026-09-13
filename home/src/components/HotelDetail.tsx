import type { Hotel, PointAccount, ResearchSource, TransferPath } from '../../shared'
import { compactNumber, hotelFundingReadiness, readableDate, titleCase } from '../planning'

interface HotelDetailProps {
  hotel: Hotel
  sources: ResearchSource[]
  pointAccounts: PointAccount[]
  transferPaths: TransferPath[]
  onClose: () => void
}

export function HotelDetail({
  hotel,
  sources,
  pointAccounts,
  transferPaths,
  onClose,
}: HotelDetailProps) {
  const hotelSources = sources.filter((source) => hotel.sourceIds.includes(source.id))
  const officialPage =
    hotel.imageStrategy.officialRoomPage ?? hotel.imageStrategy.officialSourcePage
  const funding = hotel.analysis.funding
  const readiness = hotelFundingReadiness(hotel, pointAccounts, transferPaths)
  const pointsRange = `${compactNumber(funding.pointsLow)}–${compactNumber(funding.pointsHigh)}`

  return (
    <div className="drawer-shell drawer-shell--top" role="presentation">
      <button
        type="button"
        className="drawer-backdrop"
        aria-label="Close hotel"
        onClick={onClose}
      />
      <aside className="drawer drawer--hotel" aria-labelledby="hotel-detail-title">
        <div className="drawer__header">
          <div>
            <p className="eyebrow">{hotel.program}</p>
            <h2 id="hotel-detail-title">{hotel.name}</h2>
            <p className="drawer__location">{hotel.analysis.location}</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close hotel">
            ×
          </button>
        </div>

        <div className="room-image-placeholder room-image-placeholder--researched">
          <span>What the points room gets you</span>
          <strong>{hotel.actualRoomHighlight}</strong>
          {officialPage ? (
            <a href={officialPage} target="_blank" rel="noreferrer">
              Open official room page ↗
            </a>
          ) : null}
        </div>

        <section className="detail-section detail-facts">
          <div>
            <span>Redemption</span>
            <strong>{hotel.awardCategory}</strong>
          </div>
          <div>
            <span>Hotel wow</span>
            <strong>{hotel.hotelWow}/5</strong>
          </div>
          <p>{hotel.pointsNote}</p>
        </section>

        <section className="detail-section research-status-row">
          <span
            className={
              hotel.analysis.status === 'decision_ready'
                ? 'coverage-pill'
                : 'coverage-pill coverage-pill--needs'
            }
          >
            {hotel.analysis.status === 'decision_ready'
              ? 'Decision research complete'
              : 'Booking check needed'}
          </span>
          <span>Verified {readableDate(hotel.analysis.verifiedAt)}</span>
        </section>

        <section className={`detail-section funding-card funding-card--${readiness.state}`}>
          <div className="section-heading section-heading--small">
            <div>
              <p className="eyebrow">Room funding plan</p>
              <h3>How we pay</h3>
            </div>
            <span className={`funding-pill funding-pill--${readiness.state}`}>
              {readiness.label}
            </span>
          </div>

          <div className="funding-split">
            <div className="funding-split__labels">
              <span>
                <strong>{funding.pointsPercent}%</strong> points
              </span>
              <span>
                <strong>{funding.cashPercent}%</strong> room cash
              </span>
            </div>
            <div className="funding-split__bar" aria-hidden="true">
              <span style={{ width: `${funding.pointsPercent}%` }} />
            </div>
          </div>

          <div className="funding-metrics">
            <div>
              <span>Stay assumption</span>
              <strong>{funding.assumedNights} nights</strong>
            </div>
            <div>
              <span>
                {funding.mode === 'cash' ? 'Optional award estimate' : 'Full award estimate'}
              </span>
              <strong>{pointsRange} pts</strong>
            </div>
            <div>
              <span>Accessible now</span>
              <strong>
                {compactNumber(readiness.availablePoints)} {funding.targetProgram} pts
              </strong>
            </div>
            <div>
              <span>Wallet vs. full estimate</span>
              <strong>{readiness.fullAwardCoveragePercent}% at high end</strong>
            </div>
          </div>

          {funding.mode === 'split' ? (
            <p className="funding-plan-check">
              Recommended points share needs {compactNumber(readiness.plannedPointsLow)}–
              {compactNumber(readiness.plannedPointsHigh)} points.{' '}
              <strong>
                {readiness.plannedShareCovered
                  ? 'The current wallet covers that split.'
                  : 'The current wallet does not cover that split at the high end.'}
              </strong>
            </p>
          ) : null}

          <p className="funding-recommendation">{funding.recommendation}</p>
          <p className="funding-basis">
            <strong>Estimate basis:</strong> {funding.estimateBasis}
          </p>
          <p className="helper-text">
            Transferable from {funding.transferSources.join(' + ') || 'no points balance'}. The
            percentage covers the room only; taxes, meals, access, and upgrades remain in the cash
            exposure below.
          </p>
        </section>

        <section className="detail-section hotel-analysis-grid">
          <div>
            <span>Where it fits</span>
            <strong>{hotel.analysis.stayRole}</strong>
          </div>
          <div>
            <span>Standard award room</span>
            <strong>{hotel.analysis.standardAwardRoom}</strong>
          </div>
          <div>
            <span>How it prices</span>
            <strong>{hotel.analysis.pricingModel}</strong>
          </div>
          <div>
            <span>2027 availability</span>
            <strong>{hotel.analysis.availability}</strong>
          </div>
          <div>
            <span>Transfer path</span>
            <strong>{hotel.analysis.transferPath}</strong>
          </div>
          <div>
            <span>Access</span>
            <strong>{hotel.analysis.access}</strong>
          </div>
        </section>

        <section className="detail-section">
          <h3>Room facts in hand</h3>
          <dl className="fact-list">
            {Object.entries(hotel.roomFacts).map(([key, value]) => (
              <div key={key}>
                <dt>{titleCase(key)}</dt>
                <dd>{typeof value === 'boolean' ? (value ? 'Yes' : 'No') : value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="detail-section hotel-value-grid">
          <div>
            <h3>Included</h3>
            <ul>
              {hotel.analysis.inclusions.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3>Cash still exposed</h3>
            <ul>
              {hotel.analysis.unavoidableCash.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className="detail-section hotel-analysis-grid">
          <div>
            <span>Meals</span>
            <strong>{hotel.analysis.mealPlan}</strong>
          </div>
          <div>
            <span>Resort / destination fee</span>
            <strong>{hotel.analysis.resortFee}</strong>
          </div>
          <div>
            <span>Upgrade path</span>
            <strong>{hotel.analysis.upgradePath}</strong>
          </div>
          <div>
            <span>Best for</span>
            <strong>{hotel.analysis.bestFor}</strong>
          </div>
        </section>

        <section className="detail-section hotel-value-grid">
          <div>
            <h3>Do there</h3>
            <ul>
              {hotel.analysis.activities.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3>Watch-outs</h3>
            <ul>
              {hotel.analysis.tradeoffs.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className="detail-section">
          <h3>Source trail</h3>
          <div className="source-list source-list--compact">
            {hotelSources.map((source) => (
              <a key={source.id} href={source.url} target="_blank" rel="noreferrer">
                <span>{source.publisher}</span>
                <strong>{source.title}</strong>
                <small>Retrieved {source.retrieved}</small>
              </a>
            ))}
          </div>
          <p className="helper-text">Image status: {titleCase(hotel.imageStrategy.status)}</p>
        </section>
      </aside>
    </div>
  )
}
