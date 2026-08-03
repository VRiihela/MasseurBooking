-- One row per email sent for a booking -- not one row per booking. Every
-- token issued remains valid indefinitely (no rotation, no expiry) for as
-- long as the booking itself allows customer actions; see
-- src/services/bookingTokenService.ts. Only the hash is ever stored -- the
-- raw token lives only in the email payload until emailWorker.ts redacts it
-- post-send.

CREATE TABLE customer_booking_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id),
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
