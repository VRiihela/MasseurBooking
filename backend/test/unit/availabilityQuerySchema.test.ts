import { describe, expect, it } from "vitest";
import { availabilityQuerySchema } from "../../src/validation/availabilityQuerySchema.js";

const validServiceId = "11111111-1111-1111-1111-111111111111";

describe("availabilityQuerySchema", () => {
  it("accepts a valid service_id and date", () => {
    const result = availabilityQuerySchema.safeParse({
      service_id: validServiceId,
      date: "2026-08-15",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a non-UUID service_id", () => {
    const result = availabilityQuerySchema.safeParse({
      service_id: "not-a-uuid",
      date: "2026-08-15",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed date shape", () => {
    const result = availabilityQuerySchema.safeParse({
      service_id: validServiceId,
      date: "08/15/2026",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a date that doesn't exist on the calendar", () => {
    const result = availabilityQuerySchema.safeParse({
      service_id: validServiceId,
      date: "2026-02-30",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing date", () => {
    const result = availabilityQuerySchema.safeParse({ service_id: validServiceId });
    expect(result.success).toBe(false);
  });

  it("rejects unknown extra query params", () => {
    const result = availabilityQuerySchema.safeParse({
      service_id: validServiceId,
      date: "2026-08-15",
      foo: "bar",
    });
    expect(result.success).toBe(false);
  });
});
