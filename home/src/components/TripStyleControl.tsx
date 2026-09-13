import { styleLabel } from '../planning'

interface TripStyleControlProps {
  value: number
  onChange: (value: number) => void
  compact?: boolean
}

export function TripStyleControl({ value, onChange, compact = false }: TripStyleControlProps) {
  return (
    <div className={compact ? 'style-control style-control--compact' : 'style-control'}>
      <div className="style-control__header">
        <label htmlFor={compact ? 'trip-style-compact' : 'trip-style'}>Trip rhythm</label>
        <strong>{styleLabel(value)}</strong>
      </div>
      <div className="range-wrap">
        <input
          id={compact ? 'trip-style-compact' : 'trip-style'}
          type="range"
          min="0"
          max="100"
          step="1"
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </div>
      <div className="range-labels" aria-hidden="true">
        <span>Exhale</span>
        <span>Mix it up</span>
        <span>Explore</span>
      </div>
    </div>
  )
}
