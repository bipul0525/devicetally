-- Local hour (owner timezone) of each event, for the day-by-hour activity chart.
ALTER TABLE turns ADD COLUMN hour INTEGER;
ALTER TABLE prompts ADD COLUMN hour INTEGER;

CREATE TABLE hourly_activity (
  day TEXT NOT NULL,
  hour INTEGER NOT NULL,
  device_id TEXT NOT NULL,
  account_uuid TEXT NOT NULL,
  project_key TEXT NOT NULL,
  turns INTEGER NOT NULL DEFAULT 0,
  prompts INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, hour, device_id, account_uuid, project_key)
) WITHOUT ROWID;

UPDATE meta SET value = '2' WHERE key = 'schema_version';
