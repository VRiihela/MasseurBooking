import { DateTime } from "luxon";
import type { PoolClient } from "pg";
import type { Booking } from "../db/types.js";

function formatLocalStartTime(startAt: Date, timezone: string): string {
  return DateTime.fromJSDate(startAt, { zone: "utc" })
    .setZone(timezone)
    .toFormat("cccc, LLLL d, yyyy 'at' h:mm a ZZZZ");
}

interface EnqueueContext {
  customerName: string;
  serviceName: string;
  providerTimezone: string;
}

async function insertEmailJob(
  client: PoolClient,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await client.query(`INSERT INTO email_jobs (type, payload) VALUES ($1, $2::jsonb)`, [
    type,
    JSON.stringify(payload),
  ]);
}

/**
 * Payloads snapshot everything the email templates need at enqueue time
 * (customer name, service name, formatted local start time) so the worker
 * never has to re-query bookings/services/customers at send time -- those
 * rows could change between enqueue and send, and snapshotting avoids that
 * class of bug entirely.
 */
export async function enqueueBookingRequestReceived(
  client: PoolClient,
  booking: Booking,
  customerEmail: string,
  context: EnqueueContext,
): Promise<void> {
  await insertEmailJob(client, "booking_request_received", {
    bookingId: booking.id,
    customerEmail,
    customerName: context.customerName,
    serviceName: context.serviceName,
    startAtLocal: formatLocalStartTime(booking.startAt, context.providerTimezone),
  });
}

export async function enqueueBookingConfirmed(
  client: PoolClient,
  booking: Booking,
  customerEmail: string,
  context: EnqueueContext,
): Promise<void> {
  await insertEmailJob(client, "booking_confirmed", {
    bookingId: booking.id,
    customerEmail,
    customerName: context.customerName,
    serviceName: context.serviceName,
    startAtLocal: formatLocalStartTime(booking.startAt, context.providerTimezone),
  });
}

export async function enqueueMasseurLoginLink(
  client: PoolClient,
  params: { rawLoginToken: string; adminEmail: string; appBaseUrl: string },
): Promise<void> {
  await insertEmailJob(client, "masseur_login_link", {
    adminEmail: params.adminEmail,
    loginUrl: `${params.appBaseUrl}/auth/login?token=${params.rawLoginToken}`,
  });
}

export async function enqueueBookingDeclined(
  client: PoolClient,
  booking: Booking,
  customerEmail: string,
  context: EnqueueContext,
): Promise<void> {
  await insertEmailJob(client, "booking_declined", {
    bookingId: booking.id,
    customerEmail,
    customerName: context.customerName,
    serviceName: context.serviceName,
    startAtLocal: formatLocalStartTime(booking.startAt, context.providerTimezone),
    cancellationReason: booking.cancellationReason,
  });
}
