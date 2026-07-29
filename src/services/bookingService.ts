import type { PoolClient } from "pg";
import { withTransaction } from "../db/pool.js";
import type { Booking } from "../db/types.js";
import {
  BookingNotFoundError,
  BookingNotPendingError,
  ServiceNotFoundError,
  SlotUnavailableError,
} from "../errors.js";
import type { CreateBookingInput } from "../validation/bookingSchema.js";
import {
  enqueueBookingConfirmed,
  enqueueBookingDeclined,
  enqueueBookingRequestReceived,
} from "./emailQueueService.js";

interface ServiceRow {
  id: string;
  provider_id: string;
  duration_minutes: number;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
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
    `SELECT id, provider_id, duration_minutes, buffer_before_minutes, buffer_after_minutes
     FROM services WHERE id = $1 AND active = true`,
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

async function loadCustomerEmail(client: PoolClient, customerId: string): Promise<string> {
  const result = await client.query<{ email: string }>(
    `SELECT email FROM customers WHERE id = $1`,
    [customerId],
  );
  // customer_id is a NOT NULL FK to customers, so a booking row always has one.
  return result.rows[0].email;
}

export async function createBooking(input: CreateBookingInput): Promise<Booking> {
  return withTransaction(async (client) => {
    const service = await loadActiveService(client, input.service_id);

    await lockProvider(client, service.provider_id);

    const startAt = new Date(input.start_at);
    // end_at is always derived server-side from the service definition —
    // never accepted from the client.
    const totalMinutes =
      service.duration_minutes + service.buffer_before_minutes + service.buffer_after_minutes;
    const endAt = new Date(startAt.getTime() + totalMinutes * 60_000);

    if (await hasOverlappingBooking(client, service.provider_id, startAt, endAt)) {
      throw new SlotUnavailableError();
    }

    const customerId = await insertCustomer(client, input.customer);

    const insertResult = await client.query<BookingRow>(
      `INSERT INTO bookings (provider_id, service_id, customer_id, start_at, end_at, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       RETURNING ${BOOKING_COLUMNS}`,
      [service.provider_id, service.id, customerId, startAt.toISOString(), endAt.toISOString()],
    );

    const booking = toBooking(insertResult.rows[0]);

    await enqueueBookingRequestReceived(client, booking, input.customer.email);

    return booking;
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
    const customerEmail = await loadCustomerEmail(client, booking.customerId);
    await enqueueBookingConfirmed(client, booking, customerEmail);
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
    const customerEmail = await loadCustomerEmail(client, booking.customerId);
    await enqueueBookingDeclined(client, booking, customerEmail);
    return booking;
  });
}
