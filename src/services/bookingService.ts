import type { PoolClient } from "pg";
import { getPool, withTransaction } from "../db/pool.js";
import type { Booking, BookingStatus } from "../db/types.js";
import {
  BookingNotFoundError,
  BookingNotModifiableError,
  BookingNotPendingError,
  ServiceNotFoundError,
  SlotUnavailableError,
} from "../errors.js";
import type { CreateBookingInput } from "../validation/bookingSchema.js";
import { hashToken, mintCustomerToken } from "./bookingTokenService.js";
import {
  enqueueBookingCancelledByCustomer,
  enqueueBookingConfirmed,
  enqueueBookingDeclined,
  enqueueBookingRequestReceived,
  enqueueMasseurBookingChangeNotice,
} from "./emailQueueService.js";
import { formatLocalTime } from "./timeFormat.js";

interface ServiceRow {
  id: string;
  provider_id: string;
  name: string;
  duration_minutes: number;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  provider_timezone: string;
}

interface BookingRow {
  id: string;
  provider_id: string;
  service_id: string;
  customer_id: string;
  start_at: Date;
  end_at: Date;
  status: "pending" | "confirmed" | "cancelled";
  created_at: Date;
  confirmed_at: Date | null;
  cancelled_at: Date | null;
  cancellation_reason: string | null;
}

const BOOKING_COLUMNS = `id, provider_id, service_id, customer_id, start_at, end_at, status,
       created_at, confirmed_at, cancelled_at, cancellation_reason`;

async function findBookingById(client: PoolClient, id: string): Promise<BookingRow | undefined> {
  const result = await client.query<BookingRow>(
    `SELECT ${BOOKING_COLUMNS} FROM bookings WHERE id = $1`,
    [id],
  );
  return result.rows[0];
}

/**
 * Confirm/decline transitions race against an *existing* row (unlike
 * creation, which races against a not-yet-existing one), so a plain
 * conditional UPDATE is enough to serialize concurrent attempts: Postgres's
 * normal row-level locking makes the second UPDATE wait for the first to
 * commit, then its WHERE clause re-evaluates against the now-committed row
 * and matches zero rows. No advisory lock needed here.
 */
async function transitionPendingBooking(
  client: PoolClient,
  id: string,
  setClause: string,
  params: unknown[],
): Promise<BookingRow> {
  const result = await client.query<BookingRow>(
    `UPDATE bookings SET ${setClause}
     WHERE id = $1 AND status = 'pending'
     RETURNING ${BOOKING_COLUMNS}`,
    [id, ...params],
  );
  const row = result.rows[0];
  if (row) {
    return row;
  }

  const existing = await findBookingById(client, id);
  if (!existing) {
    throw new BookingNotFoundError();
  }
  throw new BookingNotPendingError();
}

/**
 * Same pattern as transitionPendingBooking, but for customer-initiated
 * cancel/reschedule: the starting state may be 'pending' or 'confirmed', and
 * a mismatch means the booking is already cancelled -- there is no separate
 * "completed" status in this schema. Caller has already proven token access
 * before this runs, so a 409 here is safe (it doesn't leak existence).
 */
async function transitionModifiableBooking(
  client: PoolClient,
  id: string,
  setClause: string,
  params: unknown[],
): Promise<BookingRow> {
  const result = await client.query<BookingRow>(
    `UPDATE bookings SET ${setClause}
     WHERE id = $1 AND status IN ('pending', 'confirmed')
     RETURNING ${BOOKING_COLUMNS}`,
    [id, ...params],
  );
  const row = result.rows[0];
  if (!row) {
    throw new BookingNotModifiableError();
  }
  return row;
}

/**
 * SELECT ... FOR UPDATE only locks rows that already match, so it never
 * serializes two concurrent requests for a genuinely empty slot (nothing to
 * lock yet). The advisory lock, keyed on provider_id, is what actually
 * serializes concurrent booking attempts for the same provider; the
 * exclusion constraint remains the DB-level backstop for anything that
 * bypasses this code path entirely.
 */
async function lockProvider(client: PoolClient, providerId: string): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [providerId]);
}

async function loadActiveService(client: PoolClient, serviceId: string): Promise<ServiceRow> {
  const result = await client.query<ServiceRow>(
    `SELECT s.id, s.provider_id, s.name, s.duration_minutes, s.buffer_before_minutes,
            s.buffer_after_minutes, p.timezone AS provider_timezone
     FROM services s
     JOIN providers p ON p.id = s.provider_id
     WHERE s.id = $1 AND s.active = true`,
    [serviceId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ServiceNotFoundError();
  }
  return row;
}

async function hasOverlappingBooking(
  client: PoolClient,
  providerId: string,
  startAt: Date,
  endAt: Date,
): Promise<boolean> {
  const result = await client.query(
    `SELECT 1 FROM bookings
     WHERE provider_id = $1
       AND status IN ('pending', 'confirmed')
       AND tstzrange(start_at, end_at) && tstzrange($2, $3)
     FOR UPDATE`,
    [providerId, startAt.toISOString(), endAt.toISOString()],
  );
  return (result.rowCount ?? 0) > 0;
}

async function insertCustomer(
  client: PoolClient,
  customer: CreateBookingInput["customer"],
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO customers (name, email, phone) VALUES ($1, $2, $3) RETURNING id`,
    [customer.name, customer.email, customer.phone],
  );
  return result.rows[0].id;
}

function toBooking(row: BookingRow): Booking {
  return {
    id: row.id,
    providerId: row.provider_id,
    serviceId: row.service_id,
    customerId: row.customer_id,
    startAt: row.start_at,
    endAt: row.end_at,
    status: row.status,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at,
    cancelledAt: row.cancelled_at,
    cancellationReason: row.cancellation_reason,
  };
}

interface BookingEmailContextRow {
  customer_email: string;
  customer_name: string;
  service_name: string;
  provider_timezone: string;
}

/**
 * One join covering customers+services+providers via the booking's own FKs,
 * used by confirm/decline/cancel/reschedule to build the email payload
 * without the caller having to separately re-fetch each related row.
 */
async function loadBookingEmailContext(
  client: PoolClient,
  booking: Booking,
): Promise<BookingEmailContextRow> {
  const result = await client.query<BookingEmailContextRow>(
    `SELECT c.email AS customer_email, c.name AS customer_name,
            s.name AS service_name, p.timezone AS provider_timezone
     FROM bookings b
     JOIN customers c ON c.id = b.customer_id
     JOIN services s ON s.id = b.service_id
     JOIN providers p ON p.id = b.provider_id
     WHERE b.id = $1`,
    [booking.id],
  );
  // The booking's FKs are all NOT NULL, so this always resolves to one row.
  return result.rows[0];
}

/**
 * The concurrency-safe core shared by createBooking (a brand-new customer)
 * and rescheduleBookingForCustomer (an existing customer moving to a new
 * time) -- same advisory lock, overlap check, and exclusion-constraint
 * backstop either way, so reschedule never needs its own, separately-proven
 * concurrency logic.
 *
 * resolveCustomerId is called only once the slot has passed the overlap
 * check -- for a brand-new booking that's where the customer row is
 * inserted (matching the original createBooking's call order); for a
 * reschedule it's a no-op that just returns the existing customer id.
 */
async function createBookingCore(
  client: PoolClient,
  serviceId: string,
  resolveCustomerId: () => Promise<string>,
  startAtIso: string,
  customerEmail: string,
  customerName: string,
): Promise<Booking> {
  const service = await loadActiveService(client, serviceId);

  await lockProvider(client, service.provider_id);

  const startAt = new Date(startAtIso);
  // end_at is always derived server-side from the service definition --
  // never accepted from the client.
  const totalMinutes =
    service.duration_minutes + service.buffer_before_minutes + service.buffer_after_minutes;
  const endAt = new Date(startAt.getTime() + totalMinutes * 60_000);

  if (await hasOverlappingBooking(client, service.provider_id, startAt, endAt)) {
    throw new SlotUnavailableError();
  }

  const customerId = await resolveCustomerId();

  const insertResult = await client.query<BookingRow>(
    `INSERT INTO bookings (provider_id, service_id, customer_id, start_at, end_at, status)
     VALUES ($1, $2, $3, $4, $5, 'pending')
     RETURNING ${BOOKING_COLUMNS}`,
    [service.provider_id, serviceId, customerId, startAt.toISOString(), endAt.toISOString()],
  );

  const booking = toBooking(insertResult.rows[0]);
  const rawToken = await mintCustomerToken(client, booking.id);

  await enqueueBookingRequestReceived(
    client,
    booking,
    customerEmail,
    { customerName, serviceName: service.name, providerTimezone: service.provider_timezone },
    rawToken,
  );

  return booking;
}

export async function createBooking(input: CreateBookingInput): Promise<Booking> {
  return withTransaction(async (client) => {
    return createBookingCore(
      client,
      input.service_id,
      () => insertCustomer(client, input.customer),
      input.start_at,
      input.customer.email,
      input.customer.name,
    );
  });
}

export async function confirmBooking(id: string): Promise<Booking> {
  return withTransaction(async (client) => {
    const row = await transitionPendingBooking(
      client,
      id,
      "status = 'confirmed', confirmed_at = now()",
      [],
    );
    const booking = toBooking(row);
    const context = await loadBookingEmailContext(client, booking);
    const rawToken = await mintCustomerToken(client, booking.id);
    await enqueueBookingConfirmed(
      client,
      booking,
      context.customer_email,
      {
        customerName: context.customer_name,
        serviceName: context.service_name,
        providerTimezone: context.provider_timezone,
      },
      rawToken,
    );
    return booking;
  });
}

export async function declineBooking(id: string, reason: string | undefined): Promise<Booking> {
  return withTransaction(async (client) => {
    const row = await transitionPendingBooking(
      client,
      id,
      "status = 'cancelled', cancelled_at = now(), cancellation_reason = $2",
      [reason ?? null],
    );
    const booking = toBooking(row);
    const context = await loadBookingEmailContext(client, booking);
    const rawToken = await mintCustomerToken(client, booking.id);
    await enqueueBookingDeclined(
      client,
      booking,
      context.customer_email,
      {
        customerName: context.customer_name,
        serviceName: context.service_name,
        providerTimezone: context.provider_timezone,
      },
      rawToken,
    );
    return booking;
  });
}

/**
 * Combines the booking-id and token checks into one query so a mismatch on
 * either side (wrong id, wrong token, or both) is indistinguishable to the
 * caller -- see BookingNotFoundError usage in the three functions below.
 */
async function customerHasAccess(
  client: PoolClient,
  bookingId: string,
  rawToken: string,
): Promise<boolean> {
  const result = await client.query(
    `SELECT 1 FROM customer_booking_tokens WHERE booking_id = $1 AND token_hash = $2`,
    [bookingId, hashToken(rawToken)],
  );
  return (result.rowCount ?? 0) > 0;
}

export interface CustomerBookingView {
  id: string;
  status: BookingStatus;
  serviceName: string;
  startAtLocal: string;
  endAtLocal: string;
}

interface CustomerBookingViewRow {
  id: string;
  status: BookingStatus;
  start_at: Date;
  end_at: Date;
  service_name: string;
  provider_timezone: string;
}

export async function getBookingForCustomer(
  bookingId: string,
  rawToken: string,
): Promise<CustomerBookingView> {
  const result = await getPool().query<CustomerBookingViewRow>(
    `SELECT b.id, b.status, b.start_at, b.end_at, s.name AS service_name, p.timezone AS provider_timezone
     FROM customer_booking_tokens t
     JOIN bookings b ON b.id = t.booking_id
     JOIN services s ON s.id = b.service_id
     JOIN providers p ON p.id = b.provider_id
     WHERE t.booking_id = $1 AND t.token_hash = $2`,
    [bookingId, hashToken(rawToken)],
  );

  const row = result.rows[0];
  if (!row) {
    throw new BookingNotFoundError();
  }

  return {
    id: row.id,
    status: row.status,
    serviceName: row.service_name,
    startAtLocal: formatLocalTime(row.start_at, row.provider_timezone),
    endAtLocal: formatLocalTime(row.end_at, row.provider_timezone),
  };
}

export async function cancelBookingForCustomer(
  bookingId: string,
  rawToken: string,
): Promise<Booking> {
  return withTransaction(async (client) => {
    if (!(await customerHasAccess(client, bookingId, rawToken))) {
      throw new BookingNotFoundError();
    }

    const row = await transitionModifiableBooking(
      client,
      bookingId,
      "status = 'cancelled', cancelled_at = now(), cancellation_reason = 'cancelled by customer'",
      [],
    );
    const booking = toBooking(row);
    const context = await loadBookingEmailContext(client, booking);
    const rawManageToken = await mintCustomerToken(client, booking.id);

    await enqueueBookingCancelledByCustomer(
      client,
      booking,
      context.customer_email,
      {
        customerName: context.customer_name,
        serviceName: context.service_name,
        providerTimezone: context.provider_timezone,
      },
      rawManageToken,
    );
    await enqueueMasseurBookingChangeNotice(client, booking, {
      serviceName: context.service_name,
      providerTimezone: context.provider_timezone,
    });

    return booking;
  });
}

export async function rescheduleBookingForCustomer(
  bookingId: string,
  rawToken: string,
  newStartAt: string,
): Promise<Booking> {
  return withTransaction(async (client) => {
    if (!(await customerHasAccess(client, bookingId, rawToken))) {
      throw new BookingNotFoundError();
    }

    const oldRow = await transitionModifiableBooking(
      client,
      bookingId,
      "status = 'cancelled', cancelled_at = now(), cancellation_reason = 'rescheduled by customer'",
      [],
    );
    const oldBooking = toBooking(oldRow);
    const context = await loadBookingEmailContext(client, oldBooking);

    // Reschedule frees the old slot the same way a plain cancel does, so it
    // gets the same masseur notification -- cancellationReason is what lets
    // the masseur tell "cancelled by customer" apart from "rescheduled by
    // customer" from the email body alone.
    await enqueueMasseurBookingChangeNotice(client, oldBooking, {
      serviceName: context.service_name,
      providerTimezone: context.provider_timezone,
    });

    return createBookingCore(
      client,
      oldBooking.serviceId,
      () => Promise.resolve(oldBooking.customerId),
      newStartAt,
      context.customer_email,
      context.customer_name,
    );
  });
}
