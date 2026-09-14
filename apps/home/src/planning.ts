import type { Destination, Hotel, PointAccount, ScoreKey, TransferPath, TripMode } from '@repo/home'

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

const requiredHotelCoverage: Record<string, Array<{ key: string; label: string }>> = {
  'bali-indonesia': [
    { key: 'inland', label: 'Ubud / inland' },
    { key: 'adventure', label: 'Komodo / adventure' },
    { key: 'beach', label: 'Bali beach finish' },
  ],
  maldives: [{ key: 'resort', label: 'Island resort' }],
  seychelles: [
    { key: 'mahe', label: 'Mahé' },
    { key: 'praslin', label: 'Praslin' },
    { key: 'private-island', label: 'Private-island finish' },
  ],
  'thailand-islands': [
    { key: 'city', label: 'Bangkok / city' },
    { key: 'island', label: 'Island resort' },
  ],
  'french-polynesia': [
    { key: 'arrival', label: 'Tahiti arrival' },
    { key: 'moorea', label: 'Moorea' },
    { key: 'bora-bora', label: 'Bora Bora finish' },
  ],
  fiji: [
    { key: 'main-island', label: 'Main island' },
    { key: 'outer-island', label: 'Outer island' },
  ],
  mauritius: [{ key: 'resort', label: 'Coastal resort' }],
  'oman-maldives': [
    { key: 'oman', label: 'Oman' },
    { key: 'maldives', label: 'Maldives finish' },
  ],
  'south-africa-indian-ocean': [
    { key: 'cape', label: 'Cape Town / wine' },
    { key: 'safari', label: 'Safari' },
    { key: 'island-finish', label: 'Indian Ocean finish' },
  ],
  mediterranean: [
    { key: 'culture', label: 'Culture / food base' },
    { key: 'coast', label: 'Coastal resort' },
  ],
  hawaii: [
    { key: 'maui', label: 'Maui' },
    { key: 'kauai', label: 'Kauaʻi' },
  ],
  'mexico-caribbean': [
    { key: 'mexico', label: 'Mexico' },
    { key: 'caribbean', label: 'Caribbean benchmark' },
  ],
  'costa-rica': [
    { key: 'rainforest', label: 'Rainforest / hot springs' },
    { key: 'beach', label: 'Pacific coast' },
  ],
  'mendoza-wine-country': [
    { key: 'city', label: 'Mendoza / Chacras' },
    { key: 'wine-estate', label: 'Vineyard stay' },
  ],
  'porto-douro': [
    { key: 'porto', label: 'Porto' },
    { key: 'douro', label: 'Douro Valley' },
  ],
  'italian-lakes': [
    { key: 'lakefront', label: 'Lakefront stay' },
    { key: 'points', label: 'Points option' },
  ],
  'adriatic-montenegro-croatia': [
    { key: 'boka', label: 'Bay of Kotor' },
    { key: 'island', label: 'Croatian island' },
  ],
  sicily: [
    { key: 'etna', label: 'Etna / wine' },
    { key: 'coast', label: 'Coastal finish' },
  ],
  morocco: [
    { key: 'marrakech', label: 'Marrakech' },
    { key: 'atlas', label: 'Atlas Mountains' },
  ],
  belize: [
    { key: 'jungle', label: 'Jungle' },
    { key: 'reef', label: 'Reef / island' },
  ],
}

export const poolWaterFit = (hotel: Hotel): number => {
  if (hotel.analysis.fit.unitPool === 'standard') return 5
  if (hotel.analysis.fit.unitPool === 'upgrade_only') return 4
  if (hotel.analysis.fit.waterSetting === 'beach' || hotel.analysis.fit.waterSetting === 'lake') {
    return 3.5
  }
  if (hotel.analysis.fit.waterSetting === 'river' || hotel.analysis.fit.waterSetting === 'coast') {
    return 2.5
  }
  return 1
}

export interface HotelCoverage {
  complete: boolean
  candidateCount: number
  researchedCount: number
  requiredCount: number
  covered: string[]
  missing: string[]
}

export const hotelsForDestination = (hotels: Hotel[], destinationId: string): Hotel[] =>
  hotels.filter((hotel) => hotel.destinationIds.includes(destinationId))

export const hotelCoverage = (destination: Destination, hotels: Hotel[]): HotelCoverage => {
  const candidates = hotelsForDestination(hotels, destination.id)
  const researched = candidates.filter((hotel) => hotel.analysis.status === 'decision_ready')
  const requirements = requiredHotelCoverage[destination.id] ?? []
  const covered = requirements
    .filter((requirement) =>
      researched.some((hotel) => hotel.coverageTags.includes(requirement.key))
    )
    .map((requirement) => requirement.label)
  const missing = requirements
    .filter(
      (requirement) => !researched.some((hotel) => hotel.coverageTags.includes(requirement.key))
    )
    .map((requirement) => requirement.label)
  return {
    complete: researched.length >= 3 && missing.length === 0,
    candidateCount: candidates.length,
    researchedCount: researched.length,
    requiredCount: requirements.length,
    covered,
    missing,
  }
}

export const rankableScore = (
  destination: Destination,
  hotels: Hotel[],
  weights: Record<ScoreKey, number>,
  stylePosition: number
): number | undefined =>
  hotelCoverage(destination, hotels).complete
    ? weightedScore(destination, weights, stylePosition)
    : undefined

export const compactNumber = (value: number): string =>
  new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value)

export type FundingReadinessState =
  | 'fully_fundable'
  | 'low_end_only'
  | 'split_required'
  | 'insufficient'
  | 'cash_first'
  | 'unreliable'

export interface FundingReadiness {
  state: FundingReadinessState
  label: string
  availablePoints: number
  fullAwardCoveragePercent: number
  plannedPointsLow: number
  plannedPointsHigh: number
  plannedShareCovered: boolean
}

const transferRatio = (
  path: TransferPath,
  source: PointAccount,
  targetProgram: string
): { numerator: number; denominator: number } => {
  if (source.currency !== 'Chase Ultimate Rewards' || targetProgram !== 'World of Hyatt') {
    return { numerator: path.numerator, denominator: path.denominator }
  }
  const deadline = getHyattTransferDeadline([source])
  if (!deadline || daysUntil(deadline.through) >= 0) {
    return { numerator: path.numerator, denominator: path.denominator }
  }
  const [numerator, denominator] = deadline.after
    .split(':')
    .map((value) => Number.parseInt(value, 10))
  return numerator > 0 && denominator > 0
    ? { numerator, denominator }
    : { numerator: path.numerator, denominator: path.denominator }
}

export const hotelFundingReadiness = (
  hotel: Hotel,
  accounts: PointAccount[],
  paths: TransferPath[]
): FundingReadiness => {
  const plan = hotel.analysis.funding
  const availablePoints = plan.transferSources.reduce((total, sourceCurrency) => {
    const account = accounts.find((item) => item.currency === sourceCurrency)
    const path = paths.find(
      (item) =>
        item.sourceCurrency === sourceCurrency && item.destinationProgram === plan.targetProgram
    )
    if (!account || !path) return total
    const ratio = transferRatio(path, account, plan.targetProgram)
    return total + Math.floor((account.points * ratio.denominator) / ratio.numerator)
  }, 0)
  const plannedPointsLow = Math.ceil((plan.pointsLow * plan.pointsPercent) / 100)
  const plannedPointsHigh = Math.ceil((plan.pointsHigh * plan.pointsPercent) / 100)
  const fullAwardCoveragePercent =
    plan.pointsHigh > 0 ? Math.min(100, Math.floor((availablePoints / plan.pointsHigh) * 100)) : 0
  const plannedShareCovered = plannedPointsHigh === 0 || availablePoints >= plannedPointsHigh

  let state: FundingReadinessState
  if (plan.awardReliability === 'not_reliable') state = 'unreliable'
  else if (plan.mode === 'cash' || plan.awardReliability === 'cash_only') state = 'cash_first'
  else if (plan.mode === 'split') state = 'split_required'
  else if (availablePoints >= plan.pointsHigh) state = 'fully_fundable'
  else if (availablePoints >= plan.pointsLow) state = 'low_end_only'
  else state = 'insufficient'

  const label: Record<FundingReadinessState, string> = {
    fully_fundable: 'Wallet covers estimate',
    low_end_only: 'Only fundable at low end',
    split_required: plannedShareCovered
      ? 'Planned points + cash split'
      : 'Planned split still short',
    insufficient: 'Wallet short for points plan',
    cash_first: 'Cash-first recommendation',
    unreliable: 'Award not reliable enough',
  }

  return {
    state,
    label: label[state],
    availablePoints,
    fullAwardCoveragePercent,
    plannedPointsLow,
    plannedPointsHigh,
    plannedShareCovered,
  }
}

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
