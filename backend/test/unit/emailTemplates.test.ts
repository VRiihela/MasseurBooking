import { describe, expect, it } from "vitest";
import type { BookingEmailPayload, MasseurBookingChangeEmailPayload } from "../../src/db/types.js";
import { renderEmail } from "../../src/services/emailTemplates.js";

const basePayload: BookingEmailPayload = {
  bookingId: "booking-1",
  customerEmail: "jane@example.com",
  customerName: "Jane Doe",
  serviceName: "Deep Tissue Massage",
  startAtLocal: "Monday, August 17, 2026 at 9:00 AM EDT",
  manageUrl: "https://example.com/bookings/booking-1?token=abc123",
};

describe("renderEmail", () => {
  it("renders booking_request_received using only payload fields", () => {
    const message = renderEmail("booking_request_received", basePayload);
    expect(message.to).toBe(basePayload.customerEmail);
    expect(message.subject).toContain("Deep Tissue Massage");
    expect(message.body).toContain("Jane Doe");
    expect(message.body).toContain(basePayload.startAtLocal);
    expect(message.body).toContain(basePayload.bookingId);
    expect(message.body).toContain(basePayload.manageUrl);
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

  it("renders booking_cancelled_by_customer using only payload fields", () => {
    const message = renderEmail("booking_cancelled_by_customer", {
      ...basePayload,
      cancellationReason: "cancelled by customer",
    });
    expect(message.to).toBe(basePayload.customerEmail);
    expect(message.subject.toLowerCase()).toContain("cancelled");
    expect(message.body).toContain(basePayload.manageUrl);
  });

  it("renders masseur_booking_change_notice with the cancellation reason", () => {
    const payload: MasseurBookingChangeEmailPayload = {
      adminEmail: "admin@example.com",
      bookingId: "booking-1",
      serviceName: "Deep Tissue Massage",
      startAtLocal: "Monday, August 17, 2026 at 9:00 AM EDT",
      cancellationReason: "rescheduled by customer",
    };
    const message = renderEmail("masseur_booking_change_notice", payload);
    expect(message.to).toBe("admin@example.com");
    expect(message.body).toContain("Deep Tissue Massage");
    expect(message.body).toContain("Reason: rescheduled by customer");
  });

  it("renders masseur_booking_change_notice without a reason line when none is present", () => {
    const payload: MasseurBookingChangeEmailPayload = {
      adminEmail: "admin@example.com",
      bookingId: "booking-1",
      serviceName: "Deep Tissue Massage",
      startAtLocal: "Monday, August 17, 2026 at 9:00 AM EDT",
      cancellationReason: null,
    };
    const message = renderEmail("masseur_booking_change_notice", payload);
    expect(message.body).not.toContain("Reason:");
  });
});
