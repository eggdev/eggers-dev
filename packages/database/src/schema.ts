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
  {
    version: 4,
    sql: `
CREATE TABLE tracked_jobs (
  id text PRIMARY KEY, listing_id text UNIQUE REFERENCES listings(id) ON DELETE SET NULL,
  url text NOT NULL UNIQUE, title text NOT NULL, company text NOT NULL DEFAULT '',
  stage text NOT NULL DEFAULT 'saved' CHECK(stage IN ('saved','applied','interviewing','offer','rejected','withdrawn','closed')),
  notes text NOT NULL DEFAULT '', next_action text NOT NULL DEFAULT '', next_due_on date,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE job_activities (
  id text PRIMARY KEY, job_id text NOT NULL REFERENCES tracked_jobs(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK(kind IN ('stage_change','application','conversation','interview','offer','note','follow_up')),
  title text NOT NULL, body text NOT NULL DEFAULT '', happened_on date,
  stage text CHECK(stage IN ('saved','applied','interviewing','offer','rejected','withdrawn','closed')),
  source text NOT NULL DEFAULT 'owner', revision integer NOT NULL DEFAULT 1,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX job_activities_job ON job_activities(job_id, happened_on, recorded_at);
`,
  },
  {
    version: 5,
    sql: `
UPDATE settings SET value=(value #>> '{}')::jsonb WHERE jsonb_typeof(value)='string';
UPDATE threads SET session=(session #>> '{}')::jsonb WHERE jsonb_typeof(session)='string';
UPDATE threads SET events=(events #>> '{}')::jsonb WHERE jsonb_typeof(events)='string';
UPDATE entries SET skills=(skills #>> '{}')::jsonb WHERE jsonb_typeof(skills)='string';
UPDATE entry_revisions SET skills=(skills #>> '{}')::jsonb WHERE jsonb_typeof(skills)='string';
UPDATE proposals SET payload=(payload #>> '{}')::jsonb WHERE jsonb_typeof(payload)='string';
UPDATE listings SET requirements=(requirements #>> '{}')::jsonb WHERE jsonb_typeof(requirements)='string';
`,
  },
  {
    version: 6,
    sql: `
ALTER TABLE tracked_jobs DROP CONSTRAINT tracked_jobs_stage_check;
ALTER TABLE tracked_jobs ADD CONSTRAINT tracked_jobs_stage_check CHECK(stage IN ('saved','applied','interviewing','offer','negotiating','offer_accepted','offer_declined','no_response','ghosted','rejected','withdrawn','closed'));
ALTER TABLE job_activities DROP CONSTRAINT job_activities_stage_check;
ALTER TABLE job_activities ADD CONSTRAINT job_activities_stage_check CHECK(stage IN ('saved','applied','interviewing','offer','negotiating','offer_accepted','offer_declined','no_response','ghosted','rejected','withdrawn','closed'));
ALTER TABLE tracked_jobs ADD COLUMN stage_since date;
ALTER TABLE tracked_jobs ADD COLUMN stage_activity_id text;
UPDATE tracked_jobs SET stage_activity_id=(SELECT id FROM job_activities WHERE job_id=tracked_jobs.id AND kind='stage_change' ORDER BY recorded_at DESC,id DESC LIMIT 1);
UPDATE tracked_jobs SET stage_since=(SELECT happened_on FROM job_activities WHERE job_id=tracked_jobs.id AND kind='stage_change' ORDER BY recorded_at DESC,id DESC LIMIT 1);
`,
  },
  {
    version: 7,
    sql: `
CREATE TABLE requirement_concepts (id text PRIMARY KEY,label text NOT NULL,description text NOT NULL DEFAULT '',revision integer NOT NULL DEFAULT 1);
CREATE TABLE requirement_capabilities (id text PRIMARY KEY,label text NOT NULL,kind text NOT NULL,description text NOT NULL DEFAULT '',experience_guide text NOT NULL DEFAULT '',prompts jsonb NOT NULL DEFAULT '[]',distinctions text NOT NULL DEFAULT '',revision integer NOT NULL DEFAULT 1);
CREATE TABLE requirement_capability_concepts (capability_id text REFERENCES requirement_capabilities(id) ON DELETE CASCADE,concept_id text REFERENCES requirement_concepts(id) ON DELETE CASCADE,PRIMARY KEY(capability_id,concept_id));
CREATE TABLE requirement_links (listing_id text REFERENCES listings(id) ON DELETE CASCADE,requirement_key text NOT NULL,capability_id text REFERENCES requirement_capabilities(id) ON DELETE CASCADE,PRIMARY KEY(listing_id,requirement_key,capability_id));
CREATE INDEX requirement_links_capability ON requirement_links(capability_id);
`,
  },
  {
    version: 8,
    sql: `
CREATE TABLE entry_capabilities (entry_id text REFERENCES entries(id) ON DELETE CASCADE,capability_id text REFERENCES requirement_capabilities(id) ON DELETE CASCADE,PRIMARY KEY(entry_id,capability_id));
CREATE INDEX entry_capabilities_capability ON entry_capabilities(capability_id);
ALTER TABLE entry_revisions ADD COLUMN capability_ids jsonb NOT NULL DEFAULT '[]';
ALTER TABLE listings ADD COLUMN track text NOT NULL DEFAULT 'other' CHECK(track IN ('software','frontend','full_stack','platform','forward_deployed','product','technical_product','other'));
ALTER TABLE listings ADD COLUMN level text NOT NULL DEFAULT '' CHECK(level IN ('','early','mid','senior','staff','principal'));
UPDATE listings SET track=CASE
  WHEN lower(family||' '||title) ~ 'forward[- ]deployed' THEN 'forward_deployed'
  WHEN lower(family||' '||title) ~ 'technical product manag' THEN 'technical_product'
  WHEN lower(family||' '||title) ~ 'product manag' THEN 'product'
  WHEN lower(family||' '||title) ~ 'full[- ]?stack' THEN 'full_stack'
  WHEN lower(family||' '||title) ~ 'front[- ]?end|/ ui\\M' THEN 'frontend'
  WHEN lower(family||' '||title) ~ 'platform|infrastructure' THEN 'platform'
  WHEN lower(family||' '||title) ~ 'engineer|developer|technical staff' THEN 'software'
  ELSE 'other' END;
UPDATE listings SET level=CASE
  WHEN x ~ 'principal' THEN 'principal'
  WHEN x ~ '\\mstaff\\M' THEN 'staff'
  WHEN x ~ '\\msenior\\M|\\msr\\M' THEN 'senior'
  WHEN x ~ '\\mmid' THEN 'mid'
  WHEN x ~ 'early|junior|entry|new grad' THEN 'early'
  ELSE '' END
FROM (SELECT id AS lid, regexp_replace(lower(seniority||' '||title),'member of technical staff','','g') AS x FROM listings) s WHERE s.lid=listings.id;
`,
  },
];
