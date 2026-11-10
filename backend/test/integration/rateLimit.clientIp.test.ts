import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { closePool } from "../../src/db/pool.js";

// Exercises the real publicServicesRateLimit (30 requests/minute) on
// GET /services. Each test uses its own client IPs so the buckets, which
// live for the whole file, don't interfere across tests.
const app = createApp();
const LIMIT = 30;

function getServices(headers: Record<string, string> = {}) {
  return request(app).get("/services").set(headers);
}

function remaining(response: { headers: Record<string, string> }): number {
  return Number(response.headers["ratelimit-remaining"]);
}

afterAll(async () => {
  await closePool();
});

describe("rate limiting keyed on X-Real-IP (RATE_LIMIT_CLIENT_IP_HEADER=x-real-ip)", () => {
  beforeEach(() => {
    process.env.RATE_LIMIT_CLIENT_IP_HEADER = "x-real-ip";
  });

  afterEach(() => {
    delete process.env.RATE_LIMIT_CLIENT_IP_HEADER;
  });

  it("gives different clients separate buckets", async () => {
    const a1 = await getServices({ "X-Real-IP": "192.0.2.10" });
    const a2 = await getServices({ "X-Real-IP": "192.0.2.10" });
    const b1 = await getServices({ "X-Real-IP": "192.0.2.11" });

    expect(a1.status).toBe(200);
    expect(remaining(a1)).toBe(LIMIT - 1);
    expect(remaining(a2)).toBe(LIMIT - 2);
    expect(remaining(b1)).toBe(LIMIT - 1);
  });

  it("does not give a client a fresh bucket for a forged X-Forwarded-For", async () => {
    const first = await getServices({ "X-Real-IP": "192.0.2.20", "X-Forwarded-For": "198.51.100.1" });
    const forged = await getServices({ "X-Real-IP": "192.0.2.20", "X-Forwarded-For": "198.51.100.2" });

    expect(remaining(first)).toBe(LIMIT - 1);
    expect(remaining(forged)).toBe(LIMIT - 2);
  });

  it("does not let a forged X-Forwarded-For consume another client's bucket", async () => {
    const victim = await getServices({ "X-Real-IP": "192.0.2.30" });
    await getServices({ "X-Real-IP": "192.0.2.31", "X-Forwarded-For": "192.0.2.30" });
    await getServices({ "X-Real-IP": "192.0.2.31", "X-Forwarded-For": "192.0.2.30" });
    const victimAgain = await getServices({ "X-Real-IP": "192.0.2.30" });

    expect(remaining(victim)).toBe(LIMIT - 1);
    expect(remaining(victimAgain)).toBe(LIMIT - 2);
  });

  it("keeps a limited client blocked whatever X-Forwarded-For it sends, without affecting others", async () => {
    for (let i = 0; i < LIMIT; i += 1) {
      const response = await getServices({ "X-Real-IP": "192.0.2.40" });
      expect(response.status).toBe(200);
    }

    const blocked = await getServices({ "X-Real-IP": "192.0.2.40", "X-Forwarded-For": "198.51.100.40" });
    const other = await getServices({ "X-Real-IP": "192.0.2.41" });

    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: "Too many requests. Please try again shortly." });
    expect(other.status).toBe(200);
    expect(remaining(other)).toBe(LIMIT - 1);
  });

  it("falls back to req.ip for a missing, invalid or oversized header, separately from header clients", async () => {
    const missing = await getServices();
    const invalid = await getServices({ "X-Real-IP": "not-an-ip" });
    const list = await getServices({ "X-Real-IP": "192.0.2.50, 192.0.2.51" });
    const oversized = await getServices({ "X-Real-IP": "1".repeat(8_000) });
    const headerClient = await getServices({ "X-Real-IP": "192.0.2.52" });

    // All four fallbacks land in the single req.ip bucket, one after another.
    expect(remaining(invalid)).toBe(remaining(missing) - 1);
    expect(remaining(list)).toBe(remaining(missing) - 2);
    expect(remaining(oversized)).toBe(remaining(missing) - 3);
    expect(remaining(headerClient)).toBe(LIMIT - 1);
  });

  it("groups IPv6 clients by /56", async () => {
    const first = await getServices({ "X-Real-IP": "2001:db8:60:1::1" });
    const sameSubnet = await getServices({ "X-Real-IP": "2001:db8:60:2::9" });
    const otherSubnet = await getServices({ "X-Real-IP": "2001:db8:61:1::1" });

    expect(remaining(first)).toBe(LIMIT - 1);
    expect(remaining(sameSubnet)).toBe(LIMIT - 2);
    expect(remaining(otherSubnet)).toBe(LIMIT - 1);
  });

  it("treats an IPv4-mapped IPv6 address as the same client as plain IPv4", async () => {
    const mapped = await getServices({ "X-Real-IP": "::ffff:192.0.2.70" });
    const plain = await getServices({ "X-Real-IP": "192.0.2.70" });

    expect(remaining(mapped)).toBe(LIMIT - 1);
    expect(remaining(plain)).toBe(LIMIT - 2);
  });
});

describe("rate limiting with RATE_LIMIT_CLIENT_IP_HEADER unset", () => {
  beforeEach(() => {
    delete process.env.RATE_LIMIT_CLIENT_IP_HEADER;
  });

  it("ignores X-Real-IP, so a client cannot pick its own bucket", async () => {
    const first = await getServices({ "X-Real-IP": "192.0.2.80" });
    const second = await getServices({ "X-Real-IP": "192.0.2.81" });

    expect(remaining(second)).toBe(remaining(first) - 1);
  });
});
