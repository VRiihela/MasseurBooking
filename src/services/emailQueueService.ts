import type { PoolClient } from "pg";
import type { Booking } from "../db/types.js";

/**
 * Inserted into the email_jobs outbox table within the same DB transaction as
 * the booking insert, so the job is atomic with booking creation.
 */
export async function enqueueBookingRequestReceived(
  client: PoolClient,
  booking: Booking,
  customerEmail: string,
): Promise<void> {
  await client.query(`INSERT INTO email_jobs (type, payload) VALUES ($1, $2::jsonb)`, [
    "booking_request_received",
    JSON.stringify({ bookingId: booking.id, customerEmail }),
  ]);
}
