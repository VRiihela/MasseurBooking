import type { PoolClient } from "pg";
import { loadAdminEmail, loadAppBaseUrl } from "../config/auth.js";
import type { Booking } from "../db/types.js";
import { formatLocalTime } from "./timeFormat.js";

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
 * Every customer-facing booking email carries a manage link built from a
 * freshly minted token (see bookingTokenService.mintCustomerToken) -- tokens
 * are never reused across emails, so each call site mints its own before
 * enqueueing.
 */
function buildManageUrl(bookingId: string, rawToken: string): string {
  return `${loadAppBaseUrl()}/bookings/${bookingId}?token=${rawToken}`;
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
  rawToken: string,
): Promise<void> {
  await insertEmailJob(client, "booking_request_received", {
    bookingId: booking.id,
    customerEmail,
    customerName: context.customerName,
    serviceName: context.serviceName,
    startAtLocal: formatLocalTime(booking.startAt, context.providerTimezone),
    manageUrl: buildManageUrl(booking.id, rawToken),
  });
}

export async function enqueueBookingConfirmed(
  client: PoolClient,
  booking: Booking,
  customerEmail: string,
  context: EnqueueContext,
  rawToken: string,
): Promise<void> {
  await insertEmailJob(client, "booking_confirmed", {
    bookingId: booking.id,
    customerEmail,
    customerName: context.customerName,
    serviceName: context.serviceName,
    startAtLocal: formatLocalTime(booking.startAt, context.providerTimezone),
    manageUrl: buildManageUrl(booking.id, rawToken),
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
  rawToken: string,
): Promise<void> {
  await insertEmailJob(client, "booking_declined", {
    bookingId: booking.id,
    customerEmail,
    customerName: context.customerName,
    serviceName: context.serviceName,
    startAtLocal: formatLocalTime(booking.startAt, context.providerTimezone),
    cancellationReason: booking.cancellationReason,
    manageUrl: buildManageUrl(booking.id, rawToken),
  });
}

export async function enqueueBookingCancelledByCustomer(
  client: PoolClient,
  booking: Booking,
  customerEmail: string,
  context: EnqueueContext,
  rawToken: string,
): Promise<void> {
  await insertEmailJob(client, "booking_cancelled_by_customer", {
    bookingId: booking.id,
    customerEmail,
    customerName: context.customerName,
    serviceName: context.serviceName,
    startAtLocal: formatLocalTime(booking.startAt, context.providerTimezone),
    cancellationReason: booking.cancellationReason,
    manageUrl: buildManageUrl(booking.id, rawToken),
  });
}

export async function enqueueBookingCancelledByMasseur(
  client: PoolClient,
  booking: Booking,
  customerEmail: string,
  context: EnqueueContext,
  rawToken: string,
): Promise<void> {
  await insertEmailJob(client, "booking_cancelled_by_masseur", {
    bookingId: booking.id,
    customerEmail,
    customerName: context.customerName,
    serviceName: context.serviceName,
    startAtLocal: formatLocalTime(booking.startAt, context.providerTimezone),
    cancellationReason: booking.cancellationReason,
    manageUrl: buildManageUrl(booking.id, rawToken),
  });
}

/**
 * Fired whenever a customer action frees a slot on the masseur's schedule --
 * a direct cancel, or the cancel half of a reschedule. cancellationReason
 * ('cancelled by customer' vs 'rescheduled by customer') is what lets the
 * masseur tell the two apart from the email body alone.
 */
export async function enqueueMasseurBookingChangeNotice(
  client: PoolClient,
  booking: Booking,
  context: { serviceName: string; providerTimezone: string },
): Promise<void> {
  await insertEmailJob(client, "masseur_booking_change_notice", {
    adminEmail: loadAdminEmail(),
    bookingId: booking.id,
    serviceName: context.serviceName,
    startAtLocal: formatLocalTime(booking.startAt, context.providerTimezone),
    cancellationReason: booking.cancellationReason,
  });
}
