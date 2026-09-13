import type { Hotel, ResearchSource } from '../../shared'
import { titleCase } from '../planning'

interface HotelDetailProps {
  hotel: Hotel
  sources: ResearchSource[]
  onClose: () => void
}

export function HotelDetail({ hotel, sources, onClose }: HotelDetailProps) {
  const hotelSources = sources.filter((source) => hotel.sourceIds.includes(source.id))
  const officialPage =
    hotel.imageStrategy.officialRoomPage ?? hotel.imageStrategy.officialSourcePage

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
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close hotel">
            ×
          </button>
        </div>

        <div className="room-image-placeholder">
          <span>Exact room imagery is not stored yet</span>
          <strong>{hotel.actualRoomHighlight}</strong>
          {officialPage ? (
            <a href={officialPage} target="_blank" rel="noreferrer">
              Open official room page ↗
            </a>
          ) : null}
        </div>

        <section className="detail-section detail-facts">
          <div>
            <span>Award category</span>
            <strong>{hotel.awardCategory}</strong>
          </div>
          <div>
            <span>Hotel wow</span>
            <strong>{hotel.hotelWow}/5</strong>
          </div>
          <p>{hotel.pointsNote}</p>
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

        <section className="detail-section verification-grid">
          <h3>Still needed before transfer</h3>
          <span>Exact dates</span>
          <span>Standard award room</span>
          <span>Points price</span>
          <span>Same-room cash rate</span>
          <span>Mandatory transfers</span>
          <span>Food and breakfast</span>
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
