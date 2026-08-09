-- Minimal Provider/Service/Customer tables needed as FK targets for Booking.
-- Full CRUD/management of these entities is out of scope for this task.

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid() on Postgres < 13
CREATE EXTENSION IF NOT EXISTS btree_gist; -- required for the booking exclusion constraint

CREATE TABLE providers (
  id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL
);

CREATE TABLE services (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id           UUID NOT NULL REFERENCES providers(id),
  duration_minutes      INTEGER NOT NULL CHECK (duration_minutes > 0),
  buffer_before_minutes INTEGER NOT NULL DEFAULT 0 CHECK (buffer_before_minutes >= 0),
  buffer_after_minutes  INTEGER NOT NULL DEFAULT 0 CHECK (buffer_after_minutes >= 0),
  active                BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE customers (
  id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name  TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL
);
