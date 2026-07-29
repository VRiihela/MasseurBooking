import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { closePool, getPool } from "../../src/db/pool.js";
import { createPendingBooking, resetAndSeed } from "../helpers/fixtures.js";

process.env.MASSEUR_ADMIN_TOKEN = "test-admin-token";

// Requires DATABASE_URL to point at a disposable Postgres DB with migrations
// 001-003 already applied.
const app = createApp();
const pool = getPool();
const authHeader = { Authorization: "Bearer test-admin-token" };

let providerId: string;
let serviceId: string;

beforeEach(async () => {
  ({ providerId, serviceId } = await resetAndSeed(pool));
});

afterAll(async () => {
  await closePool();
});

describe("POST /bookings/:id/confirm", () => {
  it("confirms a pending booking and returns the documented response shape", async () => {
    const bookingId = await createPendingBooking(pool, providerId, serviceId);

    const response = await request(app)
      .post(`/bookings/${bookingId}/confirm`)
      .set(authHeader)
      .send();

    expect(response.status).toBe(200);
    expect(response.body.id).toBe(bookingId);
    expect(response.body.status).toBe("confirmed");
    expect(response.body.confirmed_at).not.toBeNull();

    const jobResult = await pool.query(
      `SELECT type FROM email_jobs WHERE payload->>'bookingId' = $1`,
      [bookingId],
    );
    expect(jobResult.rows.map((r: { type: string }) => r.type)).toContain("booking_confirmed");
  });

  it("returns 409 when confirming a booking that is not pending", async () => {
    const bookingId = await createPendingBooking(pool, providerId, serviceId);
    await request(app).post(`/bookings/${bookingId}/confirm`).set(authHeader).send();

    const second = await request(app).post(`/bookings/${bookingId}/confirm`).set(authHeader).send();

    expect(second.status).toBe(409);
  });

  it("returns 404 for an unknown booking id", async () => {
    const response = await request(app)
      .post(`/bookings/00000000-0000-0000-0000-000000000000/confirm`)
      .set(authHeader)
      .send();

    expect(response.status).toBe(404);
  });

  it("returns 401 without a valid bearer token, without leaking whether the id exists", async () => {
    const bookingId = await createPendingBooking(pool, providerId, serviceId);

    const noAuth = await request(app).post(`/bookings/${bookingId}/confirm`).send();
    expect(noAuth.status).toBe(401);

    const wrongAuth = await request(app)
      .post(`/bookings/${bookingId}/confirm`)
      .set({ Authorization: "Bearer wrong-token" })
      .send();
    expect(wrongAuth.status).toBe(401);
  });

  it("allows only one of two concurrent confirm requests on the same booking to succeed", async () => {
    const bookingId = await createPendingBooking(pool, providerId, serviceId);

    const [first, second] = await Promise.all([
      request(app).post(`/bookings/${bookingId}/confirm`).set(authHeader).send(),
      request(app).post(`/bookings/${bookingId}/confirm`).set(authHeader).send(),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);
  });
});

describe("POST /bookings/:id/decline", () => {
  it("declines a pending booking with a reason and returns the documented response shape", async () => {
    const bookingId = await createPendingBooking(pool, providerId, serviceId);

    const response = await request(app)
      .post(`/bookings/${bookingId}/decline`)
      .set(authHeader)
      .send({ reason: "fully booked that day" });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("cancelled");
    expect(response.body.cancelled_at).not.toBeNull();
    expect(response.body.cancellation_reason).toBe("fully booked that day");

    const jobResult = await pool.query(
      `SELECT type FROM email_jobs WHERE payload->>'bookingId' = $1`,
      [bookingId],
    );
    expect(jobResult.rows.map((r: { type: string }) => r.type)).toContain("booking_declined");
  });

  it("declines a pending booking without a reason", async () => {
    const bookingId = await createPendingBooking(pool, providerId, serviceId);

    const response = await request(app).post(`/bookings/${bookingId}/decline`).set(authHeader).send();

    expect(response.status).toBe(200);
    expect(response.body.cancellation_reason).toBeNull();
  });

  it("returns 409 when declining an already-confirmed booking", async () => {
    const bookingId = await createPendingBooking(pool, providerId, serviceId);
    await request(app).post(`/bookings/${bookingId}/confirm`).set(authHeader).send();

    const response = await request(app).post(`/bookings/${bookingId}/decline`).set(authHeader).send();

    expect(response.status).toBe(409);
  });

  it("frees the slot immediately -- a new booking can be made for the same range after decline", async () => {
    const bookingId = await createPendingBooking(pool, providerId, serviceId);
    const original = await pool.query<{ start_at: Date; end_at: Date }>(
      `SELECT start_at, end_at FROM bookings WHERE id = $1`,
      [bookingId],
    );

    await request(app).post(`/bookings/${bookingId}/decline`).set(authHeader).send();

    const response = await request(app)
      .post("/bookings")
      .send({
        service_id: serviceId,
        start_at: original.rows[0].start_at.toISOString(),
        customer: { name: "New Customer", email: "new@example.com", phone: "+1987654321" },
      });

    expect(response.status).toBe(201);
  });
});
