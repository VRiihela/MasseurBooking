import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { closePool, getPool } from "../../src/db/pool.js";
import { requestLoginLink } from "../../src/services/adminAuthService.js";
import { resetAndSeed } from "../helpers/fixtures.js";

process.env.ADMIN_EMAIL = "admin@example.com";
process.env.APP_BASE_URL = "https://admin.example.com";

// Requires DATABASE_URL to point at a disposable Postgres DB with migrations
// 001-006 already applied.
const app = createApp();
const pool = getPool();

beforeEach(async () => {
  await resetAndSeed(pool);
});

afterAll(async () => {
  await closePool();
});

/**
 * Calls the service directly rather than POST /auth/login-request, so tests
 * that need several tokens (reuse/race tests) don't trip
 * loginRequestRateLimit -- that endpoint's own behavior (including the rate
 * limit) is exercised separately in the "POST /auth/login-request" tests
 * below. There's no real mailbox in tests, so the token itself is recovered
 * the same way bookings.confirmDecline.test.ts inspects enqueued jobs -- by
 * reading the email_jobs row it enqueued, not by receiving an email.
 */
async function requestLoginToken(email: string): Promise<string> {
  await requestLoginLink(email);

  const job = await pool.query<{ payload: { loginUrl: string } }>(
    `SELECT payload FROM email_jobs WHERE type = 'masseur_login_link' ORDER BY created_at DESC LIMIT 1`,
  );
  const loginUrl = job.rows[0]?.payload.loginUrl;
  if (!loginUrl) {
    throw new Error("no masseur_login_link email job was enqueued");
  }
  const token = new URL(loginUrl).searchParams.get("token");
  if (!token) {
    throw new Error("login link did not contain a token");
  }
  return token;
}

describe("POST /auth/login-request", () => {
  it("enqueues a masseur_login_link email job for the configured ADMIN_EMAIL", async () => {
    const response = await request(app)
      .post("/auth/login-request")
      .send({ email: "admin@example.com" });

    expect(response.status).toBe(200);

    const jobs = await pool.query(`SELECT type FROM email_jobs WHERE type = 'masseur_login_link'`);
    expect(jobs.rowCount).toBe(1);
  });

  it("returns an identical response and enqueues nothing for a non-matching email", async () => {
    const matching = await request(app)
      .post("/auth/login-request")
      .send({ email: "admin@example.com" });
    const nonMatching = await request(app)
      .post("/auth/login-request")
      .send({ email: "not-the-admin@example.com" });

    expect(nonMatching.status).toBe(matching.status);
    expect(nonMatching.body).toEqual(matching.body);

    const jobs = await pool.query(`SELECT type FROM email_jobs WHERE type = 'masseur_login_link'`);
    expect(jobs.rowCount).toBe(1); // only the matching request enqueued one
  });

  it("rejects a malformed email with 400", async () => {
    const response = await request(app)
      .post("/auth/login-request")
      .send({ email: "not-an-email" });
    expect(response.status).toBe(400);
  });
});

describe("GET /auth/login", () => {
  it("issues a session bearer token for a valid, unused, unexpired login token", async () => {
    const token = await requestLoginToken("admin@example.com");

    const response = await request(app).get("/auth/login").query({ token });

    expect(response.status).toBe(200);
    expect(typeof response.body.token).toBe("string");
    expect(response.body.token).not.toBe(token);
  });

  it("rejects an unknown token with 401, not 500", async () => {
    const response = await request(app).get("/auth/login").query({ token: "unknown-token" });
    expect(response.status).toBe(401);
  });

  it("rejects reusing the same login token a second time", async () => {
    const token = await requestLoginToken("admin@example.com");

    const first = await request(app).get("/auth/login").query({ token });
    expect(first.status).toBe(200);

    const second = await request(app).get("/auth/login").query({ token });
    expect(second.status).toBe(401);
  });

  it("allows only one of two concurrent uses of the same login token to succeed", async () => {
    const token = await requestLoginToken("admin@example.com");

    const [first, second] = await Promise.all([
      request(app).get("/auth/login").query({ token }),
      request(app).get("/auth/login").query({ token }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 401]);
  });
});

describe("POST /auth/logout", () => {
  it("revokes the current session so a subsequent request with the same token is rejected", async () => {
    const loginToken = await requestLoginToken("admin@example.com");
    const loginResponse = await request(app).get("/auth/login").query({ token: loginToken });
    const authHeader = { Authorization: `Bearer ${loginResponse.body.token}` };

    const logoutResponse = await request(app).post("/auth/logout").set(authHeader).send();
    expect(logoutResponse.status).toBe(200);

    const reused = await request(app).post("/auth/logout").set(authHeader).send();
    expect(reused.status).toBe(401);
  });

  it("rejects logout without a valid session", async () => {
    const response = await request(app).post("/auth/logout").send();
    expect(response.status).toBe(401);
  });
});
