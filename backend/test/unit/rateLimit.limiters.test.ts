import type { Options } from "express-rate-limit";
import { describe, expect, it, vi } from "vitest";

// Records the options every limiter in src/middleware/rateLimit.ts is created
// with, while still building the real limiter.
const created = vi.hoisted(() => [] as Partial<Options>[]);

vi.mock("express-rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("express-rate-limit")>();
  return {
    ...actual,
    default: (options: Partial<Options>) => {
      created.push(options);
      return actual.default(options);
    },
  };
});

const { rateLimitKey } = await import("../../src/middleware/rateLimit.js");

describe("rate limiter configuration", () => {
  it("creates exactly seven limiters, all keyed by the shared rateLimitKey", () => {
    expect(created).toHaveLength(7);
    for (const options of created) {
      expect(options.keyGenerator).toBe(rateLimitKey);
    }
  });

  it("keeps every limit and window unchanged", () => {
    expect(created.map((options) => [options.windowMs, options.limit])).toEqual([
      [60_000, 5], // bookingCreationRateLimit
      [60_000, 20], // adminRateLimit
      [60_000, 5], // loginRequestRateLimit
      [60_000, 30], // availabilityRateLimit
      [60_000, 30], // publicServicesRateLimit
      [60_000, 20], // customerBookingViewRateLimit
      [60_000, 20], // customerBookingActionRateLimit
    ]);
  });

  it("never sets ipv6Subnet alongside the custom key generator", () => {
    for (const options of created) {
      expect(options.ipv6Subnet).toBeUndefined();
    }
  });
});
