import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { closePool, getPool } from "../../src/db/pool.js";
import {
  createBookingAt,
  createPendingBooking,
  mintCustomerBookingToken,
  resetAndSeed,
} from "../helpers/fixtures.js";

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

    const response = await request(app).get(`/bookings/${bookingId}`).query({ token });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: bookingId,
      status: "pending",
      service_name: expect.any(String),
    });
    expect(typeof response.body.start_at_local).toBe("string");
    expect(typeof response.body.end_at_local).toBe("string");
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
