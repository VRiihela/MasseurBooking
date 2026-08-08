import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { closePool, getPool } from "../../src/db/pool.js";
import { createInactiveService, resetAndSeed } from "../helpers/fixtures.js";

// Requires DATABASE_URL to point at a disposable Postgres DB with migrations
// 001-008 already applied.
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

describe("GET /services", () => {
  it("requires no authentication", async () => {
    const response = await request(app).get("/services");
    expect(response.status).toBe(200);
  });

  it("returns only active services, in the documented field shape", async () => {
    await createInactiveService(pool, providerId);

    const response = await request(app).get("/services");

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    const service = response.body[0];
    expect(service.id).toBe(serviceId);
    expect(service).toEqual({
      id: serviceId,
      name: "Deep Tissue Massage",
      price: 60,
      duration_minutes: 60,
    });
  });

  it("never leaks buffer minutes, provider_id, or active", async () => {
    const response = await request(app).get("/services");

    const service = response.body[0];
    expect(service).not.toHaveProperty("buffer_before_minutes");
    expect(service).not.toHaveProperty("buffer_after_minutes");
    expect(service).not.toHaveProperty("provider_id");
    expect(service).not.toHaveProperty("active");
  });

  it("returns an empty array when no services are active", async () => {
    await pool.query(`UPDATE services SET active = false WHERE id = $1`, [serviceId]);

    const response = await request(app).get("/services");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it("applies a rate limit", async () => {
    const responses = await Promise.all(
      Array.from({ length: 35 }, () => request(app).get("/services")),
    );
    expect(responses.some((r) => r.status === 429)).toBe(true);
  });
});
