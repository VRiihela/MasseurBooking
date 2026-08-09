import { z } from "zod";

// 'completed' is intentionally excluded -- the bookings table has never had
// a fourth status; the CHECK constraint from migration 002 only allows
// pending/confirmed/cancelled (see documents/masseur-booking-system-design.md's
// corrected Booking data model). ?status=completed is rejected like any
// other unrecognized value, not silently accepted as an always-empty filter.
export const adminBookingsQuerySchema = z
  .object({
    status: z.enum(["pending", "confirmed", "cancelled"]).optional(),
  })
  .strict();

export type AdminBookingsQueryInput = z.infer<typeof adminBookingsQuerySchema>;
