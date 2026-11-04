import { describe, expect, it } from "vitest";
import { createAvailabilityExceptionSchema } from "../../src/validation/adminAvailabilitySchema.js";
import { createServiceSchema, updateServiceSchema } from "../../src/validation/adminServiceSchema.js";
import { availabilityQuerySchema } from "../../src/validation/availabilityQuerySchema.js";
import { bookingIdParamSchema } from "../../src/validation/bookingIdParam.js";
import { createBookingSchema } from "../../src/validation/bookingSchema.js";
import { idParamSchema } from "../../src/validation/idParamSchema.js";
import { loginRequestSchema } from "../../src/validation/loginRequestSchema.js";

// Pins request-validation behaviour across the zod 3 -> 4 migration (task 039).
const NON_RFC_UUID = "11111111-1111-1111-1111-111111111111";
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const V4_UUID = "123e4567-e89b-42d3-a456-426614174000";

const validBooking = {
  service_id: V4_UUID,
  start_at: "2099-01-01T10:00:00Z",
  customer: { name: "Asiakas", email: "asiakas@example.com", phone: "0401234567" },
};
const validService = { name: "Hieronta", price: 60, duration_minutes: 60 };

function firstMessage(result: { success: boolean; error?: { issues: { message: string }[] } }): string | undefined {
  return result.error?.issues[0]?.message;
}

describe("UUID parameters stay on the permissive 8-4-4-4-12 check", () => {
  it.each([V4_UUID, NON_RFC_UUID, NIL_UUID])("accepts %s", (id) => {
    expect(idParamSchema.safeParse({ id }).success).toBe(true);
    expect(bookingIdParamSchema.safeParse({ id }).success).toBe(true);
  });

  it.each(["", "not-a-uuid", `${V4_UUID}0`, V4_UUID.replaceAll("-", "")])("rejects %j", (id) => {
    expect(firstMessage(idParamSchema.safeParse({ id }))).toBe("id must be a valid UUID");
    expect(firstMessage(bookingIdParamSchema.safeParse({ id }))).toBe(
      "booking id must be a valid UUID",
    );
  });
});

describe("custom validation messages are preserved", () => {
  it("keeps the service_id message on bookings and availability", () => {
    const expected = "service_id must be a valid UUID";
    expect(firstMessage(createBookingSchema.safeParse({ ...validBooking, service_id: "x" }))).toBe(
      expected,
    );
    expect(
      firstMessage(availabilityQuerySchema.safeParse({ service_id: "x", date: "2099-01-01" })),
    ).toBe(expected);
  });

  it("keeps the email message", () => {
    expect(firstMessage(loginRequestSchema.safeParse({ email: "a@b" }))).toBe(
      "email must be a valid email",
    );
  });

  it("keeps refinement messages on object schemas", () => {
    expect(firstMessage(updateServiceSchema.safeParse({}))).toBe(
      "at least one field must be provided",
    );
    expect(
      firstMessage(
        createAvailabilityExceptionSchema.safeParse({
          date: "2099-01-01",
          type: "open",
          start_time: "10:00:00",
          end_time: "09:00:00",
        }),
      ),
    ).toBe("end_time must be after start_time");
  });
});

describe("schema shape behaviour", () => {
  it("applies service defaults when optional fields are absent", () => {
    const parsed = createServiceSchema.parse(validService);
    expect(parsed).toMatchObject({ buffer_before_minutes: 0, buffer_after_minutes: 0, active: true });
  });

  it("trims and accepts a surrounding-whitespace email", () => {
    expect(loginRequestSchema.parse({ email: "  a@example.com " }).email).toBe("a@example.com");
  });

  it("rejects unknown keys at the top level and when nested", () => {
    expect(createBookingSchema.safeParse({ ...validBooking, extra: 1 }).success).toBe(false);
    expect(
      createBookingSchema.safeParse({
        ...validBooking,
        customer: { ...validBooking.customer, extra: 1 },
      }).success,
    ).toBe(false);
  });

  it("rejects a repeated query parameter parsed into an array", () => {
    const result = availabilityQuerySchema.safeParse({
      service_id: [V4_UUID, V4_UUID],
      date: "2099-01-01",
    });
    expect(result.success).toBe(false);
  });

  it.each([undefined, null, "text", 1, []])("rejects a non-object body: %j", (body) => {
    expect(createBookingSchema.safeParse(body).success).toBe(false);
  });
});

// Deliberate tightening from zod 4. JSON.parse("1e400") yields Infinity, so
// these values can reach the schema in a real request body.
describe("numeric edge cases rejected since zod 4", () => {
  it("rejects an infinite price", () => {
    const body = JSON.parse('{"name":"Hieronta","price":1e400,"duration_minutes":60}');
    expect(createServiceSchema.safeParse(body).success).toBe(false);
  });

  it("rejects an integer outside the safe range", () => {
    expect(createServiceSchema.safeParse({ ...validService, duration_minutes: 1e20 }).success).toBe(
      false,
    );
  });

  it("still accepts the largest safe integer", () => {
    expect(
      createServiceSchema.safeParse({ ...validService, duration_minutes: Number.MAX_SAFE_INTEGER })
        .success,
    ).toBe(true);
  });
});
