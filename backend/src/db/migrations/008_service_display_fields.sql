-- Nullable at the DB level (existing rows have none, and not every service
-- necessarily has a fixed price); POST /admin/services requires it at the
-- API layer, PATCH does not.
ALTER TABLE services ADD COLUMN price NUMERIC(10, 2);
