import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { closePool, getPool } from "../../src/db/pool.js";
import { createBookingAt, mintAdminSession, resetAndSeed } from "../helpers/fixtures.js";

// Requires DATABASE_URL to point at a disposable Postgres DB with migrations
// 001-008 already applied.
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

function servicePayload(overrides: Record<string, unknown> = {}) {
  return {
    name: "Swedish Massage",
    price: 75,
    duration_minutes: 45,
    buffer_before_minutes: 5,
    buffer_after_minutes: 10,
    ...overrides,
  };
}

describe("GET /admin/services", () => {
  it("lists every service for the provider, including inactive ones", async () => {
    const inactiveResult = await pool.query<{ id: string }>(
      `INSERT INTO services (provider_id, name, price, duration_minutes, buffer_before_minutes, buffer_after_minutes, active)
       VALUES ($1, 'Old Service', 40.00, 30, 0, 0, false) RETURNING id`,
      [providerId],
    );

    const response = await request(app).get("/admin/services").set(authHeader);

    expect(response.status).toBe(200);
    const ids = response.body.map((s: { id: string }) => s.id);
    expect(ids).toContain(serviceId);
    expect(ids).toContain(inactiveResult.rows[0].id);
  });

  it("rejects without a valid session", async () => {
    const response = await request(app).get("/admin/services");
    expect(response.status).toBe(401);
  });
});

describe("POST /admin/services", () => {
  it("creates a service and returns the documented response shape", async () => {
    const response = await request(app)
      .post("/admin/services")
      .set(authHeader)
      .send(servicePayload());

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      name: "Swedish Massage",
      price: 75,
      duration_minutes: 45,
      buffer_before_minutes: 5,
      buffer_after_minutes: 10,
      active: true,
    });
    expect(typeof response.body.id).toBe("string");
  });

  it("rejects a missing name with 400", async () => {
    const response = await request(app)
      .post("/admin/services")
      .set(authHeader)
      .send(servicePayload({ name: undefined }));
    expect(response.status).toBe(400);
  });

  it("rejects a missing price with 400", async () => {
    const response = await request(app)
      .post("/admin/services")
      .set(authHeader)
      .send(servicePayload({ price: undefined }));
    expect(response.status).toBe(400);
  });

  it("rejects a non-positive duration_minutes with 400", async () => {
    const response = await request(app)
      .post("/admin/services")
      .set(authHeader)
      .send(servicePayload({ duration_minutes: 0 }));
    expect(response.status).toBe(400);
  });

  it("rejects without a valid session", async () => {
    const response = await request(app).post("/admin/services").send(servicePayload());
    expect(response.status).toBe(401);
  });
});

describe("PATCH /admin/services/:id", () => {
  it("updates only the provided fields", async () => {
    const response = await request(app)
      .patch(`/admin/services/${serviceId}`)
      .set(authHeader)
      .send({ price: 90 });

    expect(response.status).toBe(200);
    expect(response.body.price).toBe(90);
    expect(response.body.duration_minutes).toBe(60); // unchanged from the fixture
  });

  it("deactivates a service via active = false rather than deleting it", async () => {
    const response = await request(app)
      .patch(`/admin/services/${serviceId}`)
      .set(authHeader)
      .send({ active: false });

    expect(response.status).toBe(200);
    expect(response.body.active).toBe(false);

    const stillExists = await pool.query(`SELECT 1 FROM services WHERE id = $1`, [serviceId]);
    expect(stillExists.rowCount).toBe(1);
  });

  it("returns 404 for an unknown service id", async () => {
    const response = await request(app)
      .patch(`/admin/services/00000000-0000-0000-0000-000000000000`)
      .set(authHeader)
      .send({ price: 90 });
    expect(response.status).toBe(404);
  });

  it("rejects an empty patch body with 400", async () => {
    const response = await request(app)
      .patch(`/admin/services/${serviceId}`)
      .set(authHeader)
      .send({});
    expect(response.status).toBe(400);
  });

  it("rejects without a valid session", async () => {
    const response = await request(app)
      .patch(`/admin/services/${serviceId}`)
      .send({ price: 90 });
    expect(response.status).toBe(401);
  });

  it("regression: editing duration_minutes/buffers after a booking exists does not change that booking's stored start_at/end_at", async () => {
    const startAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const endAt = new Date(Date.now() + 24 * 60 * 60 * 1000 + 75 * 60_000).toISOString();
    const bookingId = await createBookingAt(pool, providerId, serviceId, startAt, endAt);

    await request(app)
      .patch(`/admin/services/${serviceId}`)
      .set(authHeader)
      .send({ duration_minutes: 120, buffer_before_minutes: 30, buffer_after_minutes: 30 });

    const bookingRow = await pool.query<{ start_at: Date; end_at: Date }>(
      `SELECT start_at, end_at FROM bookings WHERE id = $1`,
      [bookingId],
    );
    expect(bookingRow.rows[0].start_at.toISOString()).toBe(startAt);
    expect(bookingRow.rows[0].end_at.toISOString()).toBe(endAt);
  });
});
