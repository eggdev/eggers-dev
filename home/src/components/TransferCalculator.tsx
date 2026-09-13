import { useMemo, useState } from 'react'
import type { PointAccount, TransferPath } from '../../shared'
import { compactNumber, daysUntil, getHyattTransferDeadline, readableDate } from '../planning'

interface TransferCalculatorProps {
  accounts: PointAccount[]
  paths: TransferPath[]
}

export function TransferCalculator({ accounts, paths }: TransferCalculatorProps) {
  const sources = [...new Set(paths.map((path) => path.sourceCurrency))]
  const [source, setSource] = useState(sources[0] ?? '')
  const availablePaths = useMemo(
    () => paths.filter((path) => path.sourceCurrency === source),
    [paths, source]
  )
  const [programId, setProgramId] = useState('')
  const [amount, setAmount] = useState(100_000)
  const selected = availablePaths.find((path) => path.id === programId) ?? availablePaths[0]
  const account = accounts.find((item) => item.currency === source)
  const hyattDeadline = getHyattTransferDeadline(accounts)
  const isHyattDeadline =
    Boolean(hyattDeadline) &&
    source === 'Chase Ultimate Rewards' &&
    selected?.destinationProgram === 'World of Hyatt'
  const deadlinePassed = Boolean(hyattDeadline && daysUntil(hyattDeadline.through) < 0)
  const recordedRatio = isHyattDeadline
    ? deadlinePassed
      ? hyattDeadline?.after
      : hyattDeadline?.rate
    : undefined
  const parsedRatio = recordedRatio?.split(':').map((value) => Number.parseInt(value, 10))
  const numerator = parsedRatio?.[0] || selected?.numerator || 1
  const denominator = parsedRatio?.[1] || selected?.denominator || 1
  const result = selected ? Math.floor((amount * denominator) / numerator) : 0

  return (
    <section className="panel transfer-panel" aria-labelledby="transfer-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">What-if tool</p>
          <h2 id="transfer-heading">Transfer calculator</h2>
        </div>
        <span className="warning-pill">Transfers are final</span>
      </div>
      <div className="transfer-grid">
        <label>
          From
          <select
            value={source}
            onChange={(event) => {
              setSource(event.target.value)
              setProgramId('')
            }}
          >
            {sources.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <label>
          To
          <select value={selected?.id ?? ''} onChange={(event) => setProgramId(event.target.value)}>
            {availablePaths.map((path) => (
              <option key={path.id} value={path.id}>
                {path.destinationProgram}
              </option>
            ))}
          </select>
        </label>
        <label>
          Points to move
          <input
            type="number"
            min="0"
            max={account?.points ?? 0}
            step="1000"
            value={amount}
            onChange={(event) => setAmount(Math.max(0, Number(event.target.value)))}
          />
        </label>
        <div className="transfer-result">
          <span>Receives</span>
          <strong>{compactNumber(result)}</strong>
          <small>
            {selected ? `${numerator}:${denominator}` : '—'} into{' '}
            {selected?.destinationProgram ?? 'a program'}
          </small>
        </div>
      </div>
      {amount > (account?.points ?? 0) ? (
        <p className="field-error">That is more than the current {source} balance.</p>
      ) : null}
      {isHyattDeadline ? (
        <p className="deadline-note">
          {deadlinePassed ? (
            <>
              This models the handoff’s recorded post-deadline rate of {hyattDeadline?.after}.
              Verify the current terms before moving anything.
            </>
          ) : (
            <>
              This models the recorded {hyattDeadline?.rate} rate through{' '}
              {readableDate(hyattDeadline?.through)}. After that, the handoff reports{' '}
              {hyattDeadline?.after}. Verify the award before moving anything.
            </>
          )}
        </p>
      ) : (
        <p className="helper-text">{selected?.note}</p>
      )}
    </section>
  )
}
