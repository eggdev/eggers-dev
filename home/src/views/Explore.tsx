import { useMemo, useState } from 'react'
import type {
  Destination,
  Experience,
  Hotel,
  PointAccount,
  ResearchSource,
  TransferPath,
} from '../../shared'
import { hotelFundingReadiness, poolWaterFit, titleCase } from '../planning'

interface ExploreProps {
  destinations: Destination[]
  hotels: Hotel[]
  experiences: Experience[]
  sources: ResearchSource[]
  pointAccounts: PointAccount[]
  transferPaths: TransferPath[]
  onOpenHotel: (hotel: Hotel) => void
  onOpenDestination: (destination: Destination) => void
}

const scoreDots = (value: number) => (
  <span className="fit-dots" role="img" aria-label={`${value} out of 5`}>
    {[1, 2, 3, 4, 5].map((dot) => (
      <i key={dot} className={dot <= Math.round(value) ? 'fit-dots__on' : ''} />
    ))}
  </span>
)

export function Explore({
  destinations,
  hotels,
  experiences,
  sources,
  pointAccounts,
  transferPaths,
  onOpenHotel,
  onOpenDestination,
}: ExploreProps) {
  const [destinationId, setDestinationId] = useState('all')
  const [poolFilter, setPoolFilter] = useState('all')
  const [waterFilter, setWaterFilter] = useState('all')
  const [vibeFilter, setVibeFilter] = useState('all')
  const [demandFilter, setDemandFilter] = useState('all')

  const destinationById = useMemo(
    () => new Map(destinations.map((destination) => [destination.id, destination])),
    [destinations]
  )
  const vibeTags = useMemo(
    () =>
      [...new Set(hotels.flatMap((hotel) => hotel.analysis.fit.vibeTags))]
        .filter((tag) => tag.length < 30)
        .sort(),
    [hotels]
  )
  const visibleHotels = useMemo(
    () =>
      hotels
        .filter(
          (hotel) =>
            (destinationId === 'all' || hotel.destinationIds.includes(destinationId)) &&
            (poolFilter === 'all' ||
              hotel.analysis.fit.unitPool === poolFilter ||
              (poolFilter === 'any' && hotel.analysis.fit.unitPool !== 'none')) &&
            (waterFilter === 'all' || hotel.analysis.fit.waterSetting === waterFilter) &&
            (vibeFilter === 'all' || hotel.analysis.fit.vibeTags.includes(vibeFilter))
        )
        .sort(
          (a, b) =>
            poolWaterFit(b) - poolWaterFit(a) ||
            b.analysis.fit.chillScore +
              b.analysis.fit.activityScore -
              (a.analysis.fit.chillScore + a.analysis.fit.activityScore) ||
            b.hotelWow - a.hotelWow
        ),
    [destinationId, hotels, poolFilter, vibeFilter, waterFilter]
  )
  const visibleExperiences = useMemo(
    () =>
      experiences.filter(
        (experience) =>
          (destinationId === 'all' || experience.destinationId === destinationId) &&
          (demandFilter === 'all' || experience.physicalDemand === demandFilter)
      ),
    [demandFilter, destinationId, experiences]
  )

  const rhythmOptions = useMemo(() => {
    const targetDestinations =
      destinationId === 'all'
        ? destinations.filter((destination) =>
            experiences.some((experience) => experience.destinationId === destination.id)
          )
        : destinations.filter((destination) => destination.id === destinationId)
    return targetDestinations
      .map((destination) => {
        const choices = experiences.filter(
          (experience) => experience.destinationId === destination.id
        )
        const chill = [...choices].sort(
          (a, b) => b.chillScore - b.activeScore - (a.chillScore - a.activeScore)
        )[0]
        const active = [...choices].sort(
          (a, b) => b.activeScore - b.chillScore - (a.activeScore - a.chillScore)
        )[0]
        return { destination, chill, active }
      })
      .filter((item) => item.chill && item.active)
  }, [destinationId, destinations, experiences])

  return (
    <div className="view-stack explore-view">
      <header className="view-header">
        <div>
          <p className="eyebrow">Honeymoon / stay + do</p>
          <h1>Find the right kind of days.</h1>
          <p>
            Browse stays and experiences together. Private-pool reality, water setting, energy, and
            funding are all visible before a property earns your attention.
          </p>
        </div>
        <div className="explore-totals">
          <span>
            <strong>{hotels.length}</strong> stays
          </span>
          <span>
            <strong>{experiences.length}</strong> things to do
          </span>
        </div>
      </header>

      <section className="explore-filter panel" aria-label="Stay and activity filters">
        <label>
          Destination
          <select value={destinationId} onChange={(event) => setDestinationId(event.target.value)}>
            <option value="all">Everywhere</option>
            {destinations.map((destination) => (
              <option key={destination.id} value={destination.id}>
                {destination.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Private pool
          <select value={poolFilter} onChange={(event) => setPoolFilter(event.target.value)}>
            <option value="all">Any pool setup</option>
            <option value="standard">In target unit</option>
            <option value="any">Any private-pool option</option>
            <option value="upgrade_only">Upgrade only</option>
            <option value="none">No private pool</option>
          </select>
        </label>
        <label>
          Water
          <select value={waterFilter} onChange={(event) => setWaterFilter(event.target.value)}>
            <option value="all">Any setting</option>
            <option value="beach">Beach / island</option>
            <option value="lake">Lake</option>
            <option value="river">River</option>
            <option value="coast">Coastal outlook</option>
            <option value="none">Inland</option>
          </select>
        </label>
        <label>
          Vibe
          <select value={vibeFilter} onChange={(event) => setVibeFilter(event.target.value)}>
            <option value="all">Every vibe</option>
            {vibeTags.map((tag) => (
              <option key={tag}>{tag}</option>
            ))}
          </select>
        </label>
        <label>
          Activity demand
          <select value={demandFilter} onChange={(event) => setDemandFilter(event.target.value)}>
            <option value="all">Any energy</option>
            <option value="low">Low</option>
            <option value="moderate">Moderate</option>
            <option value="high">High</option>
          </select>
        </label>
      </section>

      <section className="rhythm-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Alternating rhythm</p>
            <h2>One chill day, one active day</h2>
          </div>
          <span>{rhythmOptions.length} destination pairings</span>
        </div>
        <div className="rhythm-strip">
          {rhythmOptions.map(({ destination, chill, active }) => (
            <article key={destination.id}>
              <button type="button" onClick={() => onOpenDestination(destination)}>
                <span>{destination.name}</span>
                <span aria-hidden="true">↗</span>
              </button>
              <div>
                <small>Day 1 · exhale</small>
                <strong>{chill.name}</strong>
                <span>
                  {chill.duration} · {titleCase(chill.physicalDemand)} demand
                </span>
              </div>
              <div>
                <small>Day 2 · go</small>
                <strong>{active.name}</strong>
                <span>
                  {active.duration} · {titleCase(active.physicalDemand)} demand
                </span>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section>
        <div className="section-heading">
          <div>
            <p className="eyebrow">Places to stay</p>
            <h2>{visibleHotels.length} matches</h2>
          </div>
          <span>Ordered by private-pool + water fit</span>
        </div>
        <div className="stay-grid">
          {visibleHotels.map((hotel) => {
            const funding = hotel.analysis.funding
            const readiness = hotelFundingReadiness(hotel, pointAccounts, transferPaths)
            const destination = destinationById.get(hotel.destinationId)
            return (
              <button type="button" key={hotel.id} onClick={() => onOpenHotel(hotel)}>
                <span className={`stay-visual stay-visual--${hotel.analysis.fit.waterSetting}`}>
                  <span>{titleCase(hotel.analysis.fit.waterSetting)}</span>
                  <strong>
                    {hotel.analysis.fit.unitPool === 'standard'
                      ? 'Pool in unit'
                      : hotel.analysis.fit.unitPool === 'upgrade_only'
                        ? 'Pool upgrade'
                        : 'Shared pool / no unit pool'}
                  </strong>
                </span>
                <span className="stay-title">
                  <small>{destination?.name ?? hotel.analysis.location}</small>
                  <strong>{hotel.name}</strong>
                  <span>{hotel.actualRoomHighlight}</span>
                </span>
                <span className="stay-signals">
                  <span>
                    <small>Chill</small>
                    {scoreDots(hotel.analysis.fit.chillScore)}
                  </span>
                  <span>
                    <small>Do</small>
                    {scoreDots(hotel.analysis.fit.activityScore)}
                  </span>
                </span>
                <span className="tag-list tag-list--compact">
                  {hotel.analysis.fit.vibeTags.slice(0, 4).map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </span>
                <span className="stay-funding">
                  <span>
                    <strong>{funding.pointsPercent}%</strong> points ·{' '}
                    <strong>{funding.cashPercent}%</strong> cash
                  </span>
                  <span className={`funding-pill funding-pill--${readiness.state}`}>
                    {readiness.label}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
        {visibleHotels.length === 0 ? (
          <p className="empty-state">No stays match every filter.</p>
        ) : null}
      </section>

      <section>
        <div className="section-heading">
          <div>
            <p className="eyebrow">Things to do</p>
            <h2>{visibleExperiences.length} researched experiences</h2>
          </div>
          <span>Source-backed concepts; live booking still required</span>
        </div>
        <div className="experience-list">
          {visibleExperiences.map((experience) => {
            const source = sources.find((item) => experience.sourceIds.includes(item.id))
            return (
              <article key={experience.id}>
                <div className="experience-title">
                  <small>
                    {destinationById.get(experience.destinationId)?.name} · {experience.category}
                  </small>
                  <strong>{experience.name}</strong>
                  <p>{experience.description}</p>
                </div>
                <div className="experience-meter">
                  <span>
                    <small>Chill</small>
                    {scoreDots(experience.chillScore)}
                  </span>
                  <span>
                    <small>Active</small>
                    {scoreDots(experience.activeScore)}
                  </span>
                </div>
                <dl>
                  <div>
                    <dt>Time</dt>
                    <dd>{experience.duration}</dd>
                  </div>
                  <div>
                    <dt>Demand</dt>
                    <dd>{titleCase(experience.physicalDemand)}</dd>
                  </div>
                  <div>
                    <dt>Cost</dt>
                    <dd>{experience.costBand}</dd>
                  </div>
                  <div>
                    <dt>Best</dt>
                    <dd>{experience.bestTime}</dd>
                  </div>
                </dl>
                <div className="experience-booking">
                  <p>{experience.bookingNote}</p>
                  {source ? (
                    <a href={source.url} target="_blank" rel="noreferrer">
                      Official source ↗
                    </a>
                  ) : null}
                </div>
              </article>
            )
          })}
        </div>
      </section>
    </div>
  )
}
