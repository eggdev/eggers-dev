import type { Destination, PointAccount, ScoreKey, TripMode } from '../shared'

export const scoreLabels: Record<ScoreKey, string> = {
  points_fit: 'Points',
  beach_water: 'Water',
  food: 'Food',
  relaxation: 'Rest',
  adventure: 'Active',
  spring_weather: 'Weather',
  hotel_wow: 'Hotels',
  cash_efficiency: 'Cash',
  logistics_ease: 'Logistics',
}

export const styleMode = (position: number): TripMode => {
  if (position < 34) return 'relaxing'
  if (position > 66) return 'active'
  return 'balanced'
}

export const styleLabel = (position: number): string => {
  const mode = styleMode(position)
  return mode === 'relaxing' ? 'Relaxing first' : mode === 'active' ? 'Active first' : 'Balanced'
}

export const weightedScore = (
  destination: Destination,
  weights: Record<ScoreKey, number>,
  stylePosition: number
): number => {
  const effectiveWeights = { ...weights }
  const bias = (stylePosition - 50) / 50
  effectiveWeights.adventure += Math.max(0, bias) * 12
  effectiveWeights.relaxation += Math.max(0, -bias) * 12
  const totalWeight = Object.values(effectiveWeights).reduce((total, weight) => total + weight, 0)
  const weighted = Object.entries(effectiveWeights).reduce(
    (total, [key, weight]) => total + destination.scores[key as ScoreKey] * weight,
    0
  )
  return Math.round((weighted / totalWeight / 5) * 100)
}

export const compactNumber = (value: number): string =>
  new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value)

export const readableDate = (value?: string): string => {
  if (!value) return 'Not recorded'
  const date = new Date(`${value.length === 10 ? `${value}T12:00:00` : value}`)
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(
        date
      )
}

export interface HyattTransferDeadline {
  through: string
  rate: string
  after: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const getHyattTransferDeadline = (
  accounts: PointAccount[]
): HyattTransferDeadline | undefined => {
  for (const account of accounts) {
    const deadline = account.metadata.hyatt_transfer_deadline
    if (
      isRecord(deadline) &&
      typeof deadline.through === 'string' &&
      typeof deadline.rate === 'string' &&
      typeof deadline.after === 'string'
    ) {
      return { through: deadline.through, rate: deadline.rate, after: deadline.after }
    }
  }
  return undefined
}

export const tripWindowLabel = (start?: string, end?: string): string => {
  if (!start || !end) return 'Planning window'
  const startDate = new Date(`${start}T12:00:00`)
  const endDate = new Date(`${end}T12:00:00`)
  if (Number.isNaN(startDate.valueOf()) || Number.isNaN(endDate.valueOf())) {
    return 'Planning window'
  }
  const month = new Intl.DateTimeFormat('en-US', { month: 'short' })
  return `${month.format(startDate)}–${month.format(endDate)} ’${String(endDate.getFullYear()).slice(-2)}`
}

export const daysUntil = (value: string): number => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(`${value}T00:00:00`)
  return Math.ceil((target.valueOf() - today.valueOf()) / 86_400_000)
}

export const confidenceLabel = (value: string): string =>
  value
    .replace('verified_current', 'Verified current')
    .replace('source_backed_general', 'Source-backed')
    .replace('needs_live_verification', 'Needs live check')
    .replace('estimate', 'Estimate')

export const titleCase = (value: string): string =>
  value.replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase())
