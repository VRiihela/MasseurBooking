import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { closePool, getPool } from "../../src/db/pool.js";
import { formatLocalTime } from "../../src/services/timeFormat.js";
import {
  createBookingAt,
  createPendingBooking,
  mintCustomerBookingToken,
  resetAndSeed,
} from "../helpers/fixtures.js";

process.env.ADMIN_EMAIL = "admin@example.com";
process.env.APP_BASE_URL = "https://admin.example.com";

// Requires DATABASE_URL to point at a disposable Postgres DB with migrations
// 001-007 already applied.
const app = createApp();
const pool = getPool();

let providerId: string;
let serviceId: string;

beforeEach(async () => {
  ({ providerId, serviceId } = await resetAndSeed(pool));
});

afterAll(async () => {
  await closePool();
});

describe("GET /bookings/:id", () => {
  it("returns status, service name, and local start/end time when the token matches", async () => {
    const bookingId = await createPendingBooking(pool, providerId, serviceId);
    const token = await mintCustomerBookingToken(pool, bookingId);
    const stored = await pool.query<{ start_at: Date }>(`SELECT start_at FROM bookings WHERE id = $1`, [
      bookingId,
    ]);

    const response = await request(app).get(`/bookings/${bookingId}`).query({ token });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: bookingId,
      status: "pending",
      service_id: serviceId,
      service_name: expect.any(String),
    });
    // The seeded service has buffer_before_minutes = 0, so the displayed
    // start must equal the raw stored start_at unchanged -- no regression
    // for the common zero-buffer-before case.
    expect(response.body.start_at_local).toBe(formatLocalTime(stored.rows[0].start_at, "UTC"));
  });

  it("excludes buffer time from the displayed window for a service with buffer_before and buffer_after", async () => {
    const bufferedService = await pool.query<{ id: string }>(
      `INSERT INTO services (provider_id, name, price, duration_minutes, buffer_before_minutes, buffer_after_minutes, active)
       VALUES ($1, 'Hot Stone Massage', 80.00, 50, 10, 30, true) RETURNING id`,
      [providerId],
    );
    const bufferedServiceId = bufferedService.rows[0].id;

    // start_at/end_at as createBookingCore actually stores them: the full
    // reserved block (buffer_before + duration + buffer_after).
    const rawStart = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const rawEnd = new Date(rawStart.getTime() + (10 + 50 + 30) * 60_000);
    const bookingId = await createBookingAt(
      pool,
      providerId,
      bufferedServiceId,
      rawStart.toISOString(),
      rawEnd.toISOString(),
    );
    const token = await mintCustomerBookingToken(pool, bookingId);

    const response = await request(app).get(`/bookings/${bookingId}`).query({ token });

    expect(response.status).toBe(200);

    const expectedMassageStart = new Date(rawStart.getTime() + 10 * 60_000);
    const expectedMassageEnd = new Date(expectedMassageStart.getTime() + 50 * 60_000);
    expect(response.body.start_at_local).toBe(formatLocalTime(expectedMassageStart, "UTC"));
    expect(response.body.end_at_local).toBe(formatLocalTime(expectedMassageEnd, "UTC"));
    expect(response.body.start_at_local).not.toBe(formatLocalTime(rawStart, "UTC"));
    expect(response.body.end_at_local).not.toBe(formatLocalTime(rawEnd, "UTC"));
  });

  it("returns a generic 404 for a wrong token on a real booking id", async () => {
    const bookingId = await createPendingBooking(pool, providerId, serviceId);
    await mintCustomerBookingToken(pool, bookingId);

    const response = await request(app)
      .get(`/bookings/${bookingId}`)
      .query({ token: "a".repeat(64) });

    expect(response.status).toBe(404);
  });

  it("returns a byte-identical generic 404 for a valid token paired with the wrong booking id", async () => {
    const bookingId = await createPendingBooking(pool, providerId, serviceId);
    const token = await mintCustomerBookingToken(pool, bookingId);
    const otherBookingId = await createBookingAt(
      pool,
      providerId,
      serviceId,
      new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      new Date(Date.now() + 49 * 60 * 60 * 1000).toISOString(),
    );

    const wrongToken = await request(app)
      .get(`/bookings/${otherBookingId}`)
      .query({ token: "a".repeat(64) });
    const wrongId = await request(app)
      .get(`/bookings/00000000-0000-0000-0000-000000000000`)
      .query({ token });

    expect(wrongToken.status).toBe(404);
    expect(wrongId.status).toBe(404);
    expect(wrongToken.body).toEqual(wrongId.body);
  });

  it("returns 400 for a malformed token", async () => {
    const bookingId = await createPendingBooking(pool, providerId, serviceId);

    const response = await request(app)
      .get(`/bookings/${bookingId}`)
      .query({ token: "not-hex" });

    expect(response.status).toBe(400);
  });
});

describe("POST /bookings/:id/cancel", () => {
  it("cancels a pending booking and enqueues both a customer and a masseur email", async () => {
    const bookingId = await createPendingBooking(pool, providerId, serviceId);
    const token = await mintCustomerBookingToken(pool, bookingId);

    const response = await request(app).post(`/bookings/${bookingId}/cancel`).query({ token });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("cancelled");
    expect(response.body.cancelled_at).not.toBeNull();

    const jobResult = await pool.query<{ type: string }>(
      `SELECT type FROM email_jobs WHERE payload->>'bookingId' = $1`,
      [bookingId],
    );
    const types = jobResult.rows.map((r) => r.type);
    expect(types).toContain("booking_cancelled_by_customer");
    expect(types).toContain("masseur_booking_change_notice");
  });

  it("cancels a confirmed booking too", async () => {
    const bookingId = await createBookingAt(
      pool,
      providerId,
      serviceId,
      new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString(),
      "confirmed",
    );
    const token = await mintCustomerBookingToken(pool, bookingId);

    const response = await request(app).post(`/bookings/${bookingId}/cancel`).query({ token });

    expect(response.status).toBe(200);
  });

  it("returns 409, not a silent success, when cancelling an already-cancelled booking", async () => {
    const bookingId = await createPendingBooking(pool, providerId, serviceId);
    const token = await mintCustomerBookingToken(pool, bookingId);

    await request(app).post(`/bookings/${bookingId}/cancel`).query({ token });
    const second = await request(app).post(`/bookings/${bookingId}/cancel`).query({ token });

    expect(second.status).toBe(409);
  });

  it("returns a generic 404 for a wrong token", async () => {
    const bookingId = await createPendingBooking(pool, providerId, serviceId);

    const response = await request(app)
      .post(`/bookings/${bookingId}/cancel`)
      .query({ token: "a".repeat(64) });

    expect(response.status).toBe(404);
  });

  it("frees the slot immediately -- reflected by GET /availability", async () => {
    const bookingId = await createPendingBooking(pool, providerId, serviceId);
    const token = await mintCustomerBookingToken(pool, bookingId);
    const original = await pool.query<{ start_at: Date }>(
      `SELECT start_at FROM bookings WHERE id = $1`,
      [bookingId],
    );

    await request(app).post(`/bookings/${bookingId}/cancel`).query({ token });

    const response = await request(app).post("/bookings").send({
      service_id: serviceId,
      start_at: original.rows[0].start_at.toISOString(),
      customer: { name: "New Customer", email: "new@example.com", phone: "+1987654321" },
    });

    expect(response.status).toBe(201);
  });
});

describe("customer booking endpoints -- rate limiting", () => {
  it("applies a rate limit to GET /bookings/:id", async () => {
    const bookingId = await createPendingBooking(pool, providerId, serviceId);
    const token = await mintCustomerBookingToken(pool, bookingId);

    const responses = await Promise.all(
      Array.from({ length: 25 }, () => request(app).get(`/bookings/${bookingId}`).query({ token })),
    );

    expect(responses.some((r) => r.status === 429)).toBe(true);
  });

  it("applies a rate limit to POST /bookings/:id/cancel", async () => {
    const bookingId = await createPendingBooking(pool, providerId, serviceId);
    const token = await mintCustomerBookingToken(pool, bookingId);

    // Large enough to guarantee tripping the limit regardless of how much
    // quota earlier tests in this file already consumed against the same
    // shared cancel/reschedule limiter.
    const responses = await Promise.all(
      Array.from({ length: 30 }, () =>
        request(app).post(`/bookings/${bookingId}/cancel`).query({ token }),
      ),
    );

    expect(responses.some((r) => r.status === 429)).toBe(true);
  });
});
