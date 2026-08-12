import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { closePool, getPool } from "../../src/db/pool.js";
import { createPendingBooking, mintAdminSession, resetAndSeed } from "../helpers/fixtures.js";

// Requires DATABASE_URL to point at a disposable Postgres DB with migrations
// 001-006 already applied. Kept in its own file (own `app` instance) rather
// than folded into bookings.confirmDecline.test.ts, so this block's own
// adminRateLimit budget doesn't stack on top of the confirm/decline tests'.
const app = createApp();
const pool = getPool();

let providerId: string;
let serviceId: string;
let authHeader: { Authorization: string };

beforeEach(async () => {
  ({ providerId, serviceId } = await resetAndSeed(pool));
  authHeader = { Authorization: `Bearer ${await mintAdminSession(pool)}` };
});

afterAll(async () => {
  await closePool();
});

async function createConfirmedBooking(): Promise<string> {
  const bookingId = await createPendingBooking(pool, providerId, serviceId);
  await request(app).post(`/bookings/${bookingId}/confirm`).set(authHeader).send();
  return bookingId;
}

describe("POST /admin/bookings/:id/cancel", () => {
  it("cancels a confirmed booking with a reason and returns the documented response shape", async () => {
    const bookingId = await createConfirmedBooking();

    const response = await request(app)
      .post(`/admin/bookings/${bookingId}/cancel`)
      .set(authHeader)
      .send({ reason: "something came up" });

    expect(response.status).toBe(200);
    expect(response.body.id).toBe(bookingId);
    expect(response.body.status).toBe("cancelled");
    expect(response.body.cancelled_at).not.toBeNull();
    expect(response.body.cancellation_reason).toBe("something came up");

    const jobResult = await pool.query(
      `SELECT type FROM email_jobs WHERE payload->>'bookingId' = $1`,
      [bookingId],
    );
    expect(jobResult.rows.map((r: { type: string }) => r.type)).toContain(
      "booking_cancelled_by_masseur",
    );
  });

  it("defaults the cancellation reason to 'cancelled by masseur' when none is supplied", async () => {
    const bookingId = await createConfirmedBooking();

    const response = await request(app)
      .post(`/admin/bookings/${bookingId}/cancel`)
      .set(authHeader)
      .send();

    expect(response.status).toBe(200);
    expect(response.body.cancellation_reason).toBe("cancelled by masseur");
  });

  it("returns 409 when cancelling a booking that is still pending", async () => {
    const bookingId = await createPendingBooking(pool, providerId, serviceId);

    const response = await request(app)
      .post(`/admin/bookings/${bookingId}/cancel`)
      .set(authHeader)
      .send();

    expect(response.status).toBe(409);
  });

  it("returns 409 when cancelling a booking that is already cancelled", async () => {
    const bookingId = await createConfirmedBooking();
    await request(app).post(`/admin/bookings/${bookingId}/cancel`).set(authHeader).send();

    const response = await request(app)
      .post(`/admin/bookings/${bookingId}/cancel`)
      .set(authHeader)
      .send();

    expect(response.status).toBe(409);
  });

  it("returns 404 for an unknown booking id", async () => {
    const response = await request(app)
      .post(`/admin/bookings/00000000-0000-0000-0000-000000000000/cancel`)
      .set(authHeader)
      .send();

    expect(response.status).toBe(404);
  });

  it("returns 401 without a valid bearer token", async () => {
    const bookingId = await createConfirmedBooking();

    const response = await request(app).post(`/admin/bookings/${bookingId}/cancel`).send();

    expect(response.status).toBe(401);
  });

  it("frees the slot immediately -- a new booking can be made for the same range after cancel", async () => {
    const bookingId = await createConfirmedBooking();
    const original = await pool.query<{ start_at: Date; end_at: Date }>(
      `SELECT start_at, end_at FROM bookings WHERE id = $1`,
      [bookingId],
    );

    await request(app).post(`/admin/bookings/${bookingId}/cancel`).set(authHeader).send();

    const response = await request(app)
      .post("/bookings")
      .send({
        service_id: serviceId,
        start_at: original.rows[0].start_at.toISOString(),
        customer: { name: "New Customer", email: "new@example.com", phone: "+1987654321" },
      });

    expect(response.status).toBe(201);
  });

  it("lives at a path distinct from the customer's token-based POST /bookings/:id/cancel -- the customer route still requires a token, not a session", async () => {
    const bookingId = await createConfirmedBooking();

    const noToken = await request(app).post(`/bookings/${bookingId}/cancel`).send();

    expect(noToken.status).toBe(400);
  });
});
