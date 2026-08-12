import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();

vi.mock("../../src/db/pool.js", () => ({
  getPool: () => ({ query: queryMock }),
}));

const { claimQueuedJobs, markJobFailedAttempt, markJobSent, processJobsOnce } = await import(
  "../../src/services/emailWorker.js"
);

beforeEach(() => {
  queryMock.mockReset();
});

describe("claimQueuedJobs", () => {
  it("claims via a single UPDATE ... FOR UPDATE SKIP LOCKED statement with batchSize and stale-window params", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ id: "job-1", type: "booking_confirmed", payload: {}, attempts: 0 }],
    });

    const jobs = await claimQueuedJobs(5);

    expect(jobs).toHaveLength(1);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/FOR UPDATE SKIP LOCKED/);
    expect(sql).toMatch(/SET status = 'sending'/);
    expect(params[0]).toBe(5);
  });
});

describe("markJobSent", () => {
  it("sets status to sent with sent_at", async () => {
    queryMock.mockResolvedValueOnce(undefined);
    await markJobSent("job-1", "booking_confirmed", {
      bookingId: "b1",
      customerEmail: "jane@example.com",
      customerName: "Jane",
      serviceName: "Massage",
      startAtLocal: "Monday at 9am",
      manageUrl: "https://example.com/bookings/b1?token=abc123",
    });
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/status = 'sent'/);
    expect(sql).toMatch(/sent_at = now\(\)/);
    expect(params[0]).toBe("job-1");
  });

  it("redacts manageUrl from a booking email payload once sent", async () => {
    queryMock.mockResolvedValueOnce(undefined);
    await markJobSent("job-1", "booking_confirmed", {
      bookingId: "b1",
      customerEmail: "jane@example.com",
      customerName: "Jane",
      serviceName: "Massage",
      startAtLocal: "Monday at 9am",
      manageUrl: "https://example.com/bookings/b1?token=abc123",
    });
    const [, params] = queryMock.mock.calls[0];
    const storedPayload = JSON.parse(params[1]);
    expect(storedPayload.manageUrl).toBeUndefined();
    expect(storedPayload.customerName).toBe("Jane");
    expect(storedPayload.serviceName).toBe("Massage");
  });

  it("redacts manageUrl from a booking_cancelled_by_masseur payload once sent", async () => {
    queryMock.mockResolvedValueOnce(undefined);
    await markJobSent("job-1", "booking_cancelled_by_masseur", {
      bookingId: "b1",
      customerEmail: "jane@example.com",
      customerName: "Jane",
      serviceName: "Massage",
      startAtLocal: "Monday at 9am",
      cancellationReason: "cancelled by masseur",
      manageUrl: "https://example.com/bookings/b1?token=abc123",
    });
    const [, params] = queryMock.mock.calls[0];
    const storedPayload = JSON.parse(params[1]);
    expect(storedPayload.manageUrl).toBeUndefined();
    expect(storedPayload.customerName).toBe("Jane");
    expect(storedPayload.cancellationReason).toBe("cancelled by masseur");
  });

  it("redacts loginUrl from a masseur login-link payload once sent", async () => {
    queryMock.mockResolvedValueOnce(undefined);
    await markJobSent("job-1", "masseur_login_link", {
      adminEmail: "admin@example.com",
      loginUrl: "https://example.com/auth/login?token=abc123",
    });
    const [, params] = queryMock.mock.calls[0];
    const storedPayload = JSON.parse(params[1]);
    expect(storedPayload.loginUrl).toBeUndefined();
    expect(storedPayload.adminEmail).toBe("admin@example.com");
  });

  it("leaves a masseur_booking_change_notice payload untouched -- it never carries a token", async () => {
    queryMock.mockResolvedValueOnce(undefined);
    await markJobSent("job-1", "masseur_booking_change_notice", {
      adminEmail: "admin@example.com",
      bookingId: "b1",
      serviceName: "Massage",
      startAtLocal: "Monday at 9am",
      cancellationReason: "cancelled by customer",
    });
    const [, params] = queryMock.mock.calls[0];
    const storedPayload = JSON.parse(params[1]);
    expect(storedPayload).toEqual({
      adminEmail: "admin@example.com",
      bookingId: "b1",
      serviceName: "Massage",
      startAtLocal: "Monday at 9am",
      cancellationReason: "cancelled by customer",
    });
  });
});

describe("markJobFailedAttempt", () => {
  it("returns the job to 'queued' with a backoff delay when under the max attempt count", async () => {
    queryMock.mockResolvedValueOnce(undefined);
    await markJobFailedAttempt("job-1", 0, "boom");
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/status = 'queued'/);
    expect(params).toEqual(["job-1", 1, "boom", 60_000]); // 1st failure -> 60s backoff
  });

  it("doubles the backoff delay on the second failure", async () => {
    queryMock.mockResolvedValueOnce(undefined);
    await markJobFailedAttempt("job-1", 1, "boom again");
    const [, params] = queryMock.mock.calls[0];
    expect(params).toEqual(["job-1", 2, "boom again", 120_000]);
  });

  it("caps the backoff delay", async () => {
    queryMock.mockResolvedValueOnce(undefined);
    await markJobFailedAttempt("job-1", 3, "still failing");
    const [, params] = queryMock.mock.calls[0];
    expect(params[3]).toBeLessThanOrEqual(30 * 60_000);
  });

  it("marks the job permanently 'failed' at the max attempt count", async () => {
    queryMock.mockResolvedValueOnce(undefined);
    await markJobFailedAttempt("job-1", 4, "final failure"); // 4 -> 5th attempt = MAX_ATTEMPTS
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/status = 'failed'/);
    expect(params).toEqual(["job-1", 5, "final failure"]);
  });
});

describe("processJobsOnce", () => {
  it("marks a job sent when the sender succeeds", async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: "job-1",
            type: "booking_confirmed",
            payload: {
              bookingId: "b1",
              customerEmail: "jane@example.com",
              customerName: "Jane",
              serviceName: "Massage",
              startAtLocal: "Monday at 9am",
            },
            attempts: 0,
          },
        ],
      })
      .mockResolvedValueOnce(undefined); // markJobSent

    const sender = { send: vi.fn().mockResolvedValue(undefined) };
    await processJobsOnce(sender, 10);

    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(queryMock.mock.calls[1][0]).toMatch(/status = 'sent'/);
  });

  it("marks a job failed-attempt when the sender rejects", async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: "job-1",
            type: "booking_confirmed",
            payload: {
              bookingId: "b1",
              customerEmail: "jane@example.com",
              customerName: "Jane",
              serviceName: "Massage",
              startAtLocal: "Monday at 9am",
            },
            attempts: 0,
          },
        ],
      })
      .mockResolvedValueOnce(undefined); // markJobFailedAttempt

    const sender = { send: vi.fn().mockRejectedValue(new Error("provider down")) };
    await processJobsOnce(sender, 10);

    expect(queryMock.mock.calls[1][0]).toMatch(/status = 'queued'/);
    expect(queryMock.mock.calls[1][1]).toEqual(["job-1", 1, "provider down", 60_000]);
  });
});
