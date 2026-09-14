PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('inbox', 'note')),
  visibility TEXT NOT NULL CHECK (visibility IN ('private', 'shareable', 'public')),
  tags_json TEXT NOT NULL DEFAULT '[]',
  body_markdown TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1,
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_documents_updated_at ON documents(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_archived ON documents(archived, updated_at DESC);

CREATE TABLE IF NOT EXISTS resumes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  data_json TEXT NOT NULL,
  is_canonical INTEGER NOT NULL DEFAULT 0 CHECK (is_canonical IN (0, 1)),
  revision INTEGER NOT NULL DEFAULT 1,
  published_commit TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_resumes_one_canonical
  ON resumes(is_canonical)
  WHERE is_canonical = 1;

CREATE TABLE IF NOT EXISTS publish_events (
  id TEXT PRIMARY KEY,
  resume_id TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  commit_url TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (resume_id) REFERENCES resumes(id) ON DELETE CASCADE
);
