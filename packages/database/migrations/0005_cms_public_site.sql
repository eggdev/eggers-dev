CREATE TABLE IF NOT EXISTS cms_site_drafts (
  id TEXT PRIMARY KEY CHECK (id = 'site'),
  content_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cms_publications (
  id TEXT PRIMARY KEY,
  draft_revision INTEGER NOT NULL,
  published_at TEXT NOT NULL,
  published_by TEXT NOT NULL,
  snapshot_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cms_publications_published_at
  ON cms_publications(published_at DESC);
