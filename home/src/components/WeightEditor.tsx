import type { ScoreKey, ScoringSchema } from '../../shared'

interface WeightEditorProps {
  schema: ScoringSchema
  weights: Record<ScoreKey, number>
  onChange: (weights: Record<ScoreKey, number>) => void
  onReset: () => void
}

export function WeightEditor({ schema, weights, onChange, onReset }: WeightEditorProps) {
  return (
    <details className="weight-editor">
      <summary>
        <span>Tune ranking weights</span>
        <small>{Object.values(weights).reduce((sum, value) => sum + value, 0)} total</small>
      </summary>
      <div className="weight-editor__body">
        {schema.dimensions.map((dimension) => (
          <label key={dimension.key} title={dimension.description}>
            <span>{dimension.label}</span>
            <input
              type="range"
              min="0"
              max="30"
              step="1"
              value={weights[dimension.key]}
              onChange={(event) =>
                onChange({ ...weights, [dimension.key]: Number(event.target.value) })
              }
            />
            <strong>{weights[dimension.key]}</strong>
          </label>
        ))}
        <button type="button" className="text-button" onClick={onReset}>
          Reset handoff defaults
        </button>
      </div>
    </details>
  )
}
