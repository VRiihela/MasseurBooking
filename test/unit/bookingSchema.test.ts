import { describe, expect, it } from "vitest";
import { createBookingSchema } from "../../src/validation/bookingSchema.js";

const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

function payload(overrides: Record<string, unknown> = {}) {
  return {
    service_id: "11111111-1111-1111-1111-111111111111",
    start_at: future,
    customer: { name: "Jane Doe", email: "jane@example.com", phone: "+1234567890" },
    ...overrides,
  };
}

describe("createBookingSchema", () => {
  it("accepts a valid UTC payload", () => {
    expect(createBookingSchema.safeParse(payload()).success).toBe(true);
  });

  it("rejects start_at without an explicit UTC offset", () => {
    const result = createBookingSchema.safeParse(payload({ start_at: "2026-08-01T10:00:00" }));
    expect(result.success).toBe(false);
  });

  it("rejects start_at with a non-UTC offset", () => {
    const result = createBookingSchema.safeParse(
      payload({ start_at: "2026-08-01T10:00:00+02:00" }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects start_at in the past", () => {
    const result = createBookingSchema.safeParse(payload({ start_at: "2020-01-01T10:00:00Z" }));
    expect(result.success).toBe(false);
  });

  it("rejects a missing customer email", () => {
    const result = createBookingSchema.safeParse(
      payload({ customer: { name: "Jane Doe", phone: "+1234567890" } }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects an invalid service_id", () => {
    const result = createBookingSchema.safeParse(payload({ service_id: "not-a-uuid" }));
    expect(result.success).toBe(false);
  });

  it("rejects unknown top-level fields (e.g. a client-supplied end_at)", () => {
    const result = createBookingSchema.safeParse(payload({ end_at: future }));
    expect(result.success).toBe(false);
  });

  it("rejects an empty customer name", () => {
    const result = createBookingSchema.safeParse(
      payload({ customer: { name: "  ", email: "jane@example.com", phone: "+1234567890" } }),
    );
    expect(result.success).toBe(false);
  });
});
