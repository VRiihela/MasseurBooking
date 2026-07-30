import { describe, expect, it } from "vitest";
import type { BookingEmailPayload } from "../../src/db/types.js";
import { renderEmail } from "../../src/services/emailTemplates.js";

const basePayload: BookingEmailPayload = {
  bookingId: "booking-1",
  customerEmail: "jane@example.com",
  customerName: "Jane Doe",
  serviceName: "Deep Tissue Massage",
  startAtLocal: "Monday, August 17, 2026 at 9:00 AM EDT",
};

describe("renderEmail", () => {
  it("renders booking_request_received using only payload fields", () => {
    const message = renderEmail("booking_request_received", basePayload);
    expect(message.to).toBe(basePayload.customerEmail);
    expect(message.subject).toContain("Deep Tissue Massage");
    expect(message.body).toContain("Jane Doe");
    expect(message.body).toContain(basePayload.startAtLocal);
    expect(message.body).toContain(basePayload.bookingId);
  });

  it("renders booking_confirmed using only payload fields", () => {
    const message = renderEmail("booking_confirmed", basePayload);
    expect(message.subject.toLowerCase()).toContain("confirmed");
    expect(message.body).toContain("Deep Tissue Massage");
  });

  it("renders booking_declined without a reason when none is present", () => {
    const message = renderEmail("booking_declined", { ...basePayload, cancellationReason: null });
    expect(message.subject.toLowerCase()).toContain("could not be accommodated");
    expect(message.body).not.toContain("Reason:");
  });

  it("renders booking_declined with the cancellation reason when present", () => {
    const message = renderEmail("booking_declined", {
      ...basePayload,
      cancellationReason: "fully booked that day",
    });
    expect(message.body).toContain("Reason: fully booked that day");
  });

  it("strips control characters from a crafted customerName before it reaches the subject or body", () => {
    const message = renderEmail("booking_confirmed", {
      ...basePayload,
      customerName: "Evil\r\nBCC: attacker@example.com",
    });
    expect(message.subject).not.toMatch(/[\r\n]/);
    expect(message.body).not.toMatch(/Evil\r\nBCC/);
  });

  it("strips control characters from a crafted cancellationReason", () => {
    const message = renderEmail("booking_declined", {
      ...basePayload,
      cancellationReason: "no longer available\r\nX-Injected: true",
    });
    expect(message.body).not.toMatch(/\r\n/);
  });
});
