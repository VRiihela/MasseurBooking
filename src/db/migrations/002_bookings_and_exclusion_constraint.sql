-- Bookings use UUID primary keys (not serial) so booking ids are not enumerable
-- once the confirm/decline and magic-link endpoints reference bookings by id.

CREATE TABLE bookings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES providers(id),
  service_id  UUID NOT NULL REFERENCES services(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  start_at    TIMESTAMPTZ NOT NULL,
  end_at      TIMESTAMPTZ NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'cancelled')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_at > start_at),
  -- Hard backstop: overlapping pending/confirmed bookings for the same provider
  -- are impossible at the database level, independent of application logic.
  EXCLUDE USING gist (
    provider_id WITH =,
    tstzrange(start_at, end_at) WITH &&
  ) WHERE (status IN ('pending', 'confirmed'))
);

CREATE INDEX bookings_provider_start_at_idx ON bookings (provider_id, start_at);

-- Transactional outbox: enqueued in the same transaction as the booking insert
-- so the "request received" email job can never be lost or duplicated relative
-- to the booking write. A separate worker (out of scope) polls/sends these.
CREATE TABLE email_jobs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type       TEXT NOT NULL,
  payload    JSONB NOT NULL,
  status     TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
