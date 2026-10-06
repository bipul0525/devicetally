-- Reads that used to scan whole tables (D1's free plan counts every row read):
-- the Prompts list filters by day; each computer's 5-minute summary filters by device and day.
CREATE INDEX IF NOT EXISTS prompts_day ON prompts (day, ts);
CREATE INDEX IF NOT EXISTS daily_rollup_device_day ON daily_rollup (device_id, day);
CREATE INDEX IF NOT EXISTS tool_daily_device_day ON tool_daily (device_id, day);
