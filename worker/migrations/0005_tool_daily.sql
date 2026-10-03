-- Other AI coding tools (read on each device by tokscale): token totals per device, day, tool and model.
-- Each upload replaces that device's rows for the days and tools it sends (snapshot, so re-sending is harmless).
CREATE TABLE tool_daily (
  device_id TEXT NOT NULL,
  day TEXT NOT NULL,           -- the device's local day
  tool TEXT NOT NULL,          -- tokscale client id: codex, opencode, kimi, ...
  model TEXT NOT NULL,
  provider TEXT,
  in_tok INTEGER NOT NULL DEFAULT 0,
  out_tok INTEGER NOT NULL DEFAULT 0,
  cache_read_tok INTEGER NOT NULL DEFAULT 0,
  cache_write_tok INTEGER NOT NULL DEFAULT 0,
  reasoning_tok INTEGER NOT NULL DEFAULT 0,
  messages INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (device_id, day, tool, model)
) WITHOUT ROWID;
CREATE INDEX tool_daily_day ON tool_daily (day);

-- Tools found on each device, so the dashboard can offer to track them (off until enabled).
CREATE TABLE tools_seen (
  device_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  PRIMARY KEY (device_id, tool)
) WITHOUT ROWID;

UPDATE meta SET value = '5' WHERE key = 'schema_version';
