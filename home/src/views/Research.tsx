import { useState } from 'react'
import type {
  Confidence,
  Destination,
  Hotel,
  ResearchEntry,
  ResearchEntryInput,
  ResearchSource,
} from '../../shared'
import { confidenceLabel, readableDate } from '../planning'

interface ResearchProps {
  entries: ResearchEntry[]
  sources: ResearchSource[]
  destinations: Destination[]
  hotels: Hotel[]
  sourceDate?: string
  onCreate: (entry: ResearchEntryInput) => Promise<void>
}

const confidenceOptions: Confidence[] = [
  'needs_live_verification',
  'estimate',
  'source_backed_general',
  'verified_current',
]

export function Research({
  entries,
  sources,
  destinations,
  hotels,
  sourceDate,
  onCreate,
}: ResearchProps) {
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)

  const create = async (form: HTMLFormElement) => {
    const data = new FormData(form)
    const related = String(data.get('related') ?? '')
    const [entityType, entityId] = related ? related.split(':', 2) : ['general', undefined]
    setSaving(true)
    try {
      await onCreate({
        entityType: entityType as ResearchEntryInput['entityType'],
        entityId,
        title: String(data.get('title') ?? ''),
        summary: String(data.get('summary') ?? ''),
        sourceUrl: String(data.get('sourceUrl') ?? '') || undefined,
        verifiedAt: String(data.get('verifiedAt') ?? '') || undefined,
        confidence: String(data.get('confidence')) as Confidence,
      })
      form.reset()
      setShowForm(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="view-stack">
      <header className="view-header">
        <div>
          <p className="eyebrow">Honeymoon / research</p>
          <h1>Grow the evidence, not the prose.</h1>
          <p>Each finding keeps its source, verification date, confidence, and relationship.</p>
        </div>
        <button
          type="button"
          className="button button--primary"
          onClick={() => setShowForm((value) => !value)}
        >
          {showForm ? 'Close form' : 'Add finding'}
        </button>
      </header>

      {showForm ? (
        <form
          className="research-form panel"
          onSubmit={(event) => {
            event.preventDefault()
            void create(event.currentTarget)
          }}
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">Additive history</p>
              <h2>Record a finding</h2>
            </div>
            <span>Nothing is silently overwritten</span>
          </div>
          <div className="form-grid">
            <label className="span-2">
              Title
              <input
                name="title"
                required
                maxLength={200}
                placeholder="Spring award calendar opened"
              />
            </label>
            <label>
              Related to
              <select name="related" defaultValue="">
                <option value="">General research</option>
                <optgroup label="Destinations">
                  {destinations.map((destination) => (
                    <option key={destination.id} value={`destination:${destination.id}`}>
                      {destination.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Hotels">
                  {hotels.map((hotel) => (
                    <option key={hotel.id} value={`hotel:${hotel.id}`}>
                      {hotel.name}
                    </option>
                  ))}
                </optgroup>
              </select>
            </label>
            <label>
              Confidence
              <select name="confidence" defaultValue="needs_live_verification">
                {confidenceOptions.map((confidence) => (
                  <option key={confidence} value={confidence}>
                    {confidenceLabel(confidence)}
                  </option>
                ))}
              </select>
            </label>
            <label className="span-2">
              Finding
              <textarea
                name="summary"
                required
                maxLength={5000}
                rows={4}
                placeholder="Capture the decision-relevant fact, not the whole article."
              />
            </label>
            <label>
              Source URL
              <input name="sourceUrl" type="url" placeholder="https://…" />
            </label>
            <label>
              Verified on
              <input name="verifiedAt" type="date" />
            </label>
          </div>
          <div className="form-actions">
            <p>Use “verified current” only for date-specific facts checked directly.</p>
            <button type="submit" className="button button--primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save finding'}
            </button>
          </div>
        </form>
      ) : null}

      <section className="research-summary">
        <div>
          <span>Handoff baseline</span>
          <strong>{readableDate(sourceDate)}</strong>
        </div>
        <div>
          <span>Baseline sources</span>
          <strong>{sources.length}</strong>
        </div>
        <div>
          <span>New findings</span>
          <strong>{entries.length}</strong>
        </div>
        <div>
          <span>Needs live check</span>
          <strong>
            {entries.filter((entry) => entry.confidence === 'needs_live_verification').length +
              hotels.filter((hotel) => hotel.awardCategory.toLowerCase().includes('needs')).length}
          </strong>
        </div>
      </section>

      <div className="research-layout">
        <section className="panel" aria-labelledby="research-feed-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Since the handoff</p>
              <h2 id="research-feed-heading">Research log</h2>
            </div>
          </div>
          {entries.length > 0 ? (
            <div className="research-feed">
              {entries.map((entry) => (
                <article key={entry.id}>
                  <div>
                    <span className={`confidence confidence--${entry.confidence}`}>
                      {confidenceLabel(entry.confidence)}
                    </span>
                    <time>{readableDate(entry.verifiedAt ?? entry.createdAt)}</time>
                  </div>
                  <h3>{entry.title}</h3>
                  <p>{entry.summary}</p>
                  {entry.sourceUrl ? (
                    <a href={entry.sourceUrl} target="_blank" rel="noreferrer">
                      Open source ↗
                    </a>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-copy empty-copy--roomy">
              <strong>The baseline is loaded.</strong>
              <p>Add the next live award check here so its date and confidence remain visible.</p>
            </div>
          )}
        </section>

        <section className="panel" aria-labelledby="source-ledger-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Baseline</p>
              <h2 id="source-ledger-heading">Source ledger</h2>
            </div>
            <span>{sources.length}</span>
          </div>
          <div className="source-list">
            {sources.map((source) => (
              <a key={source.id} href={source.url} target="_blank" rel="noreferrer">
                <span>{source.publisher}</span>
                <strong>{source.title}</strong>
                <small>
                  {source.supports.length} supported facts · {readableDate(source.retrieved)}
                </small>
              </a>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
