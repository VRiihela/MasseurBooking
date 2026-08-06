-- name backfilled for any pre-existing rows (today, only ever inserted via
-- test fixtures) before being made required -- going forward every service
-- created through POST /admin/services must supply one.
ALTER TABLE services ADD COLUMN name TEXT;
UPDATE services SET name = 'Unnamed service' WHERE name IS NULL;
ALTER TABLE services ALTER COLUMN name SET NOT NULL;

-- Nullable at the DB level (existing rows have none, and not every service
-- necessarily has a fixed price); POST /admin/services requires it at the
-- API layer, PATCH does not.
ALTER TABLE services ADD COLUMN price NUMERIC(10, 2);
