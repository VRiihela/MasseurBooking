import type { Request } from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clientIpFromRequest, rateLimitKey } from "../../src/middleware/rateLimit.js";

const SOCKET_IP = "100.64.0.7";

function fakeRequest(headers: Record<string, string | string[]>, ip: string | undefined = SOCKET_IP): Request {
  return { headers, ip } as unknown as Request;
}

describe("rateLimitKey with RATE_LIMIT_CLIENT_IP_HEADER set", () => {
  beforeEach(() => {
    process.env.RATE_LIMIT_CLIENT_IP_HEADER = "x-real-ip";
  });

  afterEach(() => {
    delete process.env.RATE_LIMIT_CLIENT_IP_HEADER;
  });

  it("uses a valid IPv4 address from the configured header", () => {
    expect(rateLimitKey(fakeRequest({ "x-real-ip": "203.0.113.5" }))).toBe("203.0.113.5");
  });

  it("matches the configured header name case-insensitively", () => {
    process.env.RATE_LIMIT_CLIENT_IP_HEADER = " X-Real-IP ";
    expect(rateLimitKey(fakeRequest({ "x-real-ip": "203.0.113.5" }))).toBe("203.0.113.5");
  });

  it("ignores X-Forwarded-For entirely", () => {
    const req = fakeRequest({ "x-real-ip": "203.0.113.5", "x-forwarded-for": "198.51.100.1" });
    expect(rateLimitKey(req)).toBe("203.0.113.5");
  });

  it.each([
    ["missing", {}],
    ["empty", { "x-real-ip": "" }],
    ["not an IP", { "x-real-ip": "not-an-ip" }],
    ["a comma-separated list", { "x-real-ip": "203.0.113.5, 198.51.100.1" }],
    ["padded with whitespace", { "x-real-ip": " 203.0.113.5" }],
    ["oversized", { "x-real-ip": "1".repeat(10_000) }],
    ["an array", { "x-real-ip": ["203.0.113.5", "198.51.100.1"] }],
  ])("falls back to req.ip when the header is %s", (_label, headers) => {
    expect(clientIpFromRequest(fakeRequest(headers))).toBe(SOCKET_IP);
    expect(rateLimitKey(fakeRequest(headers))).toBe(SOCKET_IP);
  });

  it("folds an IPv4-mapped IPv6 address into plain IPv4", () => {
    expect(rateLimitKey(fakeRequest({ "x-real-ip": "::ffff:203.0.113.5" }))).toBe("203.0.113.5");
  });

  it("groups IPv6 addresses in the same /56 and separates different /56s", () => {
    const a = rateLimitKey(fakeRequest({ "x-real-ip": "2001:db8:1:1::1" }));
    const sameSubnet = rateLimitKey(fakeRequest({ "x-real-ip": "2001:db8:1:ff::2" }));
    const otherSubnet = rateLimitKey(fakeRequest({ "x-real-ip": "2001:db8:2:1::1" }));

    expect(a).toBe(sameSubnet);
    expect(a).not.toBe(otherSubnet);
  });
});

describe("rateLimitKey with RATE_LIMIT_CLIENT_IP_HEADER unset", () => {
  beforeEach(() => {
    delete process.env.RATE_LIMIT_CLIENT_IP_HEADER;
  });

  it.each([undefined, "", "   "])("ignores the header when the variable is %j", (value) => {
    if (value !== undefined) {
      process.env.RATE_LIMIT_CLIENT_IP_HEADER = value;
    }
    expect(rateLimitKey(fakeRequest({ "x-real-ip": "203.0.113.5" }))).toBe(SOCKET_IP);
    delete process.env.RATE_LIMIT_CLIENT_IP_HEADER;
  });

  it("normalises a mapped req.ip the same way", () => {
    expect(rateLimitKey(fakeRequest({}, "::ffff:127.0.0.1"))).toBe("127.0.0.1");
  });

  it("puts a request with no address at all into one 'unknown' bucket", () => {
    const noAddress = { headers: {}, ip: undefined } as unknown as Request;
    expect(rateLimitKey(noAddress)).toBe("unknown");
  });
});
