import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { closePool, getPool } from "../../src/db/pool.js";
import { resetAndSeed } from "../helpers/fixtures.js";

process.env.ADMIN_EMAIL = "admin@example.com";
process.env.APP_BASE_URL = "https://admin.example.com";

// Requires DATABASE_URL to point at a disposable Postgres DB with migrations
// 001 and 002 already applied. Fixture Provider/Service rows are inserted
// fresh in beforeEach below — there is no seed migration.
const app = createApp();
const pool = getPool();

let serviceId: string;

beforeEach(async () => {
  ({ serviceId } = await resetAndSeed(pool));
});

afterAll(async () => {
  await closePool();
});

function bookingPayload(startAt: string) {
  return {
    service_id: serviceId,
    start_at: startAt,
    customer: { name: "Jane Doe", email: "jane@example.com", phone: "+1234567890" },
  };
}

describe("POST /bookings concurrency", () => {
  it("allows only one of two concurrent overlapping requests to succeed", async () => {
    const startAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const [first, second] = await Promise.all([
      request(app).post("/bookings").send(bookingPayload(startAt)),
      request(app).post("/bookings").send(bookingPayload(startAt)),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);

    const conflict = first.status === 409 ? first : second;
    expect(conflict.body.error).toMatch(/slot no longer available/i);

    const countResult = await pool.query("SELECT COUNT(*) FROM bookings");
    expect(Number(countResult.rows[0].count)).toBe(1);
  });

  it("creates a pending booking with the documented 201 response shape", async () => {
    const startAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

    const response = await request(app).post("/bookings").send(bookingPayload(startAt));

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      status: "pending",
    });
    expect(typeof response.body.id).toBe("string");
    expect(response.body.start_at).toBe(startAt);
    expect(new Date(response.body.end_at).getTime()).toBeGreaterThan(
      new Date(response.body.start_at).getTime(),
    );
  });
});
