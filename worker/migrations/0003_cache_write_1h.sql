-- Cache writes to the 1-hour cache cost more than 5-minute ones; included in cache_write_tok.
ALTER TABLE turns ADD COLUMN cache_write_1h_tok INTEGER NOT NULL DEFAULT 0;
ALTER TABLE daily_rollup ADD COLUMN cache_write_1h_tok INTEGER NOT NULL DEFAULT 0;
UPDATE meta SET value = '3' WHERE key = 'schema_version';
