import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

type JsonRecord = Record<string, unknown>

const fail = (message: string): never => {
  throw new Error(message)
}

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const record = (value: unknown, label: string): JsonRecord =>
  isRecord(value) ? value : fail(`${label} must be an object`)
const records = (value: unknown, label: string): JsonRecord[] =>
  Array.isArray(value) && value.every(isRecord) ? value : fail(`${label} must be an object array`)
const strings = (value: unknown, label: string): string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value
    : fail(`${label} must be a text array`)
const text = (value: unknown, label: string): string =>
  typeof value === 'string' && value.trim() ? value.trim() : fail(`${label} must be text`)
const number = (value: unknown, label: string): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fail(`${label} must be a number`)
const sql = (value: string): string => `'${value.replaceAll("'", "''")}'`
const jsonSql = (value: unknown): string => sql(JSON.stringify(value))

const args = process.argv.slice(2)
const inputPath = args.find((arg) => !arg.startsWith('--'))
const isRemote = args.includes('--remote')

if (!inputPath || args.includes('--help')) {
  console.log('Usage: bun run db:import:hotels -- /path/to/hotel-research.json [--local|--remote]')
  process.exit(inputPath ? 0 : 1)
}

const projectDirectory = decodeURIComponent(new URL('../', import.meta.url).pathname)
const run = async (command: string[]): Promise<string> => {
  const child = Bun.spawn(command, {
    cwd: projectDirectory,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) fail(stderr.trim() || `${command[0]} exited with ${exitCode}`)
  return stdout
}

const inputText = await Bun.file(inputPath).text()
const payload = record(JSON.parse(inputText), 'hotel research')
const sourceDate = text(payload.source_date, 'source date')
const hotels = records(payload.hotels, 'hotels')
const suppliedSources = records(payload.sources, 'sources')
const suppliedFundingPlans = record(payload.funding_plans, 'funding plans')
const officialSources = hotels.map((hotel) => {
  const id = text(hotel.id, 'hotel id')
  const strategy = record(hotel.image_strategy, `${id} image strategy`)
  const url = text(
    strategy.official_room_page ?? strategy.official_source_page,
    `${id} official page`
  )
  return {
    id: `official-${id}`,
    title: `${text(hotel.name, 'hotel name')} — official accommodation details`,
    publisher: new URL(url).hostname.replace('www.', ''),
    url,
    retrieved: sourceDate,
    supports: [id],
  }
})
const sources = [...suppliedSources, ...officialSources]
const checksum = new Bun.CryptoHasher('sha256').update(inputText).digest('hex')
const runId = `hotel-research-${sourceDate}-${checksum.slice(0, 10)}`
const now = new Date().toISOString()
const statements: string[] = []

const programAnalysisDefaults: Record<string, JsonRecord> = {
  'World of Hyatt': {
    pricing_model:
      'Published category with five date levels; use Hyatt’s calendar for the chosen nights.',
    availability:
      'Date-dependent. Decision fit is researched; confirm consecutive standard-room nights before transferring.',
    transfer_path:
      'Chase or Bilt → World of Hyatt. Never transfer until the exact award is visible.',
  },
  'Hilton Honors': {
    pricing_model:
      'Dynamic Standard Room Reward; five-night stays can receive the fifth night free with elite status.',
    availability:
      'Date-dependent. Decision fit is researched; confirm Standard Room Reward inventory for every night.',
    transfer_path:
      'Bilt → Hilton Honors at the recorded 1:1 rate; compare against cash before moving points.',
  },
  'Marriott Bonvoy': {
    pricing_model:
      'Dynamic Standard Redemption; on five-night awards the lowest-priced night is free.',
    availability:
      'Date-dependent. Decision fit is researched; confirm one standard room across the complete stay.',
    transfer_path:
      'Chase or Bilt → Marriott Bonvoy at the recorded 1:1 rate; transfer only after valuing the award.',
  },
  'IHG One Rewards': {
    pricing_model: 'Dynamic Reward Night pricing that can change daily with rate and demand.',
    availability:
      'Date-dependent and limited; Six Senses participation in particular must be confirmed in the live flow.',
    transfer_path:
      'Chase or Bilt → IHG One Rewards at the recorded 1:1 rate; do not move points speculatively.',
  },
  'ALL Accor': {
    pricing_model:
      'Fixed-value discount: 2,000 ALL Reward points = €40 toward an eligible booking.',
    availability:
      'Bookable when an eligible cash rate is on sale; this is not scarce award inventory.',
    transfer_path:
      'Bilt → ALL Accor at the recorded 3:2 rate; treat it as a cash discount, not a free-night award.',
  },
}

const requiredCoverage: Record<string, string[]> = {
  'bali-indonesia': ['inland', 'adventure', 'beach'],
  maldives: ['resort'],
  seychelles: ['mahe', 'praslin', 'private-island'],
  'thailand-islands': ['city', 'island'],
  'french-polynesia': ['arrival', 'moorea', 'bora-bora'],
  fiji: ['main-island', 'outer-island'],
  mauritius: ['resort'],
  'oman-maldives': ['oman', 'maldives'],
  'south-africa-indian-ocean': ['cape', 'safari', 'island-finish'],
  mediterranean: ['culture', 'coast'],
  hawaii: ['maui', 'kauai'],
  'mexico-caribbean': ['mexico', 'caribbean'],
}

const fundingModes = ['points', 'split', 'cash'] as const
const awardReliabilities = ['date_dependent', 'fixed_value', 'not_reliable', 'cash_only'] as const

const normalizeFunding = (id: string): JsonRecord => {
  const supplied = record(suppliedFundingPlans[id], `${id} funding plan`)
  const mode = text(supplied.mode, `${id} funding mode`)
  if (!fundingModes.includes(mode as (typeof fundingModes)[number])) {
    fail(`${id} funding mode must be ${fundingModes.join(', ')}`)
  }
  const awardReliability = text(supplied.award_reliability, `${id} award reliability`)
  if (!awardReliabilities.includes(awardReliability as (typeof awardReliabilities)[number])) {
    fail(`${id} award reliability must be ${awardReliabilities.join(', ')}`)
  }
  const pointsPercent = number(supplied.points_percent, `${id} points percent`)
  if (pointsPercent < 0 || pointsPercent > 100) {
    fail(`${id} points percent must be between 0 and 100`)
  }
  const nights = number(supplied.nights, `${id} assumed nights`)
  if (!Number.isInteger(nights) || nights < 1)
    fail(`${id} assumed nights must be a positive integer`)
  const pointsRange = Array.isArray(supplied.points_range)
    ? supplied.points_range.map((value, index) => number(value, `${id} points range ${index + 1}`))
    : fail(`${id} points range must be an array`)
  if (pointsRange.length !== 2 || pointsRange[0] < 0 || pointsRange[1] < pointsRange[0]) {
    fail(`${id} points range must contain an ordered low and high estimate`)
  }
  return {
    mode,
    points_percent: pointsPercent,
    cash_percent: 100 - pointsPercent,
    assumed_nights: nights,
    points_low: pointsRange[0],
    points_high: pointsRange[1],
    target_program: text(supplied.target_program, `${id} target program`),
    transfer_sources: strings(supplied.transfer_sources, `${id} transfer sources`),
    award_reliability: awardReliability,
    estimate_basis: text(supplied.basis, `${id} funding basis`),
    recommendation: text(supplied.recommendation, `${id} funding recommendation`),
  }
}

const normalizeAnalysis = (hotel: JsonRecord, id: string): JsonRecord => {
  const program = text(hotel.program, `${id} program`)
  const analysis = record(hotel.analysis, `${id} analysis`)
  const normalized = {
    status: 'decision_ready',
    availability:
      'Date-dependent. Decision fit is researched; confirm the exact room and price before transferring.',
    transfer_path: 'No transferable-points path recorded.',
    meal_plan:
      'Room-only unless the selected rate explicitly includes meals; compare breakfast and half-board options.',
    resort_fee:
      'No separate fee identified; confirm taxes and mandatory charges on the final rate screen.',
    verified_at: sourceDate,
    ...programAnalysisDefaults[program],
    ...analysis,
    funding: normalizeFunding(id),
  }
  const requiredTextKeys = [
    'location',
    'stay_role',
    'standard_award_room',
    'pricing_model',
    'availability',
    'transfer_path',
    'meal_plan',
    'resort_fee',
    'access',
    'upgrade_path',
    'best_for',
    'verified_at',
  ]
  const requiredArrayKeys = ['inclusions', 'unavoidable_cash', 'tradeoffs', 'activities']
  for (const key of requiredTextKeys) text(normalized[key], `${id} ${key}`)
  for (const key of requiredArrayKeys) strings(normalized[key], `${id} ${key}`)
  return normalized
}

const normalizedHotels = hotels.map((hotel) => {
  const id = text(hotel.id, 'hotel id')
  const destinationIds = strings(hotel.destination_ids, `${id} destination ids`)
  if (destinationIds.length === 0) fail(`${id} needs at least one destination`)
  const coverageTags = strings(hotel.coverage_tags, `${id} coverage tags`)
  const analysis = normalizeAnalysis(hotel, id)
  if (analysis.status !== 'decision_ready' && analysis.status !== 'booking_check_needed') {
    fail(`${id} analysis status is invalid`)
  }
  return { hotel, id, destinationIds, coverageTags, analysis }
})

const knownHotelIds = new Set(normalizedHotels.map((item) => item.id))
for (const fundingId of Object.keys(suppliedFundingPlans)) {
  if (!knownHotelIds.has(fundingId)) fail(`Funding plan references unknown hotel ${fundingId}`)
}

for (const [destinationId, requiredTags] of Object.entries(requiredCoverage)) {
  const candidates = normalizedHotels.filter(
    (item) =>
      item.analysis.status === 'decision_ready' && item.destinationIds.includes(destinationId)
  )
  if (candidates.length < 3) {
    fail(`${destinationId} has ${candidates.length} complete hotels; three are required`)
  }
  const missingTags = requiredTags.filter(
    (requiredTag) => !candidates.some((item) => item.coverageTags.includes(requiredTag))
  )
  if (missingTags.length > 0) {
    fail(`${destinationId} is missing hotel coverage for: ${missingTags.join(', ')}`)
  }
}

const availableSourceIds = new Set(sources.map((source) => text(source.id, 'source id')))
for (const item of normalizedHotels) {
  for (const sourceId of strings(item.hotel.source_ids, `${item.id} source ids`)) {
    if (!availableSourceIds.has(sourceId)) fail(`${item.id} references unknown source ${sourceId}`)
  }
}

statements.push(`INSERT OR IGNORE INTO research_runs
  (id, source_date, source_file, checksum, imported_at)
  VALUES (${sql(runId)}, ${sql(sourceDate)}, ${sql(basename(inputPath))}, ${sql(checksum)}, ${sql(now)});`)

for (const source of sources) {
  const id = text(source.id, 'source id')
  statements.push(`INSERT INTO sources
    (id, title, publisher, url, retrieved, supports_json, created_at, updated_at)
    VALUES (${sql(id)}, ${sql(text(source.title, 'source title'))},
      ${sql(text(source.publisher, 'source publisher'))}, ${sql(text(source.url, 'source URL'))},
      ${sql(text(source.retrieved, 'source retrieval date'))},
      ${jsonSql(strings(source.supports, 'source supports'))}, ${sql(now)}, ${sql(now)})
    ON CONFLICT(id) DO UPDATE SET title = excluded.title, publisher = excluded.publisher,
      url = excluded.url, retrieved = excluded.retrieved, supports_json = excluded.supports_json,
      updated_at = excluded.updated_at;`)
  statements.push(`INSERT OR IGNORE INTO research_snapshots
    (run_id, entity_type, entity_id, payload_json)
    VALUES (${sql(runId)}, 'source', ${sql(id)}, ${jsonSql(source)});`)
}

for (const { hotel, id, destinationIds, coverageTags, analysis } of normalizedHotels) {
  statements.push(`INSERT INTO hotels
    (id, name, destination_id, program, award_category, actual_room_highlight,
     room_facts_json, hotel_wow, points_note, image_strategy_json, source_ids_json,
     analysis_json, coverage_tags_json, created_at, updated_at)
    VALUES (${sql(id)}, ${sql(text(hotel.name, 'hotel name'))}, ${sql(destinationIds[0])},
      ${sql(text(hotel.program, 'hotel program'))},
      ${sql(text(hotel.award_category, 'award category'))},
      ${sql(text(hotel.actual_room_highlight, 'room highlight'))},
      ${jsonSql(record(hotel.room_facts, `${id} room facts`))},
      ${number(hotel.hotel_wow, `${id} hotel wow`)},
      ${sql(text(hotel.points_note, `${id} points note`))},
      ${jsonSql(record(hotel.image_strategy, `${id} image strategy`))},
      ${jsonSql(strings(hotel.source_ids, `${id} source ids`))}, ${jsonSql(analysis)},
      ${jsonSql(coverageTags)}, ${sql(now)}, ${sql(now)})
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, destination_id = excluded.destination_id,
      program = excluded.program, award_category = excluded.award_category,
      actual_room_highlight = excluded.actual_room_highlight,
      room_facts_json = excluded.room_facts_json, hotel_wow = excluded.hotel_wow,
      points_note = excluded.points_note, image_strategy_json = excluded.image_strategy_json,
      source_ids_json = excluded.source_ids_json, analysis_json = excluded.analysis_json,
      coverage_tags_json = excluded.coverage_tags_json, updated_at = excluded.updated_at;`)
  statements.push(`DELETE FROM hotel_destination_links WHERE hotel_id = ${sql(id)};`)
  for (const destinationId of destinationIds) {
    statements.push(`INSERT INTO hotel_destination_links (hotel_id, destination_id)
      VALUES (${sql(id)}, ${sql(destinationId)});`)
  }
  statements.push(`INSERT OR IGNORE INTO research_snapshots
    (run_id, entity_type, entity_id, payload_json)
    VALUES (${sql(runId)}, 'hotel', ${sql(id)}, ${jsonSql(hotel)});`)
}

statements.push(`INSERT OR IGNORE INTO activity_log
  (id, action, entity_type, entity_id, summary, actor_email, created_at)
  VALUES (${sql(`import-${runId}`)}, 'imported', 'research_run', ${sql(runId)},
    ${sql(`Added decision research for ${hotels.length} honeymoon hotels`)},
    'hotel-research-script', ${sql(now)});`)

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'eggers-home-hotels-'))
const sqlPath = join(temporaryDirectory, 'hotel-research.sql')

try {
  await Bun.write(sqlPath, `${statements.join('\n')}\n`)
  const target = isRemote ? '--remote' : '--local'
  const migrateOutput = await run([
    'bunx',
    'wrangler',
    'd1',
    'migrations',
    'apply',
    'eggers-home',
    target,
  ])
  if (migrateOutput.trim()) console.log(migrateOutput.trim())
  await run(['bunx', 'wrangler', 'd1', 'execute', 'eggers-home', target, '--file', sqlPath])
  console.log(
    `Imported ${hotels.length} hotels and ${sources.length} sources into ${isRemote ? 'remote' : 'local'} D1.`
  )
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}
