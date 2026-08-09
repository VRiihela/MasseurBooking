import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_BASE_URL = "https://example.com";

const queryMock = vi.fn();

vi.mock("../../src/db/pool.js", () => ({
  withTransaction: async (work: (client: unknown) => Promise<unknown>) =>
    work({ query: queryMock }),
}));

const { createBooking } = await import("../../src/services/bookingService.js");
const { SlotUnavailableError, ServiceNotFoundError } = await import("../../src/errors.js");

const baseInput = {
  service_id: "11111111-1111-1111-1111-111111111111",
  start_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  customer: { name: "Jane Doe", email: "jane@example.com", phone: "+1234567890" },
};

beforeEach(() => {
  queryMock.mockReset();
});

describe("createBooking", () => {
  it("computes end_at from service duration + buffers, never from client input", async () => {
    const activeService = {
      id: baseInput.service_id,
      provider_id: "provider-1",
      duration_minutes: 60,
      buffer_before_minutes: 5,
      buffer_after_minutes: 10,
    };
    const expectedEnd = new Date(new Date(baseInput.start_at).getTime() + 75 * 60_000);

    queryMock
      .mockResolvedValueOnce({ rows: [activeService] }) // loadActiveService
      .mockResolvedValueOnce(undefined) // advisory lock
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // overlap check
      .mockResolvedValueOnce({ rows: [{ id: "customer-1" }] }) // insert customer
      .mockResolvedValueOnce({
        rows: [
          {
            id: "booking-1",
            provider_id: "provider-1",
            service_id: baseInput.service_id,
            customer_id: "customer-1",
            start_at: new Date(baseInput.start_at),
            end_at: expectedEnd,
            status: "pending",
            created_at: new Date(),
          },
        ],
      }) // insert booking
      .mockResolvedValueOnce(undefined); // enqueue email job

    const booking = await createBooking(baseInput);

    expect(booking.status).toBe("pending");
    expect(booking.endAt.getTime()).toBe(expectedEnd.getTime());
  });

  it("throws SlotUnavailableError when an overlapping booking is found", async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: baseInput.service_id,
            provider_id: "provider-1",
            duration_minutes: 60,
            buffer_before_minutes: 0,
            buffer_after_minutes: 0,
          },
        ],
      })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] });

    await expect(createBooking(baseInput)).rejects.toBeInstanceOf(SlotUnavailableError);
  });

  it("throws ServiceNotFoundError when the service does not exist or is inactive", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    await expect(createBooking(baseInput)).rejects.toBeInstanceOf(ServiceNotFoundError);
  });
});
