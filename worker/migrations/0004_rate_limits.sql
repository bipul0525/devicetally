-- Failed attempts per client address, for endpoints that must not be guessable (enrollment codes).
CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);
UPDATE meta SET value = '4' WHERE key = 'schema_version';
