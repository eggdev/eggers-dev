import {
  type ActivityItem,
  type AppPreferences,
  type AwardReliability,
  type BootstrapPayload,
  type Confidence,
  type Destination,
  type DestinationPlanningUpdate,
  type Hotel,
  type HotelFundingMode,
  type PlanningStatus,
  type PointAccount,
  type PointsWallet,
  type ResearchEntry,
  type ResearchEntryInput,
  type ResearchSource,
  type ScoreKey,
  type Scores,
  type ScoringSchema,
  scoreKeys,
  type TransferPath,
  type TravelerProfile,
  type TripMode,
} from '../shared'
import type { HomeIdentity } from './auth'

interface StateRow {
  key: string
  value_json: string
}

interface DestinationRow {
  id: string
  name: string
  region: string
  scores_json: string
  cash_leakage: string
  best_window: string
  weather_note: string
  points_angle_json: string
  trip_modes_json: string
  seed_notes: string
  source_ids_json: string
  is_favorite: number
  planning_status: string
  personal_note: string
  revision: number
  updated_at: string
}

interface HotelRow {
  id: string
  name: string
  destination_id: string
  program: string
  award_category: string
  actual_room_highlight: string
  room_facts_json: string
  hotel_wow: number
  points_note: string
  image_strategy_json: string
  source_ids_json: string
  analysis_json: string
  coverage_tags_json: string
  updated_at: string
}

interface HotelDestinationLinkRow {
  hotel_id: string
  destination_id: string
}

interface SourceRow {
  id: string
  title: string
  publisher: string
  url: string
  retrieved: string
  supports_json: string
}

interface PointAccountRow {
  currency: string
  points: number
  metadata_json: string
}

interface TransferPathRow {
  id: string
  source_currency: string
  destination_program: string
  numerator: number
  denominator: number
  note: string
  source_id: string | null
}

interface ResearchEntryRow {
  id: string
  entity_type: string
  entity_id: string | null
  title: string
  summary: string
  source_url: string | null
  verified_at: string | null
  confidence: string
  created_by: string
  created_at: string
  updated_at: string
}

interface ActivityRow {
  id: string
  action: string
  entity_type: string
  entity_id: string | null
  summary: string
  actor_email: string
  created_at: string
}

interface PreferenceRow {
  style_position: number
  weights_json: string
  updated_at: string
}

interface ResearchRunRow {
  id: string
  source_date: string
  imported_at: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const parseJson = (value: string): unknown => {
  try {
    return JSON.parse(value)
  } catch {
    throw new Error('Stored Home data is malformed')
  }
}

const stringArray = (value: string): string[] => {
  const parsed = parseJson(value)
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === 'string')
    : []
}

const scores = (value: string): Scores => {
  const parsed = parseJson(value)
  if (!isRecord(parsed) || !scoreKeys.every((key) => typeof parsed[key] === 'number')) {
    throw new Error('Stored destination scores are malformed')
  }
  return Object.fromEntries(scoreKeys.map((key) => [key, parsed[key]])) as Scores
}

const weights = (value: string): Record<ScoreKey, number> => {
  const parsed = parseJson(value)
  if (!isRecord(parsed) || !scoreKeys.every((key) => typeof parsed[key] === 'number')) {
    throw new Error('Stored score weights are malformed')
  }
  return Object.fromEntries(scoreKeys.map((key) => [key, parsed[key]])) as Record<ScoreKey, number>
}

const tripModes = (value: string): Record<TripMode, string> => {
  const parsed = parseJson(value)
  if (
    !isRecord(parsed) ||
    typeof parsed.relaxing !== 'string' ||
    typeof parsed.balanced !== 'string' ||
    typeof parsed.active !== 'string'
  ) {
    throw new Error('Stored itinerary modes are malformed')
  }
  return { relaxing: parsed.relaxing, balanced: parsed.balanced, active: parsed.active }
}

const simpleRecord = (value: string): Record<string, string | number | boolean> => {
  const parsed = parseJson(value)
  if (!isRecord(parsed)) return {}
  return Object.fromEntries(
    Object.entries(parsed).filter((entry): entry is [string, string | number | boolean] =>
      ['string', 'number', 'boolean'].includes(typeof entry[1])
    )
  )
}

const unknownRecord = (value: string): Record<string, unknown> => {
  const parsed = parseJson(value)
  return isRecord(parsed) ? parsed : {}
}

const imageStrategy = (value: string): Hotel['imageStrategy'] => {
  const parsed = parseJson(value)
  if (!isRecord(parsed) || typeof parsed.status !== 'string') return { status: 'needs_fetch' }
  return {
    status: parsed.status,
    officialRoomPage:
      typeof parsed.official_room_page === 'string' ? parsed.official_room_page : undefined,
    officialSourcePage:
      typeof parsed.official_source_page === 'string' ? parsed.official_source_page : undefined,
    searchQuery: typeof parsed.search_query === 'string' ? parsed.search_query : undefined,
  }
}

const hotelAnalysis = (value: string): Hotel['analysis'] => {
  const parsed = parseJson(value)
  if (!isRecord(parsed)) throw new Error('Stored hotel analysis is malformed')
  const array = (key: string): string[] => {
    const item = parsed[key]
    return Array.isArray(item)
      ? item.filter((entry): entry is string => typeof entry === 'string')
      : []
  }
  const text = (key: string, fallback: string): string =>
    typeof parsed[key] === 'string' ? parsed[key] : fallback
  const funding = isRecord(parsed.funding) ? parsed.funding : {}
  const fundingText = (key: string, fallback: string): string =>
    typeof funding[key] === 'string' ? funding[key] : fallback
  const fundingNumber = (key: string, fallback: number): number =>
    typeof funding[key] === 'number' && Number.isFinite(funding[key]) ? funding[key] : fallback
  const fundingMode = fundingText('mode', 'cash')
  const awardReliability = fundingText('award_reliability', 'cash_only')
  const fundingSources = Array.isArray(funding.transfer_sources)
    ? funding.transfer_sources.filter((entry): entry is string => typeof entry === 'string')
    : []
  return {
    status: parsed.status === 'decision_ready' ? 'decision_ready' : 'booking_check_needed',
    location: text('location', 'Location not yet researched'),
    stayRole: text('stay_role', 'Hotel candidate'),
    standardAwardRoom: text('standard_award_room', 'Confirm in the live booking flow'),
    pricingModel: text('pricing_model', 'Confirm in the live booking flow'),
    availability: text('availability', 'Date-dependent; run after selecting dates'),
    transferPath: text('transfer_path', 'No transferable-points path recorded'),
    inclusions: array('inclusions'),
    unavoidableCash: array('unavoidable_cash'),
    mealPlan: text('meal_plan', 'Confirm against the selected rate'),
    resortFee: text('resort_fee', 'Confirm against the selected rate'),
    access: text('access', 'Confirm before booking'),
    upgradePath: text('upgrade_path', 'Premium rooms require a separate live comparison'),
    bestFor: text('best_for', 'Hotel candidate'),
    tradeoffs: array('tradeoffs'),
    activities: array('activities'),
    verifiedAt: text('verified_at', rowDateFallback),
    funding: {
      mode: (['points', 'split', 'cash'].includes(fundingMode)
        ? fundingMode
        : 'cash') as HotelFundingMode,
      pointsPercent: fundingNumber('points_percent', 0),
      cashPercent: fundingNumber('cash_percent', 100),
      assumedNights: fundingNumber('assumed_nights', 1),
      pointsLow: fundingNumber('points_low', 0),
      pointsHigh: fundingNumber('points_high', 0),
      targetProgram: fundingText('target_program', 'Cash'),
      transferSources: fundingSources,
      awardReliability: (['date_dependent', 'fixed_value', 'not_reliable', 'cash_only'].includes(
        awardReliability
      )
        ? awardReliability
        : 'cash_only') as AwardReliability,
      estimateBasis: fundingText('estimate_basis', 'Funding plan not yet imported'),
      recommendation: fundingText(
        'recommendation',
        'Use cash until a reliable award estimate is recorded.'
      ),
    },
  }
}

const rowDateFallback = 'Not recorded'

const planningStatuses: PlanningStatus[] = [
  'exploring',
  'shortlist',
  'finalist',
  'booked',
  'parked',
]
const confidences: Confidence[] = [
  'verified_current',
  'source_backed_general',
  'estimate',
  'needs_live_verification',
]
const entityTypes: ResearchEntry['entityType'][] = [
  'general',
  'destination',
  'hotel',
  'flight',
  'trip',
]

const mapDestination = (row: DestinationRow): Destination => ({
  id: row.id,
  name: row.name,
  region: row.region,
  scores: scores(row.scores_json),
  cashLeakage: row.cash_leakage,
  bestWindow: row.best_window,
  weatherNote: row.weather_note,
  pointsAngle: stringArray(row.points_angle_json),
  tripModes: tripModes(row.trip_modes_json),
  seedNotes: row.seed_notes,
  sourceIds: stringArray(row.source_ids_json),
  isFavorite: row.is_favorite === 1,
  planningStatus: planningStatuses.includes(row.planning_status as PlanningStatus)
    ? (row.planning_status as PlanningStatus)
    : 'exploring',
  personalNote: row.personal_note,
  revision: row.revision,
  updatedAt: row.updated_at,
})

const mapHotel = (row: HotelRow, destinationIds: string[]): Hotel => ({
  id: row.id,
  name: row.name,
  destinationId: row.destination_id,
  destinationIds: destinationIds.length > 0 ? destinationIds : [row.destination_id],
  program: row.program,
  awardCategory: row.award_category,
  actualRoomHighlight: row.actual_room_highlight,
  roomFacts: simpleRecord(row.room_facts_json),
  hotelWow: row.hotel_wow,
  pointsNote: row.points_note,
  coverageTags: stringArray(row.coverage_tags_json),
  analysis: hotelAnalysis(row.analysis_json),
  imageStrategy: imageStrategy(row.image_strategy_json),
  sourceIds: stringArray(row.source_ids_json),
  updatedAt: row.updated_at,
})

const mapSource = (row: SourceRow): ResearchSource => ({
  id: row.id,
  title: row.title,
  publisher: row.publisher,
  url: row.url,
  retrieved: row.retrieved,
  supports: stringArray(row.supports_json),
})

const mapResearchEntry = (row: ResearchEntryRow): ResearchEntry => ({
  id: row.id,
  entityType: entityTypes.includes(row.entity_type as ResearchEntry['entityType'])
    ? (row.entity_type as ResearchEntry['entityType'])
    : 'general',
  entityId: row.entity_id ?? undefined,
  title: row.title,
  summary: row.summary,
  sourceUrl: row.source_url ?? undefined,
  verifiedAt: row.verified_at ?? undefined,
  confidence: confidences.includes(row.confidence as Confidence)
    ? (row.confidence as Confidence)
    : 'needs_live_verification',
  createdBy: row.created_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const mapActivity = (row: ActivityRow): ActivityItem => ({
  id: row.id,
  action: row.action,
  entityType: row.entity_type,
  entityId: row.entity_id ?? undefined,
  summary: row.summary,
  actorEmail: row.actor_email,
  createdAt: row.created_at,
})

const parseState = <T>(states: Map<string, string>, key: string): T | undefined => {
  const value = states.get(key)
  return value ? (parseJson(value) as T) : undefined
}

export async function getBootstrap(env: Env, identity: HomeIdentity): Promise<BootstrapPayload> {
  const [
    stateResult,
    destinationResult,
    hotelResult,
    sourceResult,
    pointResult,
    transferResult,
    researchResult,
    activityResult,
    preference,
    latestRun,
    hotelLinkResult,
  ] = await Promise.all([
    env.DB.prepare('SELECT key, value_json FROM app_state').all<StateRow>(),
    env.DB.prepare(`SELECT id, name, region, scores_json, cash_leakage, best_window,
      weather_note, points_angle_json, trip_modes_json, seed_notes, source_ids_json,
      is_favorite, planning_status, personal_note, revision, updated_at
      FROM destinations ORDER BY name`).all<DestinationRow>(),
    env.DB.prepare(`SELECT id, name, destination_id, program, award_category,
      actual_room_highlight, room_facts_json, hotel_wow, points_note, image_strategy_json,
      source_ids_json, analysis_json, coverage_tags_json, updated_at
      FROM hotels ORDER BY hotel_wow DESC, name`).all<HotelRow>(),
    env.DB.prepare(`SELECT id, title, publisher, url, retrieved, supports_json
      FROM sources ORDER BY retrieved DESC, title`).all<SourceRow>(),
    env.DB.prepare(`SELECT currency, points, metadata_json FROM point_accounts
      ORDER BY points DESC`).all<PointAccountRow>(),
    env.DB.prepare(`SELECT id, source_currency, destination_program, numerator, denominator,
      note, source_id FROM transfer_paths ORDER BY source_currency, destination_program`).all<TransferPathRow>(),
    env.DB.prepare(`SELECT id, entity_type, entity_id, title, summary, source_url, verified_at,
      confidence, created_by, created_at, updated_at FROM research_entries
      WHERE archived_at IS NULL ORDER BY created_at DESC LIMIT 100`).all<ResearchEntryRow>(),
    env.DB.prepare(`SELECT id, action, entity_type, entity_id, summary, actor_email, created_at
      FROM activity_log ORDER BY created_at DESC LIMIT 20`).all<ActivityRow>(),
    env.DB.prepare(`SELECT style_position, weights_json, updated_at FROM app_preferences
      WHERE identity_email = ?`)
      .bind(identity.email)
      .first<PreferenceRow>(),
    env.DB.prepare(`SELECT id, source_date, imported_at FROM research_runs
      ORDER BY imported_at DESC LIMIT 1`).first<ResearchRunRow>(),
    env.DB.prepare(`SELECT hotel_id, destination_id FROM hotel_destination_links
      ORDER BY hotel_id, destination_id`).all<HotelDestinationLinkRow>(),
  ])

  const states = new Map(stateResult.results.map((row) => [row.key, row.value_json]))
  const preferences: AppPreferences | undefined = preference
    ? {
        stylePosition: preference.style_position,
        weights: weights(preference.weights_json),
        updatedAt: preference.updated_at,
      }
    : undefined

  return {
    identity,
    seeded: destinationResult.results.length > 0,
    latestResearchRun: latestRun
      ? { id: latestRun.id, sourceDate: latestRun.source_date, importedAt: latestRun.imported_at }
      : undefined,
    travelerProfile: parseState<TravelerProfile>(states, 'traveler_profile'),
    pointsWallet: parseState<PointsWallet>(states, 'points_wallet'),
    scoringSchema: parseState<ScoringSchema>(states, 'scoring_schema'),
    destinations: destinationResult.results.map(mapDestination),
    hotels: hotelResult.results.map((hotel) =>
      mapHotel(
        hotel,
        hotelLinkResult.results
          .filter((link) => link.hotel_id === hotel.id)
          .map((link) => link.destination_id)
      )
    ),
    sources: sourceResult.results.map(mapSource),
    pointAccounts: pointResult.results.map<PointAccount>((row) => ({
      currency: row.currency,
      points: row.points,
      metadata: unknownRecord(row.metadata_json),
    })),
    transferPaths: transferResult.results.map<TransferPath>((row) => ({
      id: row.id,
      sourceCurrency: row.source_currency,
      destinationProgram: row.destination_program,
      numerator: row.numerator,
      denominator: row.denominator,
      note: row.note,
      sourceId: row.source_id ?? undefined,
    })),
    researchEntries: researchResult.results.map(mapResearchEntry),
    activity: activityResult.results.map(mapActivity),
    preferences,
  }
}

export async function saveDestinationPlanning(
  env: Env,
  identity: HomeIdentity,
  id: string,
  input: DestinationPlanningUpdate
): Promise<Destination> {
  const now = new Date().toISOString()
  const result = await env.DB.prepare(`UPDATE destinations
    SET is_favorite = ?, planning_status = ?, personal_note = ?, revision = revision + 1,
      updated_at = ? WHERE id = ? AND revision = ?`)
    .bind(
      input.isFavorite ? 1 : 0,
      input.planningStatus,
      input.personalNote,
      now,
      id,
      input.revision
    )
    .run()
  if (result.meta.changes !== 1)
    throw new Error('Destination changed elsewhere; refresh and try again')

  const row = await env.DB.prepare(`SELECT id, name, region, scores_json, cash_leakage,
    best_window, weather_note, points_angle_json, trip_modes_json, seed_notes, source_ids_json,
    is_favorite, planning_status, personal_note, revision, updated_at FROM destinations WHERE id = ?`)
    .bind(id)
    .first<DestinationRow>()
  if (!row) throw new Error('Destination not found')

  await env.DB.prepare(`INSERT INTO activity_log
    (id, action, entity_type, entity_id, summary, actor_email, created_at)
    VALUES (?, 'updated', 'destination', ?, ?, ?, ?)`)
    .bind(
      crypto.randomUUID(),
      id,
      `Updated ${row.name} to ${input.planningStatus}`,
      identity.email,
      now
    )
    .run()
  return mapDestination(row)
}

export async function createResearchEntry(
  env: Env,
  identity: HomeIdentity,
  input: ResearchEntryInput
): Promise<ResearchEntry> {
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO research_entries
      (id, entity_type, entity_id, title, summary, source_url, verified_at, confidence,
       created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      id,
      input.entityType,
      input.entityId ?? null,
      input.title,
      input.summary,
      input.sourceUrl ?? null,
      input.verifiedAt ?? null,
      input.confidence,
      identity.email,
      now,
      now
    ),
    env.DB.prepare(`INSERT INTO activity_log
      (id, action, entity_type, entity_id, summary, actor_email, created_at)
      VALUES (?, 'created', 'research_entry', ?, ?, ?, ?)`).bind(
      crypto.randomUUID(),
      id,
      `Added research: ${input.title}`,
      identity.email,
      now
    ),
  ])
  return {
    id,
    ...input,
    createdBy: identity.email,
    createdAt: now,
    updatedAt: now,
  }
}

export async function savePreferences(
  env: Env,
  identity: HomeIdentity,
  input: AppPreferences
): Promise<AppPreferences> {
  const now = new Date().toISOString()
  await env.DB.prepare(`INSERT INTO app_preferences
    (identity_email, style_position, weights_json, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(identity_email) DO UPDATE SET style_position = excluded.style_position,
      weights_json = excluded.weights_json, updated_at = excluded.updated_at`)
    .bind(identity.email, input.stylePosition, JSON.stringify(input.weights), now)
    .run()
  return { ...input, updatedAt: now }
}
