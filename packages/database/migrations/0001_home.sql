PRAGMA foreign_keys = ON;

CREATE TABLE app_state (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE research_runs (
  id TEXT PRIMARY KEY,
  source_date TEXT NOT NULL,
  source_file TEXT NOT NULL,
  checksum TEXT NOT NULL UNIQUE,
  imported_at TEXT NOT NULL
);

CREATE TABLE research_snapshots (
  run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (run_id, entity_type, entity_id)
);

CREATE TABLE destinations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  region TEXT NOT NULL,
  scores_json TEXT NOT NULL,
  cash_leakage TEXT NOT NULL,
  best_window TEXT NOT NULL,
  weather_note TEXT NOT NULL,
  points_angle_json TEXT NOT NULL,
  trip_modes_json TEXT NOT NULL,
  seed_notes TEXT NOT NULL,
  source_ids_json TEXT NOT NULL,
  is_favorite INTEGER NOT NULL DEFAULT 0 CHECK (is_favorite IN (0, 1)),
  planning_status TEXT NOT NULL DEFAULT 'exploring'
    CHECK (planning_status IN ('exploring', 'shortlist', 'finalist', 'booked', 'parked')),
  personal_note TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE hotels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  destination_id TEXT NOT NULL REFERENCES destinations(id),
  program TEXT NOT NULL,
  award_category TEXT NOT NULL,
  actual_room_highlight TEXT NOT NULL,
  room_facts_json TEXT NOT NULL,
  hotel_wow REAL NOT NULL,
  points_note TEXT NOT NULL,
  image_strategy_json TEXT NOT NULL,
  source_ids_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  publisher TEXT NOT NULL,
  url TEXT NOT NULL,
  retrieved TEXT NOT NULL,
  supports_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE point_accounts (
  currency TEXT PRIMARY KEY,
  points INTEGER NOT NULL CHECK (points >= 0),
  metadata_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE transfer_paths (
  id TEXT PRIMARY KEY,
  source_currency TEXT NOT NULL,
  destination_program TEXT NOT NULL,
  numerator INTEGER NOT NULL CHECK (numerator > 0),
  denominator INTEGER NOT NULL CHECK (denominator > 0),
  note TEXT NOT NULL DEFAULT '',
  source_id TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE research_entries (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL
    CHECK (entity_type IN ('general', 'destination', 'hotel', 'flight', 'trip')),
  entity_id TEXT,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  source_url TEXT,
  verified_at TEXT,
  confidence TEXT NOT NULL
    CHECK (confidence IN ('verified_current', 'source_backed_general', 'estimate', 'needs_live_verification')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE app_preferences (
  identity_email TEXT PRIMARY KEY,
  style_position INTEGER NOT NULL DEFAULT 50 CHECK (style_position BETWEEN 0 AND 100),
  weights_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE activity_log (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  summary TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX destinations_planning_status_idx ON destinations(planning_status);
CREATE INDEX hotels_destination_id_idx ON hotels(destination_id);
CREATE INDEX research_entries_created_at_idx ON research_entries(created_at DESC);
CREATE INDEX activity_log_created_at_idx ON activity_log(created_at DESC);
