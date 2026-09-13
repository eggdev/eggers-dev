export const scoreKeys = [
  'points_fit',
  'beach_water',
  'food',
  'relaxation',
  'adventure',
  'spring_weather',
  'hotel_wow',
  'cash_efficiency',
  'logistics_ease',
] as const

export type ScoreKey = (typeof scoreKeys)[number]
export type Scores = Record<ScoreKey, number>
export type TripMode = 'relaxing' | 'balanced' | 'active'
export type PlanningStatus = 'exploring' | 'shortlist' | 'finalist' | 'booked' | 'parked'
export type Confidence =
  | 'verified_current'
  | 'source_backed_general'
  | 'estimate'
  | 'needs_live_verification'

export interface Destination {
  id: string
  name: string
  region: string
  scores: Scores
  cashLeakage: string
  bestWindow: string
  weatherNote: string
  pointsAngle: string[]
  tripModes: Record<TripMode, string>
  seedNotes: string
  sourceIds: string[]
  isFavorite: boolean
  planningStatus: PlanningStatus
  personalNote: string
  revision: number
  updatedAt: string
}

export interface Hotel {
  id: string
  name: string
  destinationId: string
  destinationIds: string[]
  program: string
  awardCategory: string
  actualRoomHighlight: string
  roomFacts: Record<string, string | number | boolean>
  hotelWow: number
  pointsNote: string
  coverageTags: string[]
  analysis: HotelAnalysis
  imageStrategy: {
    status: string
    officialRoomPage?: string
    officialSourcePage?: string
    searchQuery?: string
  }
  sourceIds: string[]
  updatedAt: string
}

export type HotelResearchStatus = 'decision_ready' | 'booking_check_needed'
export type HotelFundingMode = 'points' | 'split' | 'cash'
export type AwardReliability = 'date_dependent' | 'fixed_value' | 'not_reliable' | 'cash_only'

export interface HotelFundingPlan {
  mode: HotelFundingMode
  pointsPercent: number
  cashPercent: number
  assumedNights: number
  pointsLow: number
  pointsHigh: number
  targetProgram: string
  transferSources: string[]
  awardReliability: AwardReliability
  estimateBasis: string
  recommendation: string
}

export interface HotelAnalysis {
  status: HotelResearchStatus
  location: string
  stayRole: string
  standardAwardRoom: string
  pricingModel: string
  availability: string
  transferPath: string
  inclusions: string[]
  unavoidableCash: string[]
  mealPlan: string
  resortFee: string
  access: string
  upgradePath: string
  bestFor: string
  tradeoffs: string[]
  activities: string[]
  verifiedAt: string
  funding: HotelFundingPlan
}

export interface ResearchSource {
  id: string
  title: string
  publisher: string
  url: string
  retrieved: string
  supports: string[]
}

export interface PointAccount {
  currency: string
  points: number
  metadata: Record<string, unknown>
}

export interface TransferPath {
  id: string
  sourceCurrency: string
  destinationProgram: string
  numerator: number
  denominator: number
  note: string
  sourceId?: string
}

export interface ResearchEntry {
  id: string
  entityType: 'general' | 'destination' | 'hotel' | 'flight' | 'trip'
  entityId?: string
  title: string
  summary: string
  sourceUrl?: string
  verifiedAt?: string
  confidence: Confidence
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface ActivityItem {
  id: string
  action: string
  entityType: string
  entityId?: string
  summary: string
  actorEmail: string
  createdAt: string
}

export interface ScoreDimension {
  key: ScoreKey
  label: string
  description: string
}

export interface ScoringSchema {
  scale: string
  dimensions: ScoreDimension[]
  defaultWeightingPercent: Record<ScoreKey, number>
  specialViews: string[]
  confidenceLevels: Confidence[]
}

export interface TravelWindow {
  start: string
  end: string
  mustBeHome: Array<{ start: string; end: string }>
  interpretation: string
}

export interface TravelerProfile {
  project: string
  travelers: number
  homeBase: string
  tripLengthDays: number
  travelWindow: TravelWindow
}

export interface PointsWallet {
  asOf: string
  owner: string
  totalPlannedPoints: number
  excludedFromPlan: string
  strategy: string[]
}

export interface AppPreferences {
  stylePosition: number
  weights: Record<ScoreKey, number>
  updatedAt?: string
}

export interface BootstrapPayload {
  identity: { email: string; local: boolean }
  seeded: boolean
  latestResearchRun?: { id: string; sourceDate: string; importedAt: string }
  travelerProfile?: TravelerProfile
  pointsWallet?: PointsWallet
  scoringSchema?: ScoringSchema
  destinations: Destination[]
  hotels: Hotel[]
  sources: ResearchSource[]
  pointAccounts: PointAccount[]
  transferPaths: TransferPath[]
  researchEntries: ResearchEntry[]
  activity: ActivityItem[]
  preferences?: AppPreferences
}

export interface DestinationPlanningUpdate {
  isFavorite: boolean
  planningStatus: PlanningStatus
  personalNote: string
  revision: number
}

export interface ResearchEntryInput {
  entityType: ResearchEntry['entityType']
  entityId?: string
  title: string
  summary: string
  sourceUrl?: string
  verifiedAt?: string
  confidence: Confidence
}

export interface ApiErrorPayload {
  error: string
  details?: string[]
}
