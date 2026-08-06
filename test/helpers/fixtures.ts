import { createHash, randomBytes } from "node:crypto";
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
  await pool.query("DELETE FROM admin_login_tokens");
  await pool.query("DELETE FROM admin_sessions");
  await pool.query("DELETE FROM email_jobs");
  await pool.query("DELETE FROM customer_booking_tokens");
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
    `INSERT INTO services (provider_id, name, price, duration_minutes, buffer_before_minutes, buffer_after_minutes, active)
     VALUES ($1, 'Deep Tissue Massage', 60.00, 60, 0, 15, true) RETURNING id`,
    [providerId],
  );
  const serviceId = serviceResult.rows[0].id;

  return { providerId, serviceId };
}

export async function createInactiveService(pool: Pool, providerId: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO services (provider_id, name, price, duration_minutes, buffer_before_minutes, buffer_after_minutes, active)
     VALUES ($1, 'Inactive Service', 60.00, 60, 0, 15, false) RETURNING id`,
    [providerId],
  );
  return result.rows[0].id;
}

export async function createAvailabilityRule(
  pool: Pool,
  providerId: string,
  weekday: number,
  startTime: string,
  endTime: string,
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO availability_rules (provider_id, weekday, start_time, end_time) VALUES ($1, $2, $3, $4) RETURNING id`,
    [providerId, weekday, startTime, endTime],
  );
  return result.rows[0].id;
}

export async function createAvailabilityException(
  pool: Pool,
  providerId: string,
  date: string,
  type: "blocked" | "open",
  startTime: string,
  endTime: string,
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO availability_exceptions (provider_id, date, type, start_time, end_time) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [providerId, date, type, startTime, endTime],
  );
  return result.rows[0].id;
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

/**
 * Mints a valid admin_sessions row directly, bypassing the full
 * login-request/login round trip, for tests that just need an authenticated
 * caller rather than to exercise the login flow itself (that's what
 * test/integration/auth.test.ts is for).
 */
export async function mintAdminSession(
  pool: Pool,
  options: { expired?: boolean; revoked?: boolean } = {},
): Promise<string> {
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = options.expired ? "now() - interval '1 minute'" : "now() + interval '7 days'";
  const revokedAt = options.revoked ? "now()" : "NULL";

  await pool.query(
    `INSERT INTO admin_sessions (token_hash, expires_at, revoked_at)
     VALUES ($1, ${expiresAt}, ${revokedAt})`,
    [tokenHash],
  );

  return rawToken;
}

/**
 * Inserts an already-expired admin_login_tokens row directly, for testing
 * the "expired" branch of GET /auth/login distinctly from the "unknown
 * token" branch -- both collapse to the same 401, but they're two different
 * conditions in the same WHERE clause (expires_at > now() vs. used_at IS
 * NULL), worth exercising separately.
 */
export async function mintExpiredLoginToken(pool: Pool): Promise<string> {
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");

  await pool.query(
    `INSERT INTO admin_login_tokens (token_hash, expires_at) VALUES ($1, now() - interval '1 minute')`,
    [tokenHash],
  );

  return rawToken;
}

/**
 * Mints a customer_booking_tokens row directly, bypassing the email flow,
 * for tests that just need a valid token for an existing booking rather than
 * to exercise token issuance itself.
 */
export async function mintCustomerBookingToken(pool: Pool, bookingId: string): Promise<string> {
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");

  await pool.query(
    `INSERT INTO customer_booking_tokens (booking_id, token_hash) VALUES ($1, $2)`,
    [bookingId, tokenHash],
  );

  return rawToken;
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
