import { useEffect, useState } from 'react'
import type { Destination, Hotel, PlanningStatus, TripMode } from '../../shared'
import { scoreKeys } from '../../shared'
import { scoreLabels, titleCase } from '../planning'

interface DestinationDetailProps {
  destination: Destination
  hotels: Hotel[]
  mode: TripMode
  compared: boolean
  onClose: () => void
  onToggleCompare: () => void
  onSave: (update: {
    isFavorite: boolean
    planningStatus: PlanningStatus
    personalNote: string
    revision: number
  }) => Promise<void>
  onOpenHotel: (hotel: Hotel) => void
}

const statuses: PlanningStatus[] = ['exploring', 'shortlist', 'finalist', 'booked', 'parked']

export function DestinationDetail({
  destination,
  hotels,
  mode,
  compared,
  onClose,
  onToggleCompare,
  onSave,
  onOpenHotel,
}: DestinationDetailProps) {
  const [note, setNote] = useState(destination.personalNote)
  const [status, setStatus] = useState(destination.planningStatus)
  const [favorite, setFavorite] = useState(destination.isFavorite)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setNote(destination.personalNote)
    setStatus(destination.planningStatus)
    setFavorite(destination.isFavorite)
  }, [destination])

  const save = async () => {
    setSaving(true)
    try {
      await onSave({
        isFavorite: favorite,
        planningStatus: status,
        personalNote: note,
        revision: destination.revision,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="drawer-shell" role="presentation">
      <button
        type="button"
        className="drawer-backdrop"
        aria-label="Close details"
        onClick={onClose}
      />
      <aside className="drawer" aria-labelledby="destination-detail-title">
        <div className="drawer__header">
          <div>
            <p className="eyebrow">{destination.region}</p>
            <h2 id="destination-detail-title">{destination.name}</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close details"
          >
            ×
          </button>
        </div>

        <div className="drawer-actions">
          <button
            type="button"
            className={compared ? 'button button--active' : 'button'}
            onClick={onToggleCompare}
          >
            {compared ? 'In comparison' : 'Add to compare'}
          </button>
          <button
            type="button"
            className={favorite ? 'button button--active' : 'button'}
            onClick={() => setFavorite((value) => !value)}
          >
            {favorite ? 'Saved' : 'Save choice'}
          </button>
        </div>

        <section className="detail-section detail-lead">
          <span>{titleCase(mode)} concept</span>
          <p>{destination.tripModes[mode]}</p>
        </section>

        <section className="detail-section">
          <h3>Decision signal</h3>
          <div className="score-grid">
            {scoreKeys.map((key) => (
              <div key={key}>
                <span>{scoreLabels[key]}</span>
                <strong>{destination.scores[key]}</strong>
                <small>/5</small>
              </div>
            ))}
          </div>
        </section>

        <section className="detail-section detail-facts">
          <div>
            <span>Best window</span>
            <strong>{destination.bestWindow}</strong>
          </div>
          <div>
            <span>Expected cash</span>
            <strong>{titleCase(destination.cashLeakage)}</strong>
          </div>
          <p>{destination.weatherNote}</p>
        </section>

        <section className="detail-section">
          <h3>Points paths</h3>
          <div className="tag-list">
            {destination.pointsAngle.map((angle) => (
              <span key={angle}>{angle}</span>
            ))}
          </div>
        </section>

        <section className="detail-section">
          <div className="section-heading section-heading--small">
            <h3>Hotels in the research</h3>
            <span>{hotels.length || 'None yet'}</span>
          </div>
          {hotels.length > 0 ? (
            <div className="hotel-list">
              {hotels.map((hotel) => (
                <button type="button" key={hotel.id} onClick={() => onOpenHotel(hotel)}>
                  <span>
                    <strong>{hotel.name}</strong>
                    <small>{hotel.program}</small>
                  </span>
                  <span className="hotel-list__category">{hotel.awardCategory}</span>
                  <span aria-hidden="true">→</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="empty-copy">No hotel candidates have been attached yet.</p>
          )}
        </section>

        <section className="detail-section planning-note">
          <h3>Your working call</h3>
          <label>
            Status
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as PlanningStatus)}
            >
              {statuses.map((item) => (
                <option key={item} value={item}>
                  {titleCase(item)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Private note
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="What is pulling this option ahead—or holding it back?"
              rows={4}
            />
          </label>
          <button
            type="button"
            className="button button--primary"
            onClick={() => void save()}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save planning note'}
          </button>
        </section>
      </aside>
    </div>
  )
}
