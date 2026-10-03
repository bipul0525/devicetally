-- Each computer's latest check-in from the app (tracking health, disk), and one disk reading a day
-- for the "full in about N weeks" estimate.
ALTER TABLE devices ADD COLUMN health TEXT;
ALTER TABLE devices ADD COLUMN health_at INTEGER;
CREATE TABLE disk_samples (
  device_id TEXT NOT NULL,
  day TEXT NOT NULL,
  free INTEGER NOT NULL,
  total INTEGER NOT NULL,
  PRIMARY KEY (device_id, day)
);
