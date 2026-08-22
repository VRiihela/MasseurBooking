import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Views } from "react-big-calendar";
import {
  AdminCalendar,
  formatBatchResult,
  planSlotBlock,
  runBatchBlock,
  toLocalDateString,
  toLocalTimeString,
} from "../src/pages/AdminCalendar";
import type { AvailabilityException } from "../src/api/types";

const SESSION_TOKEN_STORAGE_KEY = "masseurSessionToken";
const TOKEN = "session-token-abc";

// Pinned an hour after "now" so bookings land inside today's Day/Week view
// without depending on wall-clock time when the test suite happens to run.
const NOW = new Date("2026-08-10T12:00:00.000Z");
const inAnHour = new Date(NOW.getTime() + 60 * 60_000);
const inThreeHours = new Date(NOW.getTime() + 3 * 60 * 60_000);
const inFourHours = new Date(NOW.getTime() + 4 * 60 * 60_000);

const PENDING_BOOKING = {
  id: "booking-1",
  status: "pending",
  service_name: "Deep Tissue Massage",
  customer_name: "Jane Doe",
  customer_email: "jane@example.com",
  customer_phone: "555-0100",
  start_at: inAnHour.toISOString(),
  end_at: inThreeHours.toISOString(),
  start_at_local: "Monday, August 10, 2026 at 1:00 PM GMT+3",
  end_at_local: "Monday, August 10, 2026 at 3:00 PM GMT+3",
  created_at: "2026-08-01T00:00:00.000Z",
};

const CONFIRMED_BOOKING = {
  ...PENDING_BOOKING,
  id: "booking-2",
  status: "confirmed",
  customer_name: "John Smith",
  start_at: inThreeHours.toISOString(),
  end_at: inFourHours.toISOString(),
  start_at_local: "Monday, August 10, 2026 at 3:00 PM GMT+3",
  end_at_local: "Monday, August 10, 2026 at 4:00 PM GMT+3",
};

const CANCELLED_BOOKING = {
  ...PENDING_BOOKING,
  id: "booking-3",
  status: "cancelled",
  customer_name: "Cancelled Customer",
};

// Derived from NOW via the same helper the component uses, rather than
// hardcoded, so this lands on "today" regardless of the test runner's local
// timezone.
const TODAY_LOCAL = toLocalDateString(NOW);

const BLOCKED_EXCEPTION = {
  id: "exc-existing",
  date: TODAY_LOCAL,
  type: "blocked",
  start_time: "00:00:00",
  end_time: "23:59:59",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface ExceptionRoutes {
  list?: () => Response;
  create?: (body: unknown) => Response;
  delete?: (id: string) => Response;
}

let exceptionIdCounter = 0;

function stubFetch(
  bookings: unknown[] | (() => Response) = [PENDING_BOOKING, CONFIRMED_BOOKING],
  exceptionRoutes: ExceptionRoutes = {},
) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const method = init?.method ?? "GET";

    if (url.includes("/admin/availability-exceptions") && method === "DELETE") {
      const id = url.split("/").pop() as string;
      return exceptionRoutes.delete ? exceptionRoutes.delete(id) : jsonResponse({ id, deleted: true });
    }
    if (url.includes("/admin/availability-exceptions") && method === "POST") {
      const body: unknown = init?.body ? JSON.parse(init.body as string) : undefined;
      return exceptionRoutes.create
        ? exceptionRoutes.create(body)
        : jsonResponse({ id: `exc-${++exceptionIdCounter}`, ...(body as object) }, 201);
    }
    if (url.includes("/admin/availability-exceptions")) {
      return exceptionRoutes.list ? exceptionRoutes.list() : jsonResponse([]);
    }
    if (url.includes("/admin/bookings")) {
      return typeof bookings === "function" ? bookings() : jsonResponse(bookings);
    }
    throw new Error(`Unhandled fetch call: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

beforeEach(() => {
  // Fake only Date -- faking setTimeout too would deadlock
  // findBy*/waitFor, which poll via real timers.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  exceptionIdCounter = 0;
});

describe("AdminCalendar", () => {
  it("offers month, week, and day views, switchable by the masseur", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    stubFetch([]);

    const { container } = render(<AdminCalendar onSessionEnded={() => {}} />);
    await screen.findByTestId("admin-calendar-grid");

    expect(container.querySelector(".rbc-time-view")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Month" }));
    expect(container.querySelector(".rbc-month-view")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Week" }));
    expect(container.querySelector(".rbc-time-view")).not.toBeNull();
    expect(container.querySelector(".rbc-month-view")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Day" }));
    expect(container.querySelector(".rbc-time-view")).not.toBeNull();
  });

  it("visually distinguishes pending from confirmed bookings and excludes cancelled ones", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    stubFetch([PENDING_BOOKING, CONFIRMED_BOOKING, CANCELLED_BOOKING]);

    render(<AdminCalendar onSessionEnded={() => {}} />);
    await screen.findByTestId("admin-calendar-grid");

    const pendingEvent = screen.getByText("Deep Tissue Massage — Jane Doe").closest(".rbc-event");
    const confirmedEvent = screen.getByText("Deep Tissue Massage — John Smith").closest(".rbc-event");

    expect(pendingEvent).toHaveClass("admin-calendar-event-pending");
    expect(confirmedEvent).toHaveClass("admin-calendar-event-confirmed");
    expect(pendingEvent?.className).not.toBe(confirmedEvent?.className);

    expect(screen.queryByText("Deep Tissue Massage — Cancelled Customer")).toBeNull();
  });

  it("positions events from start_at/end_at even when start_at_local is unparseable prose", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    stubFetch([
      {
        ...PENDING_BOOKING,
        start_at_local: "not a real parseable date string",
        end_at_local: "also not parseable",
      },
    ]);

    render(<AdminCalendar onSessionEnded={() => {}} />);
    await screen.findByTestId("admin-calendar-grid");

    expect(screen.getByText("Deep Tissue Massage — Jane Doe")).not.toBeNull();
  });

  it("shows read-only booking details on selection, with no Confirm/Decline/Cancel controls", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    stubFetch([PENDING_BOOKING]);

    render(<AdminCalendar onSessionEnded={() => {}} />);
    await screen.findByTestId("admin-calendar-grid");

    fireEvent.click(screen.getByText("Deep Tissue Massage — Jane Doe"));

    const dialog = await screen.findByRole("dialog", { name: "Booking details" });
    expect(dialog).toHaveTextContent("Deep Tissue Massage");
    expect(dialog).toHaveTextContent("Jane Doe");
    expect(dialog).toHaveTextContent("jane@example.com");
    expect(dialog).toHaveTextContent("Status: pending");

    expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Decline" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel booking" })).toBeNull();
  });

  it("clears the session and reports it ended on a 401 from the bookings list", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    stubFetch(() => jsonResponse({ error: "Unauthorized" }, 401));
    const onSessionEnded = vi.fn();

    render(<AdminCalendar onSessionEnded={onSessionEnded} />);

    await waitFor(() => {
      expect(onSessionEnded).toHaveBeenCalled();
    });
    expect(localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)).toBeNull();
  });
});

describe("planSlotBlock", () => {
  it("month view: a single selected day plans one full-day block", () => {
    const day = new Date(2026, 7, 12); // August is month index 7
    const plan = planSlotBlock({ start: day, end: day, slots: [day] }, Views.MONTH);
    expect(plan).toEqual({
      dates: ["2026-08-12"],
      timeRange: { start_time: "00:00:00", end_time: "23:59:59" },
    });
  });

  it("month view: a multi-day drag plans one full-day block per date", () => {
    const slots = [new Date(2026, 7, 17), new Date(2026, 7, 18), new Date(2026, 7, 19)];
    const plan = planSlotBlock({ start: slots[0], end: slots[2], slots }, Views.MONTH);
    expect(plan).toEqual({
      dates: ["2026-08-17", "2026-08-18", "2026-08-19"],
      timeRange: { start_time: "00:00:00", end_time: "23:59:59" },
    });
  });

  it("day view: a same-day time range plans one block using local start/end times", () => {
    const start = new Date(2026, 7, 12, 9, 0, 0);
    const end = new Date(2026, 7, 12, 12, 30, 0);
    const plan = planSlotBlock({ start, end, slots: [start] }, Views.DAY);
    expect(plan).toEqual({
      dates: ["2026-08-12"],
      timeRange: { start_time: "09:00:00", end_time: "12:30:00" },
    });
  });

  it("day/week view: a selection crossing midnight is rejected with an error, not silently clipped", () => {
    const start = new Date(2026, 7, 12, 23, 0, 0);
    const end = new Date(2026, 7, 13, 1, 0, 0);
    const plan = planSlotBlock({ start, end, slots: [start] }, Views.WEEK);
    expect(plan).toEqual({
      error: "Can't block a range that crosses midnight -- select a range within a single day.",
    });
  });
});

describe("toLocalDateString / toLocalTimeString", () => {
  it("zero-pads single-digit month, day, hour, minute, and second", () => {
    const date = new Date(2026, 0, 5, 9, 5, 3);
    expect(toLocalDateString(date)).toBe("2026-01-05");
    expect(toLocalTimeString(date)).toBe("09:05:03");
  });
});

describe("runBatchBlock", () => {
  beforeEach(() => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
  });

  it("creates every date when none are already blocked", async () => {
    stubFetch([]);
    const timeRange = { start_time: "00:00:00", end_time: "23:59:59" };

    const outcome = await runBatchBlock(["2026-08-17", "2026-08-18"], timeRange, []);

    expect(outcome.result.newlyBlocked).toEqual(["2026-08-17", "2026-08-18"]);
    expect(outcome.result.alreadyBlocked).toEqual([]);
    expect(outcome.result.failed).toEqual([]);
    expect(outcome.created).toHaveLength(2);
    expect(outcome.unauthorized).toBe(false);
  });

  it("skips a date that already has a full-day block instead of creating a duplicate", async () => {
    const { fetchMock } = stubFetch([]);
    const timeRange = { start_time: "00:00:00", end_time: "23:59:59" };
    const known: AvailabilityException[] = [
      { id: "exc-1", date: "2026-08-17", type: "blocked", ...timeRange },
    ];

    const outcome = await runBatchBlock(["2026-08-17", "2026-08-18"], timeRange, known);

    expect(outcome.result.newlyBlocked).toEqual(["2026-08-18"]);
    expect(outcome.result.alreadyBlocked).toEqual(["2026-08-17"]);
    expect(outcome.result.failed).toEqual([]);
    const postCalls = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit)?.method === "POST");
    expect(postCalls).toHaveLength(1);
  });

  it("does not skip a non-full-day range on an already-blocked date -- overlapping sub-day blocks are legitimate", async () => {
    stubFetch([]);
    const known: AvailabilityException[] = [
      { id: "exc-1", date: "2026-08-17", type: "blocked", start_time: "00:00:00", end_time: "23:59:59" },
    ];

    const outcome = await runBatchBlock(
      ["2026-08-17"],
      { start_time: "12:00:00", end_time: "13:00:00" },
      known,
    );

    expect(outcome.result.newlyBlocked).toEqual(["2026-08-17"]);
    expect(outcome.result.alreadyBlocked).toEqual([]);
  });

  it("continues past a mid-batch failure and still attempts the remaining dates", async () => {
    stubFetch([], {
      create: (body) => {
        const date = (body as { date: string }).date;
        if (date === "2026-08-18") {
          return jsonResponse({ error: "end_time must be after start_time" }, 400);
        }
        return jsonResponse({ id: `exc-${date}`, ...(body as object) }, 201);
      },
    });
    const timeRange = { start_time: "00:00:00", end_time: "23:59:59" };

    const outcome = await runBatchBlock(
      ["2026-08-17", "2026-08-18", "2026-08-19"],
      timeRange,
      [],
    );

    expect(outcome.result.newlyBlocked).toEqual(["2026-08-17", "2026-08-19"]);
    expect(outcome.result.failed).toEqual([
      { date: "2026-08-18", message: "end_time must be after start_time" },
    ]);
    expect(outcome.unauthorized).toBe(false);
  });

  it("stops the batch on a 401 and reports unauthorized instead of continuing", async () => {
    stubFetch([], {
      create: (body) => {
        const date = (body as { date: string }).date;
        if (date === "2026-08-18") {
          return jsonResponse({ error: "Unauthorized" }, 401);
        }
        return jsonResponse({ id: `exc-${date}`, ...(body as object) }, 201);
      },
    });
    const timeRange = { start_time: "00:00:00", end_time: "23:59:59" };

    const outcome = await runBatchBlock(
      ["2026-08-17", "2026-08-18", "2026-08-19"],
      timeRange,
      [],
    );

    expect(outcome.result.newlyBlocked).toEqual(["2026-08-17"]);
    expect(outcome.unauthorized).toBe(true);
  });
});

describe("formatBatchResult", () => {
  it("matches the required three-outcome phrasing: newly blocked, already blocked, and failures are never folded together", () => {
    const message = formatBatchResult({
      newlyBlocked: ["1", "2", "3", "4", "5"],
      alreadyBlocked: ["6", "7"],
      failed: [],
    });
    expect(message).toBe("Blocked 5 new days (2 were already blocked)");
  });

  it("uses singular wording for exactly one newly-blocked or already-blocked date", () => {
    expect(formatBatchResult({ newlyBlocked: ["1"], alreadyBlocked: [], failed: [] })).toBe(
      "Blocked 1 new day",
    );
    expect(formatBatchResult({ newlyBlocked: [], alreadyBlocked: ["1"], failed: [] })).toBe(
      "Blocked 0 new days (1 was already blocked)",
    );
  });

  it("appends failed dates with their backend messages, distinct from the success/skip counts", () => {
    const message = formatBatchResult({
      newlyBlocked: ["2026-08-17"],
      alreadyBlocked: [],
      failed: [{ date: "2026-08-18", message: "Too many requests. Please try again shortly." }],
    });
    expect(message).toBe(
      "Blocked 1 new day. Failed: 2026-08-18 (Too many requests. Please try again shortly.)",
    );
  });
});

describe("AdminCalendar Manage-availability mode", () => {
  it("defaults to View mode: no availability-exceptions fetch happens until Manage mode is entered", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    const { fetchMock } = stubFetch([PENDING_BOOKING]);

    render(<AdminCalendar onSessionEnded={() => {}} />);
    await screen.findByTestId("admin-calendar-grid");

    expect(
      fetchMock.mock.calls.some(([url]) => (url as string).includes("/admin/availability-exceptions")),
    ).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Manage availability" }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) => (url as string).includes("/admin/availability-exceptions")),
      ).toBe(true);
    });
  });

  it("renders an existing blocked exception distinctly from booking events once in Manage mode", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    stubFetch([PENDING_BOOKING], { list: () => jsonResponse([BLOCKED_EXCEPTION]) });

    render(<AdminCalendar onSessionEnded={() => {}} />);
    await screen.findByTestId("admin-calendar-grid");
    fireEvent.click(screen.getByRole("button", { name: "Manage availability" }));

    const blockedEvent = await screen.findByText("Blocked");
    expect(blockedEvent.closest(".rbc-event")).toHaveClass("admin-calendar-event-blocked");

    const bookingEvent = screen.getByText("Deep Tissue Massage — Jane Doe").closest(".rbc-event");
    expect(bookingEvent).not.toHaveClass("admin-calendar-event-blocked");
  });

  it("tapping an existing blocked exception unblocks it immediately, removing it from the calendar", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    const { fetchMock } = stubFetch([], { list: () => jsonResponse([BLOCKED_EXCEPTION]) });

    render(<AdminCalendar onSessionEnded={() => {}} />);
    await screen.findByTestId("admin-calendar-grid");
    fireEvent.click(screen.getByRole("button", { name: "Manage availability" }));

    const blockedEvent = await screen.findByText("Blocked");
    fireEvent.click(blockedEvent);

    await waitFor(() => {
      expect(screen.queryByText("Blocked")).toBeNull();
    });
    const deleteCalls = fetchMock.mock.calls.filter(
      ([url, init]) =>
        (url as string).includes(`/admin/availability-exceptions/${BLOCKED_EXCEPTION.id}`) &&
        (init as RequestInit | undefined)?.method === "DELETE",
    );
    expect(deleteCalls).toHaveLength(1);
  });

  it("surfaces a failed unblock as readable text and leaves the exception in place", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    stubFetch([], {
      list: () => jsonResponse([BLOCKED_EXCEPTION]),
      delete: () => jsonResponse({ error: "Availability exception not found" }, 404),
    });

    render(<AdminCalendar onSessionEnded={() => {}} />);
    await screen.findByTestId("admin-calendar-grid");
    fireEvent.click(screen.getByRole("button", { name: "Manage availability" }));

    const blockedEvent = await screen.findByText("Blocked");
    fireEvent.click(blockedEvent);

    expect(await screen.findByRole("alert")).toHaveTextContent("Availability exception not found");
    expect(screen.getByText("Blocked")).not.toBeNull();
  });

  it("View mode's Calendar props are unaffected -- selecting a slot does nothing outside Manage mode", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    const { fetchMock } = stubFetch([PENDING_BOOKING]);

    render(<AdminCalendar onSessionEnded={() => {}} />);
    const grid = await screen.findByTestId("admin-calendar-grid");

    // selectable is false in View mode, so react-big-calendar attaches no
    // drag-select affordance at all -- confirmed indirectly by there being no
    // availability-exceptions traffic no matter what's clicked in the grid.
    fireEvent.mouseDown(grid);
    fireEvent.mouseUp(grid);

    expect(
      fetchMock.mock.calls.some(([url]) => (url as string).includes("/admin/availability-exceptions")),
    ).toBe(false);
  });
});
