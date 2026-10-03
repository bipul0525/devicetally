-- A joined computer asks the admin to disconnect it; the admin approves (revokes) or declines.
ALTER TABLE devices ADD COLUMN disconnect_requested_at INTEGER;
