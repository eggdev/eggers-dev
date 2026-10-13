export const migrations = [
  {
    version: 1,
    sql: `
CREATE TABLE IF NOT EXISTS settings (
  id text PRIMARY KEY CHECK (id = 'owner'),
  value jsonb NOT NULL DEFAULT '{"reviewRequired":false,"interviewModel":"gpt-6.1-sol","extractionModel":"gpt-6-luna"}'::jsonb
);
INSERT INTO settings (id) VALUES ('owner') ON CONFLICT DO NOTHING;
CREATE TABLE roles (
  id text PRIMARY KEY, title text NOT NULL, company text NOT NULL DEFAULT '',
  dates text NOT NULL DEFAULT '', context text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE threads (
  id text PRIMARY KEY, title text NOT NULL, role_id text REFERENCES roles(id) ON DELETE SET NULL,
  phase text NOT NULL DEFAULT 'recall' CHECK (phase IN ('recall','discovery')),
  session jsonb, events jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE retired_sessions (id text PRIMARY KEY);
CREATE TABLE messages (
  id text PRIMARY KEY, thread_id text NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('user','assistant')), body text NOT NULL,
  position bigint GENERATED ALWAYS AS IDENTITY, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE entries (
  id text PRIMARY KEY, role_id text REFERENCES roles(id) ON DELETE SET NULL,
  title text NOT NULL, markdown text NOT NULL, skills jsonb NOT NULL DEFAULT '[]',
  revision integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE entry_sources (
  entry_id text REFERENCES entries(id) ON DELETE CASCADE,
  message_id text REFERENCES messages(id) ON DELETE CASCADE,
  PRIMARY KEY(entry_id, message_id)
);
CREATE TABLE entry_revisions (
  entry_id text REFERENCES entries(id) ON DELETE CASCADE, revision integer NOT NULL,
  title text NOT NULL, markdown text NOT NULL, skills jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(entry_id, revision)
);
CREATE TABLE proposals (
  id text PRIMARY KEY, entry_id text REFERENCES entries(id) ON DELETE CASCADE,
  payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE topics (
  id text PRIMARY KEY, role_id text REFERENCES roles(id) ON DELETE CASCADE,
  label text NOT NULL, status text NOT NULL DEFAULT 'unexplored'
    CHECK (status IN ('unexplored','exploring','sufficient','revisit')),
  notes text NOT NULL DEFAULT '', UNIQUE(role_id, label)
);
CREATE TABLE listings (
  id text PRIMARY KEY, url text NOT NULL UNIQUE, source_url text NOT NULL,
  title text NOT NULL DEFAULT '', company text NOT NULL DEFAULT '',
  family text NOT NULL DEFAULT '', seniority text NOT NULL DEFAULT '', location text NOT NULL DEFAULT '',
  arrangement text NOT NULL DEFAULT '', description text NOT NULL DEFAULT '',
  content_hash text, requirements jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','fetching','needs_browser','extracting','ready','failed')),
  error text, attempts integer NOT NULL DEFAULT 0, duplicate_of text REFERENCES listings(id) ON DELETE SET NULL,
  collected_at timestamptz NOT NULL DEFAULT now(), parsed_at timestamptz,
  parser_version text, model text
);
CREATE INDEX messages_thread ON messages(thread_id, position);
CREATE INDEX entries_role ON entries(role_id);
CREATE INDEX listings_content ON listings(content_hash);
CREATE TABLE subscribers (
  id text PRIMARY KEY, email text NOT NULL UNIQUE, unsubscribe_token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz
);
CREATE TABLE rate_limits (key text PRIMARY KEY, window_start timestamptz NOT NULL DEFAULT now(), count integer NOT NULL DEFAULT 1);
`,
  },
  {
    version: 2,
    sql: `ALTER TABLE messages ADD COLUMN turn_id text; CREATE INDEX messages_turn ON messages(thread_id, turn_id);`,
  },
  {
    version: 3,
    sql: `ALTER TABLE proposals ADD COLUMN action text NOT NULL DEFAULT 'entries.save' CHECK(action IN ('entries.save','roles.save','topics.save'));`,
  },
];
