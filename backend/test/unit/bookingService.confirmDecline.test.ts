import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_BASE_URL = "https://example.com";

const queryMock = vi.fn();

vi.mock("../../src/db/pool.js", () => ({
  withTransaction: async (work: (client: unknown) => Promise<unknown>) =>
    work({ query: queryMock }),
}));

const { cancelBookingForAdmin, confirmBooking, declineBooking } = await import(
  "../../src/services/bookingService.js"
);
const { BookingNotConfirmedError, BookingNotFoundError, BookingNotPendingError } = await import(
  "../../src/errors.js"
);

const bookingRow = {
  id: "booking-1",
  provider_id: "provider-1",
  service_id: "service-1",
  customer_id: "customer-1",
  start_at: new Date(),
  end_at: new Date(),
  status: "confirmed",
  created_at: new Date(),
  confirmed_at: new Date(),
  cancelled_at: null,
  cancellation_reason: null,
};

beforeEach(() => {
  queryMock.mockReset();
});

describe("confirmBooking", () => {
  it("transitions a pending booking to confirmed and enqueues the confirmation email", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [bookingRow] }) // conditional UPDATE
      .mockResolvedValueOnce({ rows: [{ email: "jane@example.com" }] }) // customer email lookup
      .mockResolvedValueOnce(undefined); // email_jobs insert

    const booking = await confirmBooking("booking-1");

    expect(booking.status).toBe("confirmed");
    expect(booking.confirmedAt).not.toBeNull();
  });

  it("throws BookingNotPendingError when the booking exists but is not pending", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] }) // conditional UPDATE matches nothing
      .mockResolvedValueOnce({ rows: [{ ...bookingRow, status: "cancelled" }] }); // existence check

    await expect(confirmBooking("booking-1")).rejects.toBeInstanceOf(BookingNotPendingError);
  });

  it("throws BookingNotFoundError when the booking does not exist", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] }) // conditional UPDATE matches nothing
      .mockResolvedValueOnce({ rows: [] }); // existence check finds nothing

    await expect(confirmBooking("unknown-id")).rejects.toBeInstanceOf(BookingNotFoundError);
  });
});

describe("declineBooking", () => {
  it("transitions a pending booking to cancelled with a reason and enqueues the decline email", async () => {
    const cancelledRow = {
      ...bookingRow,
      status: "cancelled",
      confirmed_at: null,
      cancelled_at: new Date(),
      cancellation_reason: "fully booked that day",
    };
    queryMock
      .mockResolvedValueOnce({ rows: [cancelledRow] })
      .mockResolvedValueOnce({ rows: [{ email: "jane@example.com" }] })
      .mockResolvedValueOnce(undefined);

    const booking = await declineBooking("booking-1", "fully booked that day");

    expect(booking.status).toBe("cancelled");
    expect(booking.cancellationReason).toBe("fully booked that day");
  });

  it("throws BookingNotPendingError on a double decline", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ ...bookingRow, status: "cancelled" }] });

    await expect(declineBooking("booking-1", undefined)).rejects.toBeInstanceOf(
      BookingNotPendingError,
    );
  });
});

describe("cancelBookingForAdmin", () => {
  it("transitions a confirmed booking to cancelled with the given reason and enqueues the masseur-cancel email", async () => {
    const cancelledRow = {
      ...bookingRow,
      status: "cancelled",
      confirmed_at: new Date(),
      cancelled_at: new Date(),
      cancellation_reason: "double-booked by mistake",
    };
    queryMock
      .mockResolvedValueOnce({ rows: [cancelledRow] })
      .mockResolvedValueOnce({ rows: [{ email: "jane@example.com" }] })
      .mockResolvedValueOnce(undefined);

    const booking = await cancelBookingForAdmin("booking-1", "double-booked by mistake");

    expect(booking.status).toBe("cancelled");
    expect(booking.cancellationReason).toBe("double-booked by mistake");
    const [updateSql, updateParams] = queryMock.mock.calls[0];
    expect(updateSql).toMatch(/WHERE id = \$1 AND status = 'confirmed'/);
    expect(updateParams).toEqual(["booking-1", "double-booked by mistake"]);
  });

  it("defaults the cancellation reason to 'cancelled by masseur' when none is supplied", async () => {
    const cancelledRow = {
      ...bookingRow,
      status: "cancelled",
      confirmed_at: new Date(),
      cancelled_at: new Date(),
      cancellation_reason: "cancelled by masseur",
    };
    queryMock
      .mockResolvedValueOnce({ rows: [cancelledRow] })
      .mockResolvedValueOnce({ rows: [{ email: "jane@example.com" }] })
      .mockResolvedValueOnce(undefined);

    const booking = await cancelBookingForAdmin("booking-1", undefined);

    expect(booking.cancellationReason).toBe("cancelled by masseur");
    const [, updateParams] = queryMock.mock.calls[0];
    expect(updateParams).toEqual(["booking-1", "cancelled by masseur"]);
  });

  it("throws BookingNotConfirmedError when the booking exists but is not confirmed (e.g. still pending)", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ ...bookingRow, status: "pending" }] });

    await expect(cancelBookingForAdmin("booking-1", undefined)).rejects.toBeInstanceOf(
      BookingNotConfirmedError,
    );
  });

  it("throws BookingNotConfirmedError when the booking is already cancelled", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ ...bookingRow, status: "cancelled" }] });

    await expect(cancelBookingForAdmin("booking-1", undefined)).rejects.toBeInstanceOf(
      BookingNotConfirmedError,
    );
  });

  it("throws BookingNotFoundError when the booking does not exist", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });

    await expect(cancelBookingForAdmin("unknown-id", undefined)).rejects.toBeInstanceOf(
      BookingNotFoundError,
    );
  });
});
