import type {
  ActivityItem,
  Destination,
  Hotel,
  PointAccount,
  PointsWallet,
  ResearchEntry,
  ScoreKey,
  TransferPath,
  TravelerProfile,
  TripMode,
} from '../../shared'
import { TransferCalculator } from '../components/TransferCalculator'
import {
  compactNumber,
  daysUntil,
  getHyattTransferDeadline,
  readableDate,
  titleCase,
  tripWindowLabel,
  weightedScore,
} from '../planning'

interface OverviewProps {
  destinations: Destination[]
  hotels: Hotel[]
  pointAccounts: PointAccount[]
  pointsWallet?: PointsWallet
  profile?: TravelerProfile
  transferPaths: TransferPath[]
  activity: ActivityItem[]
  researchEntries: ResearchEntry[]
  weights: Record<ScoreKey, number>
  stylePosition: number
  mode: TripMode
  onOpenDestination: (destination: Destination) => void
  onOpenHotel: (hotel: Hotel) => void
  onNavigate: (view: 'destinations' | 'research') => void
}

export function Overview({
  destinations,
  hotels,
  pointAccounts,
  pointsWallet,
  profile,
  transferPaths,
  activity,
  researchEntries,
  weights,
  stylePosition,
  mode,
  onOpenDestination,
  onOpenHotel,
  onNavigate,
}: OverviewProps) {
  const ranked = [...destinations].sort(
    (a, b) => weightedScore(b, weights, stylePosition) - weightedScore(a, weights, stylePosition)
  )
  const hyattDeadline = getHyattTransferDeadline(pointAccounts)
  const deadlineDays = hyattDeadline ? daysUntil(hyattDeadline.through) : undefined
  const deadlineDate = hyattDeadline ? new Date(`${hyattDeadline.through}T12:00:00`) : undefined
  const researchCount = researchEntries.length
  const trackedPoints = pointAccounts.reduce((sum, account) => sum + account.points, 0)

  return (
    <div className="view-stack">
      {hyattDeadline && deadlineDate ? (
        <section className="deadline-banner">
          <div className="deadline-date">
            <span>
              {deadlineDate.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}
            </span>
            <strong>{deadlineDate.getDate()}</strong>
          </div>
          <div>
            <p className="eyebrow">Decision deadline</p>
            <h1>Find the Hyatt bookings worth moving points for.</h1>
            <p>
              The recorded Chase → Hyatt {hyattDeadline.rate} window{' '}
              {deadlineDays !== undefined && deadlineDays >= 0 ? (
                <>
                  closes in <strong>{deadlineDays} days</strong>
                </>
              ) : (
                <strong>has passed</strong>
              )}
              . Confirm useful inventory in the trip window before transferring.
            </p>
          </div>
          <button
            type="button"
            className="button button--on-warm"
            onClick={() => onNavigate('research')}
          >
            Open research queue
          </button>
        </section>
      ) : null}

      <section className="snapshot-grid" aria-label="Planning snapshot">
        <div>
          <span>Trip window</span>
          <strong>{tripWindowLabel(profile?.travelWindow.start, profile?.travelWindow.end)}</strong>
          <small>
            {profile
              ? `${profile.tripLengthDays} days · ${profile.travelers} travelers`
              : 'Import needed'}
          </small>
        </div>
        <div>
          <span>Points in scope</span>
          <strong>{compactNumber(pointsWallet?.totalPlannedPoints ?? trackedPoints)}</strong>
          <small>{pointAccounts.length} balances</small>
        </div>
        <div>
          <span>Options alive</span>
          <strong>{destinations.filter((item) => item.planningStatus !== 'parked').length}</strong>
          <small>
            {destinations.filter((item) => item.planningStatus === 'shortlist').length} shortlisted
          </small>
        </div>
        <div>
          <span>Research added</span>
          <strong>{researchCount}</strong>
          <small>{hotels.length} hotel leads</small>
        </div>
      </section>

      <div className="overview-grid">
        <section className="panel ranking-panel" aria-labelledby="front-runners-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Right now · {titleCase(mode)}</p>
              <h2 id="front-runners-heading">Front-runners</h2>
            </div>
            <button
              type="button"
              className="text-button"
              onClick={() => onNavigate('destinations')}
            >
              View all {destinations.length} →
            </button>
          </div>
          <div className="ranking-list">
            {ranked.slice(0, 5).map((destination, index) => (
              <button
                type="button"
                key={destination.id}
                className="ranking-row"
                onClick={() => onOpenDestination(destination)}
              >
                <span className="ranking-row__rank">{String(index + 1).padStart(2, '0')}</span>
                <span className="ranking-row__title">
                  <strong>{destination.name}</strong>
                  <small>{destination.tripModes[mode]}</small>
                </span>
                <span className={`status status--${destination.planningStatus}`}>
                  {titleCase(destination.planningStatus)}
                </span>
                <span className="ranking-row__score">
                  <strong>{weightedScore(destination, weights, stylePosition)}</strong>
                  <small>/100</small>
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="panel wallet-panel" aria-labelledby="wallet-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Available currency</p>
              <h2 id="wallet-heading">Points wallet</h2>
            </div>
            <span>{readableDate(pointsWallet?.asOf)}</span>
          </div>
          <div className="wallet-list">
            {pointAccounts.map((account) => (
              <div key={account.currency}>
                <span>
                  {account.currency.replace(' Ultimate Rewards', '').replace(' Rewards', '')}
                </span>
                <strong>{compactNumber(account.points)}</strong>
              </div>
            ))}
          </div>
          {pointsWallet?.excludedFromPlan ? (
            <p className="helper-text">Extra household points remain outside this plan.</p>
          ) : null}
        </section>
      </div>

      <div className="overview-grid overview-grid--lower">
        <TransferCalculator accounts={pointAccounts} paths={transferPaths} />

        <section className="panel hotel-watch" aria-labelledby="hotels-watch-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Award-room watch</p>
              <h2 id="hotels-watch-heading">Hotel leads</h2>
            </div>
            <span>{hotels.length} tracked</span>
          </div>
          <div className="hotel-watch__list">
            {hotels.slice(0, 4).map((hotel) => (
              <button type="button" key={hotel.id} onClick={() => onOpenHotel(hotel)}>
                <span>
                  <strong>{hotel.name}</strong>
                  <small>{hotel.actualRoomHighlight}</small>
                </span>
                <span>{hotel.hotelWow}/5</span>
              </button>
            ))}
          </div>
        </section>
      </div>

      {activity.length > 0 ? (
        <section className="activity-strip" aria-labelledby="activity-heading">
          <div>
            <p className="eyebrow">History stays visible</p>
            <h2 id="activity-heading">Recent movement</h2>
          </div>
          <ol>
            {activity.slice(0, 4).map((item) => (
              <li key={item.id}>
                <span>{item.summary}</span>
                <time>{readableDate(item.createdAt)}</time>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  )
}
