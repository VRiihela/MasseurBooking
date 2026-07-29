import type { PoolClient } from "pg";
import { withTransaction } from "../db/pool.js";
import type { Booking } from "../db/types.js";
import { ServiceNotFoundError, SlotUnavailableError } from "../errors.js";
import type { CreateBookingInput } from "../validation/bookingSchema.js";
import { enqueueBookingRequestReceived } from "./emailQueueService.js";

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
  status: "pending";
  created_at: Date;
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
  };
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
       RETURNING id, provider_id, service_id, customer_id, start_at, end_at, status, created_at`,
      [service.provider_id, service.id, customerId, startAt.toISOString(), endAt.toISOString()],
    );

    const booking = toBooking(insertResult.rows[0]);

    await enqueueBookingRequestReceived(client, booking, input.customer.email);

    return booking;
  });
}
