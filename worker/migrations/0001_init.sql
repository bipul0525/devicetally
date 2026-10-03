-- Owner login (single row).
CREATE TABLE owner (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,          -- pbkdf2$<iterations>$<salt b64>$<hash b64>
  timezone TEXT NOT NULL DEFAULT 'UTC',
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE auth_sessions (
  id_hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  user_agent TEXT
);

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  os TEXT, arch TEXT, agent_version TEXT,
  key_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_seen INTEGER,
  revoked_at INTEGER
);

CREATE TABLE enroll_codes (
  code_hash TEXT PRIMARY KEY,
  device_name TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE TABLE accounts (
  uuid TEXT PRIMARY KEY,
  email TEXT, display_name TEXT, org_name TEXT, plan TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('approved', 'ignored', 'pending')),
  first_seen_device TEXT,
  first_seen_at INTEGER
);

CREATE TABLE projects (key TEXT PRIMARY KEY, display_name TEXT);

-- `day` columns are local days (owner timezone), set at ingest.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  account_uuid TEXT NOT NULL,
  project_key TEXT NOT NULL,
  cwd TEXT, git_branch TEXT, title TEXT, entrypoint TEXT, cc_version TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  day TEXT NOT NULL,
  active_seconds INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX sessions_device_day ON sessions (device_id, day);

CREATE TABLE turns (
  id TEXT PRIMARY KEY,                  -- message.id
  session_id TEXT NOT NULL,
  account_uuid TEXT NOT NULL,
  ts INTEGER NOT NULL,
  day TEXT NOT NULL,
  model TEXT, effort TEXT,
  in_tok INTEGER NOT NULL DEFAULT 0,
  out_tok INTEGER NOT NULL DEFAULT 0,
  cache_write_tok INTEGER NOT NULL DEFAULT 0,
  cache_read_tok INTEGER NOT NULL DEFAULT 0,
  thinking_tok INTEGER,                 -- NULL when the transcript doesn't report it
  is_subagent INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX turns_session ON turns (session_id, ts);

CREATE TABLE prompts (
  id TEXT PRIMARY KEY,                  -- promptId
  session_id TEXT NOT NULL,
  account_uuid TEXT NOT NULL,
  ts INTEGER NOT NULL,
  day TEXT NOT NULL,
  text TEXT
);
CREATE INDEX prompts_session ON prompts (session_id, ts);

CREATE VIRTUAL TABLE prompts_fts USING fts5 (text, content = 'prompts', content_rowid = 'rowid');
CREATE TRIGGER prompts_ai AFTER INSERT ON prompts BEGIN
  INSERT INTO prompts_fts (rowid, text) VALUES (new.rowid, new.text);
END;
CREATE TRIGGER prompts_ad AFTER DELETE ON prompts BEGIN
  INSERT INTO prompts_fts (prompts_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
END;

-- Prompt and session counts use model = '' and effort = ''.
CREATE TABLE daily_rollup (
  day TEXT NOT NULL,
  device_id TEXT NOT NULL,
  account_uuid TEXT NOT NULL,
  project_key TEXT NOT NULL,
  model TEXT NOT NULL,
  effort TEXT NOT NULL,
  in_tok INTEGER NOT NULL DEFAULT 0,
  out_tok INTEGER NOT NULL DEFAULT 0,
  cache_write_tok INTEGER NOT NULL DEFAULT 0,
  cache_read_tok INTEGER NOT NULL DEFAULT 0,
  thinking_tok INTEGER NOT NULL DEFAULT 0,
  turns INTEGER NOT NULL DEFAULT 0,
  prompts INTEGER NOT NULL DEFAULT 0,
  sessions INTEGER NOT NULL DEFAULT 0,
  active_seconds INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, device_id, account_uuid, project_key, model, effort)
) WITHOUT ROWID;

CREATE TABLE settings (
  scope TEXT NOT NULL CHECK (scope IN ('global', 'account', 'device', 'project')),
  scope_id TEXT NOT NULL DEFAULT '',
  json TEXT NOT NULL,
  PRIMARY KEY (scope, scope_id)
);

INSERT INTO meta (key, value) VALUES ('schema_version', '1');
