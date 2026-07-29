import { DateTime } from "luxon";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { closePool, getPool } from "../../src/db/pool.js";
import {
  createAvailabilityException,
  createAvailabilityRule,
  createBookingAt,
  resetAndSeed,
} from "../helpers/fixtures.js";

// Requires DATABASE_URL to point at a disposable Postgres DB with migrations
// 001-004 already applied.
const app = createApp();
const pool = getPool();

const TEST_DATE = "2026-08-17"; // arbitrary future date; weekday computed dynamically below
const weekday = DateTime.fromISO(TEST_DATE, { zone: "UTC" }).weekday;

let providerId: string;
let serviceId: string;

afterAll(async () => {
  await closePool();
});

describe("GET /availability", () => {
  beforeEach(async () => {
    ({ providerId, serviceId } = await resetAndSeed(pool, "UTC"));
  });

  it("returns slots only within the matching weekday's rule hours", async () => {
    await createAvailabilityRule(pool, providerId, weekday, "09:00:00", "12:00:00");

    const response = await request(app)
      .get("/availability")
      .query({ service_id: serviceId, date: TEST_DATE });

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    // 09:00-12:00 = 180 min window, 75-min slots (60 duration + 15 buffer_after),
    // 15-min granularity -> starts at 0,15,...,105 => 8 slots.
    expect(response.body).toHaveLength(8);
    expect(response.body[0]).toBe(`${TEST_DATE}T09:00:00.000Z`);
  });

  it("returns no slots for a weekday with no rule and no exception", async () => {
    const response = await request(app)
      .get("/availability")
      .query({ service_id: serviceId, date: TEST_DATE });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it("an 'open' exception adds availability outside normal hours", async () => {
    // No rule for this weekday at all -- only the exception should produce slots.
    await createAvailabilityException(pool, providerId, TEST_DATE, "open", "10:00:00", "12:00:00");

    const response = await request(app)
      .get("/availability")
      .query({ service_id: serviceId, date: TEST_DATE });

    expect(response.status).toBe(200);
    // 120 min window, 75-min slots, 15-min granularity -> starts 0,15,30,45 => 4 slots.
    expect(response.body).toHaveLength(4);
    expect(response.body[0]).toBe(`${TEST_DATE}T10:00:00.000Z`);
  });

  it("a 'blocked' exception removes availability even within normal rule hours", async () => {
    await createAvailabilityRule(pool, providerId, weekday, "09:00:00", "12:00:00");
    await createAvailabilityException(
      pool,
      providerId,
      TEST_DATE,
      "blocked",
      "10:00:00",
      "12:00:00",
    );

    const response = await request(app)
      .get("/availability")
      .query({ service_id: serviceId, date: TEST_DATE });

    expect(response.status).toBe(200);
    // Only 09:00-10:00 remains (60 min) -- too short for a 75-min slot.
    expect(response.body).toEqual([]);
  });

  it("an existing pending booking removes its time range from availability", async () => {
    await createAvailabilityRule(pool, providerId, weekday, "09:00:00", "12:00:00");
    await createBookingAt(
      pool,
      providerId,
      serviceId,
      `${TEST_DATE}T09:00:00.000Z`,
      `${TEST_DATE}T10:15:00.000Z`,
      "pending",
    );

    const response = await request(app)
      .get("/availability")
      .query({ service_id: serviceId, date: TEST_DATE });

    expect(response.status).toBe(200);
    expect(response.body).not.toContain(`${TEST_DATE}T09:00:00.000Z`);
    expect(response.body).toContain(`${TEST_DATE}T10:15:00.000Z`);
  });

  it("a cancelled booking does not reduce availability", async () => {
    await createAvailabilityRule(pool, providerId, weekday, "09:00:00", "12:00:00");
    await createBookingAt(
      pool,
      providerId,
      serviceId,
      `${TEST_DATE}T09:00:00.000Z`,
      `${TEST_DATE}T10:15:00.000Z`,
      "cancelled",
    );

    const response = await request(app)
      .get("/availability")
      .query({ service_id: serviceId, date: TEST_DATE });

    expect(response.status).toBe(200);
    expect(response.body).toContain(`${TEST_DATE}T09:00:00.000Z`);
    expect(response.body).toHaveLength(8);
  });

  it("returns 404 for an unknown service_id", async () => {
    const response = await request(app)
      .get("/availability")
      .query({ service_id: "00000000-0000-0000-0000-000000000000", date: TEST_DATE });

    expect(response.status).toBe(404);
  });

  it("returns 400 for a malformed date", async () => {
    const response = await request(app)
      .get("/availability")
      .query({ service_id: serviceId, date: "not-a-date" });

    expect(response.status).toBe(400);
  });

  it("returns 400 for a malformed service_id", async () => {
    const response = await request(app)
      .get("/availability")
      .query({ service_id: "not-a-uuid", date: TEST_DATE });

    expect(response.status).toBe(400);
  });
});

describe("GET /availability -- timezone/DST correctness", () => {
  const zone = "America/New_York";
  const winterDate = "2027-01-15"; // EST, UTC-5
  const summerDate = DateTime.fromISO(winterDate, { zone }).plus({ weeks: 26 }).toISODate()!; // same weekday, EDT, UTC-4

  beforeEach(async () => {
    ({ providerId, serviceId } = await resetAndSeed(pool, zone));
    const ruleWeekday = DateTime.fromISO(winterDate, { zone }).weekday;
    await createAvailabilityRule(pool, providerId, ruleWeekday, "09:00:00", "12:00:00");
  });

  it("converts the same local rule time to different UTC instants across a DST boundary", async () => {
    const winterResponse = await request(app)
      .get("/availability")
      .query({ service_id: serviceId, date: winterDate });
    const summerResponse = await request(app)
      .get("/availability")
      .query({ service_id: serviceId, date: summerDate });

    expect(winterResponse.status).toBe(200);
    expect(summerResponse.status).toBe(200);
    expect(winterResponse.body[0]).toBe(`${winterDate}T14:00:00.000Z`); // 09:00 EST = 14:00 UTC
    expect(summerResponse.body[0]).toBe(`${summerDate}T13:00:00.000Z`); // 09:00 EDT = 13:00 UTC
  });
});
