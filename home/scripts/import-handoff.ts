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

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

const text = (value: unknown, label: string): string =>
  typeof value === 'string' ? value : fail(`${label} must be text`)

const number = (value: unknown, label: string): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fail(`${label} must be a number`)

const sql = (value: string): string => `'${value.replaceAll("'", "''")}'`
const jsonSql = (value: unknown): string => sql(JSON.stringify(value))
const slug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')

const args = process.argv.slice(2)
const archivePath = args.find((arg) => !arg.startsWith('--'))
const isRemote = args.includes('--remote')

if (!archivePath || args.includes('--help')) {
  console.log('Usage: bun run db:import -- /path/to/handoff.zip [--local|--remote]')
  process.exit(archivePath ? 0 : 1)
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

if (isRemote) {
  const config = await Bun.file(join(projectDirectory, 'wrangler.jsonc')).text()
  if (config.includes('REPLACE_WITH_D1_DATABASE_ID')) {
    fail('Create the remote D1 database and put its database_id in home/wrangler.jsonc first.')
  }
}

const archiveEntries = (await run(['unzip', '-Z1', archivePath])).trim().split('\n')

const readJson = async (relativePath: string): Promise<unknown> => {
  const entry = archiveEntries.find((candidate) => candidate.endsWith(`/${relativePath}`))
  if (!entry) fail(`The archive is missing ${relativePath}`)
  const contents = await run(['unzip', '-p', archivePath, entry])
  try {
    return JSON.parse(contents)
  } catch {
    return fail(`${relativePath} is not valid JSON`)
  }
}

const [travelerRaw, pointsRaw, partnersRaw, scoringRaw, destinationsRaw, hotelsRaw, sourcesRaw] =
  await Promise.all([
    readJson('data/traveler_profile.json'),
    readJson('data/points_balances.json'),
    readJson('data/transfer_partners.json'),
    readJson('data/scoring_schema.json'),
    readJson('data/destinations.json'),
    readJson('data/hotels.json'),
    readJson('data/sources.json'),
  ])

const traveler = record(travelerRaw, 'traveler_profile')
const points = record(pointsRaw, 'points_balances')
const partners = record(partnersRaw, 'transfer_partners')
const scoring = record(scoringRaw, 'scoring_schema')
const destinations = records(destinationsRaw, 'destinations')
const hotels = records(hotelsRaw, 'hotels')
const sources = records(sourcesRaw, 'sources')
const balances = records(points.balances, 'points balances')
const now = new Date().toISOString()

const travelerProfile = {
  project: text(traveler.project, 'traveler project'),
  travelers: number(traveler.travelers, 'travelers'),
  homeBase: text(traveler.home_base, 'home base'),
  tripLengthDays: number(traveler.trip_length_days, 'trip length'),
  travelWindow: {
    start: text(record(traveler.travel_window, 'travel window').start, 'travel window start'),
    end: text(record(traveler.travel_window, 'travel window').end, 'travel window end'),
    mustBeHome: records(
      record(traveler.travel_window, 'travel window').must_be_home,
      'must-be-home dates'
    ).map((window) => ({
      start: text(window.start, 'must-be-home start'),
      end: text(window.end, 'must-be-home end'),
    })),
    interpretation: text(
      record(traveler.travel_window, 'travel window').interpretation,
      'travel window interpretation'
    ),
  },
}

const pointsWallet = {
  asOf: text(points.as_of, 'points as-of date'),
  owner: text(points.owner, 'points owner'),
  totalPlannedPoints: number(points.total_planned_points, 'total points'),
  excludedFromPlan: text(points.excluded_from_plan, 'excluded points note'),
  strategy: strings(points.strategy),
}

const defaultWeights = record(scoring.default_weighting_percent, 'default weights')
const scoringSchema = {
  scale: text(scoring.scale, 'score scale'),
  dimensions: records(scoring.dimensions, 'scoring dimensions').map((dimension) => ({
    key: text(dimension.key, 'dimension key'),
    label: text(dimension.label, 'dimension label'),
    description: text(dimension.description, 'dimension description'),
  })),
  defaultWeightingPercent: defaultWeights,
  specialViews: strings(scoring.special_views),
  confidenceLevels: strings(scoring.confidence_levels),
}

const digest = await crypto.subtle.digest('SHA-256', await Bun.file(archivePath).arrayBuffer())
const checksum = Array.from(new Uint8Array(digest), (byte) =>
  byte.toString(16).padStart(2, '0')
).join('')
const sourceDate = pointsWallet.asOf
const runId = `${sourceDate}-${checksum.slice(0, 12)}`

// Wrangler imports the file atomically; remote D1 rejects explicit transaction statements.
const statements: string[] = [
  'PRAGMA foreign_keys = ON;',
  `INSERT INTO research_runs (id, source_date, source_file, checksum, imported_at)
   VALUES (${sql(runId)}, ${sql(sourceDate)}, ${sql(basename(archivePath))}, ${sql(checksum)}, ${sql(now)})
   ON CONFLICT(checksum) DO NOTHING;`,
]

const addState = (key: string, value: unknown): void => {
  statements.push(`INSERT INTO app_state (key, value_json, updated_at)
    VALUES (${sql(key)}, ${jsonSql(value)}, ${sql(now)})
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at;`)
}

addState('traveler_profile', travelerProfile)
addState('points_wallet', pointsWallet)
addState('scoring_schema', scoringSchema)
addState('transfer_partners_raw', partnersRaw)

for (const [entityId, payload] of [
  ['traveler_profile', travelerRaw],
  ['points_balances', pointsRaw],
  ['transfer_partners', partnersRaw],
  ['scoring_schema', scoringRaw],
] as Array<[string, unknown]>) {
  statements.push(`INSERT OR IGNORE INTO research_snapshots
    (run_id, entity_type, entity_id, payload_json)
    VALUES (${sql(runId)}, 'dataset', ${sql(entityId)}, ${jsonSql(payload)});`)
}

for (const destination of destinations) {
  const id = text(destination.id, 'destination id')
  statements.push(`INSERT INTO destinations
    (id, name, region, scores_json, cash_leakage, best_window, weather_note,
     points_angle_json, trip_modes_json, seed_notes, source_ids_json, created_at, updated_at)
    VALUES (${sql(id)}, ${sql(text(destination.name, 'destination name'))},
      ${sql(text(destination.region, 'destination region'))}, ${jsonSql(destination.scores)},
      ${sql(text(destination.cash_leakage, 'cash leakage'))},
      ${sql(text(destination.best_window, 'best window'))},
      ${sql(text(destination.weather_note, 'weather note'))}, ${jsonSql(destination.points_angle)},
      ${jsonSql(destination.trip_modes)}, ${sql(text(destination.seed_notes, 'seed notes'))},
      ${jsonSql(destination.source_ids)}, ${sql(now)}, ${sql(now)})
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name, region = excluded.region, scores_json = excluded.scores_json,
      cash_leakage = excluded.cash_leakage, best_window = excluded.best_window,
      weather_note = excluded.weather_note, points_angle_json = excluded.points_angle_json,
      trip_modes_json = excluded.trip_modes_json, seed_notes = excluded.seed_notes,
      source_ids_json = excluded.source_ids_json, revision = destinations.revision + 1,
      updated_at = excluded.updated_at;`)
  statements.push(`INSERT OR IGNORE INTO research_snapshots
    (run_id, entity_type, entity_id, payload_json)
    VALUES (${sql(runId)}, 'destination', ${sql(id)}, ${jsonSql(destination)});`)
}

for (const hotel of hotels) {
  const id = text(hotel.id, 'hotel id')
  statements.push(`INSERT INTO hotels
    (id, name, destination_id, program, award_category, actual_room_highlight,
     room_facts_json, hotel_wow, points_note, image_strategy_json, source_ids_json,
     created_at, updated_at)
    VALUES (${sql(id)}, ${sql(text(hotel.name, 'hotel name'))},
      ${sql(text(hotel.destination_id, 'hotel destination'))},
      ${sql(text(hotel.program, 'hotel program'))},
      ${sql(text(hotel.award_category, 'award category'))},
      ${sql(text(hotel.actual_room_highlight, 'room highlight'))}, ${jsonSql(hotel.room_facts)},
      ${number(hotel.hotel_wow, 'hotel wow')}, ${sql(text(hotel.points_note, 'points note'))},
      ${jsonSql(hotel.image_strategy)}, ${jsonSql(hotel.source_ids)}, ${sql(now)}, ${sql(now)})
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name, destination_id = excluded.destination_id, program = excluded.program,
      award_category = excluded.award_category,
      actual_room_highlight = excluded.actual_room_highlight,
      room_facts_json = excluded.room_facts_json, hotel_wow = excluded.hotel_wow,
      points_note = excluded.points_note, image_strategy_json = excluded.image_strategy_json,
      source_ids_json = excluded.source_ids_json, updated_at = excluded.updated_at;`)
  statements.push(`INSERT OR IGNORE INTO research_snapshots
    (run_id, entity_type, entity_id, payload_json)
    VALUES (${sql(runId)}, 'hotel', ${sql(id)}, ${jsonSql(hotel)});`)
}

for (const source of sources) {
  const id = text(source.id, 'source id')
  statements.push(`INSERT INTO sources
    (id, title, publisher, url, retrieved, supports_json, created_at, updated_at)
    VALUES (${sql(id)}, ${sql(text(source.title, 'source title'))},
      ${sql(text(source.publisher, 'source publisher'))}, ${sql(text(source.url, 'source URL'))},
      ${sql(text(source.retrieved, 'source retrieval date'))}, ${jsonSql(source.supports)},
      ${sql(now)}, ${sql(now)})
    ON CONFLICT(id) DO UPDATE SET title = excluded.title, publisher = excluded.publisher,
      url = excluded.url, retrieved = excluded.retrieved, supports_json = excluded.supports_json,
      updated_at = excluded.updated_at;`)
  statements.push(`INSERT OR IGNORE INTO research_snapshots
    (run_id, entity_type, entity_id, payload_json)
    VALUES (${sql(runId)}, 'source', ${sql(id)}, ${jsonSql(source)});`)
}

for (const balance of balances) {
  const currency = text(balance.currency, 'points currency')
  const metadata = { ...balance }
  delete metadata.currency
  delete metadata.points
  statements.push(`INSERT INTO point_accounts (currency, points, metadata_json, updated_at)
    VALUES (${sql(currency)}, ${number(balance.points, 'points balance')}, ${jsonSql(metadata)}, ${sql(now)})
    ON CONFLICT(currency) DO UPDATE SET points = excluded.points,
      metadata_json = excluded.metadata_json, updated_at = excluded.updated_at;`)
}

const addTransferPath = (
  sourceCurrency: string,
  program: string,
  numerator = 1,
  denominator = 1,
  note = '',
  sourceId?: string
): void => {
  const id = `${slug(sourceCurrency)}-${slug(program)}`
  statements.push(`INSERT INTO transfer_paths
    (id, source_currency, destination_program, numerator, denominator, note, source_id, updated_at)
    VALUES (${sql(id)}, ${sql(sourceCurrency)}, ${sql(program)}, ${numerator}, ${denominator},
      ${sql(note)}, ${sourceId ? sql(sourceId) : 'NULL'}, ${sql(now)})
    ON CONFLICT(id) DO UPDATE SET numerator = excluded.numerator, denominator = excluded.denominator,
      note = excluded.note, source_id = excluded.source_id, updated_at = excluded.updated_at;`)
}

const chase = record(partners.chase_ultimate_rewards, 'Chase transfer partners')
for (const program of [...strings(chase.airlines), ...strings(chase.hotels)]) {
  addTransferPath(
    'Chase Ultimate Rewards',
    program,
    1,
    1,
    program === 'World of Hyatt'
      ? text(chase.default_rate_note, 'Chase transfer note')
      : 'Default handoff rate; verify before transfer.',
    'chase_preferred_2026'
  )
}

const bilt = record(partners.bilt_rewards, 'Bilt transfer partners')
for (const program of strings(bilt.airlines_1_to_1)) {
  addTransferPath(
    'Bilt Rewards',
    program,
    1,
    1,
    'Verify before transfer.',
    'bilt_transfer_partners_2026'
  )
}
for (const hotel of records(bilt.hotels, 'Bilt hotel partners')) {
  const [numerator, denominator] = text(hotel.rate, 'Bilt transfer rate')
    .split(':')
    .map((value) => Number.parseInt(value, 10))
  addTransferPath(
    'Bilt Rewards',
    text(hotel.program, 'Bilt hotel program'),
    numerator,
    denominator,
    'Transfers are irreversible; verify availability before transfer.',
    typeof hotel.source_id === 'string' ? hotel.source_id : 'bilt_transfer_partners_2026'
  )
}

statements.push(`INSERT OR IGNORE INTO activity_log
  (id, action, entity_type, entity_id, summary, actor_email, created_at)
  VALUES (${sql(`import-${runId}`)}, 'imported', 'research_run', ${sql(runId)},
    ${sql(`Imported private honeymoon handoff dated ${sourceDate}`)}, 'import-script', ${sql(now)});`)
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'eggers-home-import-'))
const sqlPath = join(temporaryDirectory, 'handoff.sql')

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
  const importOutput = await run([
    'bunx',
    'wrangler',
    'd1',
    'execute',
    'eggers-home',
    target,
    '--file',
    sqlPath,
  ])
  if (importOutput.trim()) console.log(importOutput.trim())
  console.log(
    `Imported ${destinations.length} destinations, ${hotels.length} hotels, and ${sources.length} sources into ${isRemote ? 'remote' : 'local'} D1.`
  )
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}
