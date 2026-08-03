import { DateTime } from "luxon";

/**
 * Shared by emailQueueService (email bodies) and bookingService (the
 * customer-facing GET /bookings/:id view) -- both need the same UTC-stored
 * instant rendered as a human-readable string in the provider's local
 * timezone.
 */
export function formatLocalTime(date: Date, timezone: string): string {
  return DateTime.fromJSDate(date, { zone: "utc" })
    .setZone(timezone)
    .toFormat("cccc, LLLL d, yyyy 'at' h:mm a ZZZZ");
}
