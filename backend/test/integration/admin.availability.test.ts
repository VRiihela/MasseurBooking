import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { closePool, getPool } from "../../src/db/pool.js";
import {
  createAvailabilityException,
  createAvailabilityRule,
  createBookingAt,
  mintAdminSession,
  resetAndSeed,
} from "../helpers/fixtures.js";

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

describe("availability rules", () => {
  it("creates, lists, updates, and deletes a rule", async () => {
    const createResponse = await request(app)
      .post("/admin/availability-rules")
      .set(authHeader)
      .send({ weekday: 2, start_time: "09:00:00", end_time: "17:00:00" });
    expect(createResponse.status).toBe(201);
    const ruleId = createResponse.body.id;

    const listResponse = await request(app).get("/admin/availability-rules").set(authHeader);
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.map((r: { id: string }) => r.id)).toContain(ruleId);

    const patchResponse = await request(app)
      .patch(`/admin/availability-rules/${ruleId}`)
      .set(authHeader)
      .send({ start_time: "10:00:00" });
    expect(patchResponse.status).toBe(200);
    expect(patchResponse.body.start_time).toBe("10:00:00");
    expect(patchResponse.body.end_time).toBe("17:00:00"); // unchanged, merged from existing row

    const deleteResponse = await request(app)
      .delete(`/admin/availability-rules/${ruleId}`)
      .set(authHeader);
    expect(deleteResponse.status).toBe(200);

    const afterDelete = await pool.query(`SELECT 1 FROM availability_rules WHERE id = $1`, [ruleId]);
    expect(afterDelete.rowCount).toBe(0);
  });

  it("rejects weekday outside 1-7 with 400", async () => {
    const response = await request(app)
      .post("/admin/availability-rules")
      .set(authHeader)
      .send({ weekday: 8, start_time: "09:00:00", end_time: "17:00:00" });
    expect(response.status).toBe(400);
  });

  it("rejects end_time before start_time on create with 400", async () => {
    const response = await request(app)
      .post("/admin/availability-rules")
      .set(authHeader)
      .send({ weekday: 2, start_time: "17:00:00", end_time: "09:00:00" });
    expect(response.status).toBe(400);
  });

  it("rejects a PATCH that would leave end_time before start_time (merged against the current row) with 400", async () => {
    const ruleId = await createAvailabilityRule(pool, providerId, 3, "09:00:00", "17:00:00");

    const response = await request(app)
      .patch(`/admin/availability-rules/${ruleId}`)
      .set(authHeader)
      .send({ start_time: "18:00:00" }); // now after the existing end_time
    expect(response.status).toBe(400);
  });

  it("returns 404 for PATCH/DELETE on an unknown rule id", async () => {
    const unknownId = "00000000-0000-0000-0000-000000000000";
    const patchResponse = await request(app)
      .patch(`/admin/availability-rules/${unknownId}`)
      .set(authHeader)
      .send({ start_time: "09:00:00" });
    expect(patchResponse.status).toBe(404);

    const deleteResponse = await request(app)
      .delete(`/admin/availability-rules/${unknownId}`)
      .set(authHeader);
    expect(deleteResponse.status).toBe(404);
  });

  it("rejects every route without a valid session", async () => {
    const list = await request(app).get("/admin/availability-rules");
    const create = await request(app)
      .post("/admin/availability-rules")
      .send({ weekday: 2, start_time: "09:00:00", end_time: "17:00:00" });
    expect(list.status).toBe(401);
    expect(create.status).toBe(401);
  });

  it("regression: deleting a rule an existing booking currently falls within does not touch that booking", async () => {
    const ruleId = await createAvailabilityRule(pool, providerId, 2, "09:00:00", "17:00:00");
    const startAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const endAt = new Date(Date.now() + 24 * 60 * 60 * 1000 + 75 * 60_000).toISOString();
    const bookingId = await createBookingAt(pool, providerId, serviceId, startAt, endAt);

    const deleteResponse = await request(app)
      .delete(`/admin/availability-rules/${ruleId}`)
      .set(authHeader);
    expect(deleteResponse.status).toBe(200);

    const bookingRow = await pool.query<{ status: string; start_at: Date; end_at: Date }>(
      `SELECT status, start_at, end_at FROM bookings WHERE id = $1`,
      [bookingId],
    );
    expect(bookingRow.rows[0].status).toBe("pending");
    expect(bookingRow.rows[0].start_at.toISOString()).toBe(startAt);
    expect(bookingRow.rows[0].end_at.toISOString()).toBe(endAt);
  });
});

describe("availability_rules CHECK constraint (direct SQL, bypassing the application layer)", () => {
  it("still rejects end_time <= start_time at the DB level as SQLSTATE 23514, backstopping the app-level check", async () => {
    await expect(
      pool.query(
        `INSERT INTO availability_rules (provider_id, weekday, start_time, end_time) VALUES ($1, 2, '17:00:00', '09:00:00')`,
        [providerId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
});

describe("availability exceptions", () => {
  it("creates, lists, and deletes an exception", async () => {
    const createResponse = await request(app)
      .post("/admin/availability-exceptions")
      .set(authHeader)
      .send({ date: "2026-12-25", type: "blocked", start_time: "00:00:00", end_time: "23:59:59" });
    expect(createResponse.status).toBe(201);
    expect(createResponse.body.date).toBe("2026-12-25");
    const exceptionId = createResponse.body.id;

    const listResponse = await request(app).get("/admin/availability-exceptions").set(authHeader);
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.map((e: { id: string }) => e.id)).toContain(exceptionId);

    const deleteResponse = await request(app)
      .delete(`/admin/availability-exceptions/${exceptionId}`)
      .set(authHeader);
    expect(deleteResponse.status).toBe(200);

    const afterDelete = await pool.query(`SELECT 1 FROM availability_exceptions WHERE id = $1`, [
      exceptionId,
    ]);
    expect(afterDelete.rowCount).toBe(0);
  });

  it("rejects an invalid type with 400", async () => {
    const response = await request(app)
      .post("/admin/availability-exceptions")
      .set(authHeader)
      .send({ date: "2026-12-25", type: "vacation", start_time: "09:00:00", end_time: "17:00:00" });
    expect(response.status).toBe(400);
  });

  it("rejects an invalid calendar date with 400", async () => {
    const response = await request(app)
      .post("/admin/availability-exceptions")
      .set(authHeader)
      .send({ date: "2026-02-30", type: "blocked", start_time: "09:00:00", end_time: "17:00:00" });
    expect(response.status).toBe(400);
  });

  it("rejects end_time before start_time with 400", async () => {
    const response = await request(app)
      .post("/admin/availability-exceptions")
      .set(authHeader)
      .send({ date: "2026-12-25", type: "blocked", start_time: "17:00:00", end_time: "09:00:00" });
    expect(response.status).toBe(400);
  });

  it("returns 404 for DELETE on an unknown exception id", async () => {
    const response = await request(app)
      .delete(`/admin/availability-exceptions/00000000-0000-0000-0000-000000000000`)
      .set(authHeader);
    expect(response.status).toBe(404);
  });

  it("rejects every route without a valid session", async () => {
    const list = await request(app).get("/admin/availability-exceptions");
    expect(list.status).toBe(401);
  });

  it("regression: deleting an exception an existing booking currently falls within does not touch that booking", async () => {
    const bookingDate = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const exceptionId = await createAvailabilityException(
      pool,
      providerId,
      bookingDate,
      "open",
      "00:00:00",
      "23:59:59",
    );
    const startAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const endAt = new Date(Date.now() + 48 * 60 * 60 * 1000 + 75 * 60_000).toISOString();
    const bookingId = await createBookingAt(pool, providerId, serviceId, startAt, endAt);

    const deleteResponse = await request(app)
      .delete(`/admin/availability-exceptions/${exceptionId}`)
      .set(authHeader);
    expect(deleteResponse.status).toBe(200);

    const bookingRow = await pool.query<{ status: string; start_at: Date; end_at: Date }>(
      `SELECT status, start_at, end_at FROM bookings WHERE id = $1`,
      [bookingId],
    );
    expect(bookingRow.rows[0].status).toBe("pending");
    expect(bookingRow.rows[0].start_at.toISOString()).toBe(startAt);
    expect(bookingRow.rows[0].end_at.toISOString()).toBe(endAt);
  });
});
