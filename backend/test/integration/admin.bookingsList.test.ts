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

describe("GET /admin/bookings", () => {
  it("rejects without a valid session", async () => {
    const response = await request(app).get("/admin/bookings");
    expect(response.status).toBe(401);
  });

  it("with no query params returns every booking for the provider, ordered by start_at, with customer contact info", async () => {
    const later = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const earlier = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const laterId = await createBookingAt(
      pool,
      providerId,
      serviceId,
      later.toISOString(),
      new Date(later.getTime() + 60 * 60_000).toISOString(),
      "confirmed",
    );
    const earlierId = await createBookingAt(
      pool,
      providerId,
      serviceId,
      earlier.toISOString(),
      new Date(earlier.getTime() + 60 * 60_000).toISOString(),
      "pending",
    );

    const response = await request(app).get("/admin/bookings").set(authHeader);

    expect(response.status).toBe(200);
    expect(response.body.map((b: { id: string }) => b.id)).toEqual([earlierId, laterId]);
    expect(response.body[0]).toMatchObject({
      id: earlierId,
      status: "pending",
      service_name: "Deep Tissue Massage",
      customer_name: "Jane Doe",
      customer_email: "jane@example.com",
      customer_phone: "+1234567890",
    });
    expect(typeof response.body[0].start_at_local).toBe("string");
    expect(typeof response.body[0].end_at_local).toBe("string");
    expect(typeof response.body[0].created_at).toBe("string");
    expect(response.body[0].start_at).toBe(earlier.toISOString());
    expect(response.body[0].end_at).toBe(new Date(earlier.getTime() + 60 * 60_000).toISOString());
  });

  it("?status=pending returns only pending bookings", async () => {
    const startAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const endAt = new Date(startAt.getTime() + 60 * 60_000);
    const pendingId = await createBookingAt(
      pool,
      providerId,
      serviceId,
      startAt.toISOString(),
      endAt.toISOString(),
      "pending",
    );
    await createBookingAt(
      pool,
      providerId,
      serviceId,
      new Date(startAt.getTime() + 3 * 60 * 60_000).toISOString(),
      new Date(endAt.getTime() + 3 * 60 * 60_000).toISOString(),
      "confirmed",
    );

    const response = await request(app)
      .get("/admin/bookings")
      .query({ status: "pending" })
      .set(authHeader);

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0].id).toBe(pendingId);
  });

  it("rejects an unrecognized status value with 400, not a silently-empty or unfiltered result", async () => {
    const response = await request(app)
      .get("/admin/bookings")
      .query({ status: "bogus" })
      .set(authHeader);
    expect(response.status).toBe(400);
  });

  it("rejects status=completed with 400 -- 'completed' is not a real booking status", async () => {
    const response = await request(app)
      .get("/admin/bookings")
      .query({ status: "completed" })
      .set(authHeader);
    expect(response.status).toBe(400);
  });

  it("shows start/end times in the provider's local timezone, not UTC", async () => {
    const { providerId: nyProviderId, serviceId: nyServiceId } = await resetAndSeed(
      pool,
      "America/New_York",
    );
    // 14:00 UTC in January is 09:00 America/New_York (UTC-5, standard time).
    const startAt = "2027-01-15T14:00:00.000Z";
    const endAt = "2027-01-15T15:00:00.000Z";
    await createBookingAt(pool, nyProviderId, nyServiceId, startAt, endAt, "pending");
    const nyAuthHeader = { Authorization: `Bearer ${await mintAdminSession(pool)}` };

    const response = await request(app).get("/admin/bookings").set(nyAuthHeader);

    expect(response.status).toBe(200);
    expect(response.body[0].start_at_local).toContain("klo 9.00");
    expect(response.body[0].start_at_local).not.toContain("klo 14.00");
    // The raw fields are always UTC, regardless of provider timezone -- unlike
    // start_at_local/end_at_local, they must never shift with provider.timezone.
    expect(response.body[0].start_at).toBe(startAt);
    expect(response.body[0].end_at).toBe(endAt);
  });

  it("applies a rate limit", async () => {
    const responses = await Promise.all(
      Array.from({ length: 25 }, () => request(app).get("/admin/bookings").set(authHeader)),
    );
    expect(responses.some((r) => r.status === 429)).toBe(true);
  });
});
