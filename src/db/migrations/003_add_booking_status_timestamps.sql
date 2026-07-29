-- Timestamps/reason for the confirm/decline transitions (002-booking-confirm-decline).
ALTER TABLE bookings
  ADD COLUMN confirmed_at TIMESTAMPTZ,
  ADD COLUMN cancelled_at TIMESTAMPTZ,
  ADD COLUMN cancellation_reason TEXT;
