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

describe("POST /bookings/:id/reschedule", () => {
  it("cancels the old booking and creates a new pending booking at the requested time", async () => {
    const bookingId = await createPendingBooking(pool, providerId, serviceId);
    const token = await mintCustomerBookingToken(pool, bookingId);
    const newStartAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();

    const response = await request(app)
      .post(`/bookings/${bookingId}/reschedule`)
      .query({ token })
      .send({ newStartAt });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe("pending");
    expect(response.body.id).not.toBe(bookingId);
    expect(response.body.start_at).toBe(newStartAt);

    const oldRow = await pool.query<{ status: string; cancellation_reason: string }>(
      `SELECT status, cancellation_reason FROM bookings WHERE id = $1`,
      [bookingId],
    );
    expect(oldRow.rows[0].status).toBe("cancelled");
    expect(oldRow.rows[0].cancellation_reason).toBe("rescheduled by customer");
  });

  it("always creates the new booking as pending, never confirmed, even if the original was confirmed", async () => {
    const bookingId = await createPendingBooking(pool, providerId, serviceId);
    const token = await mintCustomerBookingToken(pool, bookingId);
    await pool.query(`UPDATE bookings SET status = 'confirmed' WHERE id = $1`, [bookingId]);

    const newStartAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
    const response = await request(app)
      .post(`/bookings/${bookingId}/reschedule`)
      .query({ token })
      .send({ newStartAt });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe("pending");
  });

  it("enqueues the masseur schedule-change notice with cancellation_reason = 'rescheduled by customer'", async () => {
    const bookingId = await createPendingBooking(pool, providerId, serviceId);
    const token = await mintCustomerBookingToken(pool, bookingId);
    const newStartAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();

    await request(app).post(`/bookings/${bookingId}/reschedule`).query({ token }).send({ newStartAt });

    const jobResult = await pool.query<{ payload: { cancellationReason: string } }>(
      `SELECT payload FROM email_jobs WHERE type = 'masseur_booking_change_notice' AND payload->>'bookingId' = $1`,
      [bookingId],
    );
    expect(jobResult.rows).toHaveLength(1);
    expect(jobResult.rows[0].payload.cancellationReason).toBe("rescheduled by customer");
  });

  it("the new booking gets its own token; the old token can still view but not act on the old booking", async () => {
    const bookingId = await createPendingBooking(pool, providerId, serviceId);
    const oldToken = await mintCustomerBookingToken(pool, bookingId);
    const newStartAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();

    const rescheduleResponse = await request(app)
      .post(`/bookings/${bookingId}/reschedule`)
      .query({ token: oldToken })
      .send({ newStartAt });
    const newBookingId = rescheduleResponse.body.id;

    // Old token still views the now-cancelled original booking.
    const viewOld = await request(app).get(`/bookings/${bookingId}`).query({ token: oldToken });
    expect(viewOld.status).toBe(200);
    expect(viewOld.body.status).toBe("cancelled");

    // But cannot cancel or reschedule it again.
    const cancelOld = await request(app)
      .post(`/bookings/${bookingId}/cancel`)
      .query({ token: oldToken });
    expect(cancelOld.status).toBe(409);

    // The old token has no access to the new booking.
    const viewNewWithOldToken = await request(app)
      .get(`/bookings/${newBookingId}`)
      .query({ token: oldToken });
    expect(viewNewWithOldToken.status).toBe(404);
  });

  it("returns 409 when rescheduling an already-cancelled booking", async () => {
    const bookingId = await createPendingBooking(pool, providerId, serviceId);
    const token = await mintCustomerBookingToken(pool, bookingId);
    await request(app).post(`/bookings/${bookingId}/cancel`).query({ token });

    const response = await request(app)
      .post(`/bookings/${bookingId}/reschedule`)
      .query({ token })
      .send({ newStartAt: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString() });

    expect(response.status).toBe(409);
  });

  it("returns a generic 404 for a wrong token", async () => {
    const bookingId = await createPendingBooking(pool, providerId, serviceId);

    const response = await request(app)
      .post(`/bookings/${bookingId}/reschedule`)
      .query({ token: "a".repeat(64) })
      .send({ newStartAt: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString() });

    expect(response.status).toBe(404);
  });

  it("rejects a reschedule body without newStartAt", async () => {
    const bookingId = await createPendingBooking(pool, providerId, serviceId);
    const token = await mintCustomerBookingToken(pool, bookingId);

    const response = await request(app)
      .post(`/bookings/${bookingId}/reschedule`)
      .query({ token })
      .send({});

    expect(response.status).toBe(400);
  });
});

describe("POST /bookings/:id/reschedule concurrency", () => {
  it("allows only one of two reschedule requests racing for the same new slot to succeed", async () => {
    const bookingA = await createBookingAt(
      pool,
      providerId,
      serviceId,
      new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      new Date(Date.now() + 49 * 60 * 60 * 1000).toISOString(),
    );
    const bookingB = await createBookingAt(
      pool,
      providerId,
      serviceId,
      new Date(Date.now() + 50 * 60 * 60 * 1000).toISOString(),
      new Date(Date.now() + 51 * 60 * 60 * 1000).toISOString(),
    );
    const tokenA = await mintCustomerBookingToken(pool, bookingA);
    const tokenB = await mintCustomerBookingToken(pool, bookingB);
    const contestedStartAt = new Date(Date.now() + 96 * 60 * 60 * 1000).toISOString();

    const [first, second] = await Promise.all([
      request(app)
        .post(`/bookings/${bookingA}/reschedule`)
        .query({ token: tokenA })
        .send({ newStartAt: contestedStartAt }),
      request(app)
        .post(`/bookings/${bookingB}/reschedule`)
        .query({ token: tokenB })
        .send({ newStartAt: contestedStartAt }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM bookings WHERE start_at = $1 AND status IN ('pending', 'confirmed')`,
      [contestedStartAt],
    );
    expect(Number(countResult.rows[0].count)).toBe(1);

    // The loser's original booking must be untouched -- reschedule is
    // all-or-nothing within its transaction.
    const loserBookingId = first.status === 409 ? bookingA : bookingB;
    const loserRow = await pool.query<{ status: string }>(
      `SELECT status FROM bookings WHERE id = $1`,
      [loserBookingId],
    );
    expect(loserRow.rows[0].status).toBe("pending");
  });

  it("allows only one of a reschedule and a fresh booking request racing for the same slot to succeed", async () => {
    const bookingId = await createPendingBooking(pool, providerId, serviceId);
    const token = await mintCustomerBookingToken(pool, bookingId);
    const contestedStartAt = new Date(Date.now() + 120 * 60 * 60 * 1000).toISOString();

    const [rescheduleResponse, createResponse] = await Promise.all([
      request(app)
        .post(`/bookings/${bookingId}/reschedule`)
        .query({ token })
        .send({ newStartAt: contestedStartAt }),
      request(app)
        .post("/bookings")
        .send({
          service_id: serviceId,
          start_at: contestedStartAt,
          customer: { name: "Racer", email: "racer@example.com", phone: "+1000000000" },
        }),
    ]);

    const statuses = [rescheduleResponse.status, createResponse.status].sort();
    expect(statuses).toEqual([201, 409]);
  });
});
