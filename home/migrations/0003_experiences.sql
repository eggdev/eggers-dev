CREATE TABLE experiences (
  id TEXT PRIMARY KEY,
  destination_id TEXT NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  chill_score REAL NOT NULL CHECK (chill_score BETWEEN 1 AND 5),
  active_score REAL NOT NULL CHECK (active_score BETWEEN 1 AND 5),
  physical_demand TEXT NOT NULL CHECK (physical_demand IN ('low', 'moderate', 'high')),
  duration TEXT NOT NULL,
  setting TEXT NOT NULL,
  cost_band TEXT NOT NULL,
  description TEXT NOT NULL,
  best_time TEXT NOT NULL,
  booking_note TEXT NOT NULL,
  source_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX experiences_destination_idx ON experiences(destination_id);
CREATE INDEX experiences_demand_idx ON experiences(physical_demand);
