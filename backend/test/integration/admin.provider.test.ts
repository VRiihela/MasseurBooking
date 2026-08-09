import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { closePool, getPool } from "../../src/db/pool.js";
import { mintAdminSession, resetAndSeed } from "../helpers/fixtures.js";

// Requires DATABASE_URL to point at a disposable Postgres DB with migrations
// 001-008 already applied.
const app = createApp();
const pool = getPool();

let providerId: string;
let authHeader: { Authorization: string };

beforeEach(async () => {
  ({ providerId } = await resetAndSeed(pool));
  authHeader = { Authorization: `Bearer ${await mintAdminSession(pool)}` };
});

afterAll(async () => {
  await closePool();
});

describe("GET /admin/provider", () => {
  it("returns the singleton provider's name and timezone", async () => {
    const response = await request(app).get("/admin/provider").set(authHeader);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      id: providerId,
      name: "Test Masseur",
      timezone: "UTC",
    });
  });

  it("rejects without a valid session", async () => {
    const response = await request(app).get("/admin/provider");
    expect(response.status).toBe(401);
  });
});

describe("PATCH /admin/provider", () => {
  it("updates the provider's timezone", async () => {
    const response = await request(app)
      .patch("/admin/provider")
      .set(authHeader)
      .send({ timezone: "America/New_York" });

    expect(response.status).toBe(200);
    expect(response.body.timezone).toBe("America/New_York");
    expect(response.body.name).toBe("Test Masseur"); // unchanged
  });

  it("updates the provider's name", async () => {
    const response = await request(app)
      .patch("/admin/provider")
      .set(authHeader)
      .send({ name: "Jane's Massage Studio" });

    expect(response.status).toBe(200);
    expect(response.body.name).toBe("Jane's Massage Studio");
  });

  it("rejects an invalid IANA timezone with 400", async () => {
    const response = await request(app)
      .patch("/admin/provider")
      .set(authHeader)
      .send({ timezone: "Not/A_Zone" });
    expect(response.status).toBe(400);
  });

  it("rejects an empty patch body with 400", async () => {
    const response = await request(app).patch("/admin/provider").set(authHeader).send({});
    expect(response.status).toBe(400);
  });

  it("rejects without a valid session", async () => {
    const response = await request(app).patch("/admin/provider").send({ name: "New Name" });
    expect(response.status).toBe(401);
  });

  it("has no POST endpoint -- provider bootstrapping stays out of this API", async () => {
    const response = await request(app)
      .post("/admin/provider")
      .set(authHeader)
      .send({ name: "New Provider", timezone: "UTC" });
    expect(response.status).toBe(404);
  });
});
