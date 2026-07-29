import type { Pool } from "pg";

/**
 * Integration tests get a Provider/Service to book against via fixture rows
 * inserted here in beforeEach — there is no seed migration. Migrations only
 * create schema (tables, constraints, extensions); they never insert rows.
 */
export async function resetAndSeed(
  pool: Pool,
  timezone = "UTC",
): Promise<{ providerId: string; serviceId: string }> {
  await pool.query("DELETE FROM email_jobs");
  await pool.query("DELETE FROM bookings");
  await pool.query("DELETE FROM availability_exceptions");
  await pool.query("DELETE FROM availability_rules");
  await pool.query("DELETE FROM customers");
  await pool.query("DELETE FROM services");
  await pool.query("DELETE FROM providers");

  const providerResult = await pool.query<{ id: string }>(
    `INSERT INTO providers (name, timezone) VALUES ('Test Masseur', $1) RETURNING id`,
    [timezone],
  );
  const providerId = providerResult.rows[0].id;

  const serviceResult = await pool.query<{ id: string }>(
    `INSERT INTO services (provider_id, duration_minutes, buffer_before_minutes, buffer_after_minutes, active)
     VALUES ($1, 60, 0, 15, true) RETURNING id`,
    [providerId],
  );
  const serviceId = serviceResult.rows[0].id;

  return { providerId, serviceId };
}

export async function createAvailabilityRule(
  pool: Pool,
  providerId: string,
  weekday: number,
  startTime: string,
  endTime: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO availability_rules (provider_id, weekday, start_time, end_time) VALUES ($1, $2, $3, $4)`,
    [providerId, weekday, startTime, endTime],
  );
}

export async function createAvailabilityException(
  pool: Pool,
  providerId: string,
  date: string,
  type: "blocked" | "open",
  startTime: string,
  endTime: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO availability_exceptions (provider_id, date, type, start_time, end_time) VALUES ($1, $2, $3, $4, $5)`,
    [providerId, date, type, startTime, endTime],
  );
}

export async function createBookingAt(
  pool: Pool,
  providerId: string,
  serviceId: string,
  startAt: string,
  endAt: string,
  status: "pending" | "confirmed" | "cancelled" = "pending",
): Promise<string> {
  const customerResult = await pool.query<{ id: string }>(
    `INSERT INTO customers (name, email, phone) VALUES ('Jane Doe', 'jane@example.com', '+1234567890') RETURNING id`,
  );
  const customerId = customerResult.rows[0].id;

  const bookingResult = await pool.query<{ id: string }>(
    `INSERT INTO bookings (provider_id, service_id, customer_id, start_at, end_at, status)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [providerId, serviceId, customerId, startAt, endAt, status],
  );

  return bookingResult.rows[0].id;
}

export async function createPendingBooking(
  pool: Pool,
  providerId: string,
  serviceId: string,
): Promise<string> {
  const customerResult = await pool.query<{ id: string }>(
    `INSERT INTO customers (name, email, phone) VALUES ('Jane Doe', 'jane@example.com', '+1234567890') RETURNING id`,
  );
  const customerId = customerResult.rows[0].id;

  const startAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const endAt = new Date(startAt.getTime() + 60 * 60_000);

  const bookingResult = await pool.query<{ id: string }>(
    `INSERT INTO bookings (provider_id, service_id, customer_id, start_at, end_at, status)
     VALUES ($1, $2, $3, $4, $5, 'pending') RETURNING id`,
    [providerId, serviceId, customerId, startAt.toISOString(), endAt.toISOString()],
  );

  return bookingResult.rows[0].id;
}
