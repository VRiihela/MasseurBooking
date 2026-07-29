-- Renumbered to 004: the task spec that introduced this file named it 003,
-- but 003 was already taken by 003_add_booking_status_timestamps.sql.

ALTER TABLE providers
  ADD COLUMN timezone TEXT NOT NULL DEFAULT 'UTC';

-- Recurring weekly template, e.g. "Mon-Fri 9:00-17:00". weekday is ISO 8601
-- (1 = Monday .. 7 = Sunday), matching Luxon's DateTime#weekday.
CREATE TABLE availability_rules (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES providers(id),
  weekday    SMALLINT NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  start_time TIME NOT NULL,
  end_time   TIME NOT NULL,
  CHECK (end_time > start_time)
);

CREATE INDEX availability_rules_provider_weekday_idx
  ON availability_rules (provider_id, weekday);

-- One-off overrides for a specific date: 'blocked' removes availability
-- within its window even during normal hours (e.g. vacation); 'open' adds
-- availability outside normal hours (e.g. an extra Saturday shift).
CREATE TABLE availability_exceptions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES providers(id),
  date        DATE NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('blocked', 'open')),
  start_time  TIME NOT NULL,
  end_time    TIME NOT NULL,
  CHECK (end_time > start_time)
);

CREATE INDEX availability_exceptions_provider_date_idx
  ON availability_exceptions (provider_id, date);
