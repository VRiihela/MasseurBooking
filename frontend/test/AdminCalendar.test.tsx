import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Views } from "react-big-calendar";
import {
  AdminCalendar,
  formatBatchResult,
  isoWeekNumberForRow,
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

interface BookingActionRoutes {
  confirm?: () => Response;
  decline?: (body: unknown) => Response;
  cancel?: (body: unknown) => Response;
}

let exceptionIdCounter = 0;

function stubFetch(
  bookings: unknown[] | (() => Response) = [PENDING_BOOKING, CONFIRMED_BOOKING],
  exceptionRoutes: ExceptionRoutes = {},
  actionRoutes: BookingActionRoutes = {},
) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const method = init?.method ?? "GET";
    const body: unknown = init?.body ? JSON.parse(init.body as string) : undefined;

    if (url.includes("/confirm")) {
      return actionRoutes.confirm
        ? actionRoutes.confirm()
        : jsonResponse({ id: "booking-1", status: "confirmed", confirmed_at: "2026-08-10T12:00:00.000Z" });
    }
    if (url.includes("/decline")) {
      return actionRoutes.decline
        ? actionRoutes.decline(body)
        : jsonResponse({
            id: "booking-1",
            status: "cancelled",
            cancelled_at: "2026-08-10T12:00:00.000Z",
            cancellation_reason: (body as { reason?: string } | undefined)?.reason ?? null,
          });
    }
    if (url.includes("/admin/bookings/") && url.includes("/cancel")) {
      return actionRoutes.cancel
        ? actionRoutes.cancel(body)
        : jsonResponse({
            id: "booking-2",
            status: "cancelled",
            cancelled_at: "2026-08-10T12:00:00.000Z",
            cancellation_reason: (body as { reason?: string } | undefined)?.reason ?? null,
          });
    }
    if (url.includes("/admin/availability-exceptions") && method === "DELETE") {
      const id = url.split("/").pop() as string;
      return exceptionRoutes.delete ? exceptionRoutes.delete(id) : jsonResponse({ id, deleted: true });
    }
    if (url.includes("/admin/availability-exceptions") && method === "POST") {
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

  it("shows booking details on selection, with Confirm/Decline for a pending booking and Cancel booking for a confirmed one", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    stubFetch([PENDING_BOOKING, CONFIRMED_BOOKING]);

    render(<AdminCalendar onSessionEnded={() => {}} />);
    await screen.findByTestId("admin-calendar-grid");

    fireEvent.click(screen.getByText("Deep Tissue Massage — Jane Doe"));
    const pendingDialog = await screen.findByRole("dialog", { name: "Booking details" });
    expect(pendingDialog).toHaveTextContent("Deep Tissue Massage");
    expect(pendingDialog).toHaveTextContent("Jane Doe");
    expect(pendingDialog).toHaveTextContent("jane@example.com");
    expect(pendingDialog).toHaveTextContent("Status: pending");
    expect(screen.getByRole("button", { name: "Confirm" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Decline" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel booking" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    fireEvent.click(screen.getByText("Deep Tissue Massage — John Smith"));
    const confirmedDialog = await screen.findByRole("dialog", { name: "Booking details" });
    expect(confirmedDialog).toHaveTextContent("Status: confirmed");
    expect(screen.getByRole("button", { name: "Cancel booking" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Decline" })).toBeNull();
  });

  it("confirms a pending booking from the popup: updates the grid's event color and keeps the dialog open", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    const { calls } = stubFetch([PENDING_BOOKING]);

    render(<AdminCalendar onSessionEnded={() => {}} />);
    await screen.findByTestId("admin-calendar-grid");

    fireEvent.click(screen.getByText("Deep Tissue Massage — Jane Doe"));
    await screen.findByRole("dialog", { name: "Booking details" });

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Booking details" })).toHaveTextContent("Status: confirmed");
    });
    expect(screen.getByText("Deep Tissue Massage — Jane Doe").closest(".rbc-event")).toHaveClass(
      "admin-calendar-event-confirmed",
    );
    expect(screen.getByRole("button", { name: "Cancel booking" })).not.toBeNull();

    const confirmCall = calls.find((call) => call.url.includes("/confirm"));
    expect(confirmCall?.url).toContain(`/bookings/${PENDING_BOOKING.id}/confirm`);
  });

  it("declines a pending booking with an optional reason: removes it from the grid and closes the dialog", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    const { calls } = stubFetch([PENDING_BOOKING]);

    render(<AdminCalendar onSessionEnded={() => {}} />);
    await screen.findByTestId("admin-calendar-grid");

    fireEvent.click(screen.getByText("Deep Tissue Massage — Jane Doe"));
    await screen.findByRole("dialog", { name: "Booking details" });

    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    fireEvent.change(screen.getByLabelText("Reason (optional)"), {
      target: { value: "Masseur unavailable" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm decline" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Booking details" })).toBeNull();
    });
    expect(screen.queryByText("Deep Tissue Massage — Jane Doe")).toBeNull();

    const declineCall = calls.find((call) => call.url.includes("/decline"));
    expect(declineCall?.url).toContain(`/bookings/${PENDING_BOOKING.id}/decline`);
    expect(JSON.parse(declineCall?.init?.body as string)).toEqual({ reason: "Masseur unavailable" });
  });

  it("declines without typing a reason: reason is omitted from the request", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    const { calls } = stubFetch([PENDING_BOOKING]);

    render(<AdminCalendar onSessionEnded={() => {}} />);
    await screen.findByTestId("admin-calendar-grid");

    fireEvent.click(screen.getByText("Deep Tissue Massage — Jane Doe"));
    await screen.findByRole("dialog", { name: "Booking details" });
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm decline" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Booking details" })).toBeNull();
    });

    const declineCall = calls.find((call) => call.url.includes("/decline"));
    expect(JSON.parse(declineCall?.init?.body as string)).toEqual({});
  });

  it("cancels a confirmed booking with an optional reason: removes it from the grid and closes the dialog", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    const { calls } = stubFetch([CONFIRMED_BOOKING]);

    render(<AdminCalendar onSessionEnded={() => {}} />);
    await screen.findByTestId("admin-calendar-grid");

    fireEvent.click(screen.getByText("Deep Tissue Massage — John Smith"));
    await screen.findByRole("dialog", { name: "Booking details" });

    fireEvent.click(screen.getByRole("button", { name: "Cancel booking" }));
    fireEvent.change(screen.getByLabelText("Reason (optional)"), {
      target: { value: "Customer requested" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm cancel" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Booking details" })).toBeNull();
    });
    expect(screen.queryByText("Deep Tissue Massage — John Smith")).toBeNull();

    const cancelCall = calls.find((call) => call.url.includes("/admin/bookings/") && call.url.includes("/cancel"));
    expect(cancelCall?.url).toContain(`/admin/bookings/${CONFIRMED_BOOKING.id}/cancel`);
    expect(JSON.parse(cancelCall?.init?.body as string)).toEqual({ reason: "Customer requested" });
  });

  it("surfaces a failed confirm as readable text inside the dialog and leaves the booking unchanged", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (url.includes("/confirm")) {
        return jsonResponse({ error: "Booking already confirmed" }, 409);
      }
      if (url.includes("/admin/bookings") && method === "GET") {
        return jsonResponse([PENDING_BOOKING]);
      }
      throw new Error(`Unhandled fetch call: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AdminCalendar onSessionEnded={() => {}} />);
    await screen.findByTestId("admin-calendar-grid");

    fireEvent.click(screen.getByText("Deep Tissue Massage — Jane Doe"));
    await screen.findByRole("dialog", { name: "Booking details" });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    const dialog = await screen.findByRole("dialog", { name: "Booking details" });
    await waitFor(() => {
      expect(dialog).toHaveTextContent("Booking already confirmed");
    });
    expect(dialog).toHaveTextContent("Status: pending");
    expect(screen.getByText("Deep Tissue Massage — Jane Doe").closest(".rbc-event")).toHaveClass(
      "admin-calendar-event-pending",
    );
  });

  it("clears the session and reports it ended on a 401 from a booking action", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    const onSessionEnded = vi.fn();
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (url.includes("/confirm")) {
        return jsonResponse({ error: "Unauthorized" }, 401);
      }
      if (url.includes("/admin/bookings") && method === "GET") {
        return jsonResponse([PENDING_BOOKING]);
      }
      throw new Error(`Unhandled fetch call: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AdminCalendar onSessionEnded={onSessionEnded} />);
    await screen.findByTestId("admin-calendar-grid");

    fireEvent.click(screen.getByText("Deep Tissue Massage — Jane Doe"));
    await screen.findByRole("dialog", { name: "Booking details" });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(onSessionEnded).toHaveBeenCalled();
    });
    expect(localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)).toBeNull();
  });

  it("confirming a booking works identically in Manage-availability mode", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    stubFetch([PENDING_BOOKING]);

    render(<AdminCalendar onSessionEnded={() => {}} />);
    await screen.findByTestId("admin-calendar-grid");

    fireEvent.click(screen.getByRole("button", { name: "Manage availability" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Manage availability" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    fireEvent.click(screen.getByText("Deep Tissue Massage — Jane Doe"));
    await screen.findByRole("dialog", { name: "Booking details" });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Booking details" })).toHaveTextContent("Status: confirmed");
    });
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

  it("selecting a different booking without closing the popup first does not carry over a stale error or reveal state", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (url.includes("/confirm")) {
        return jsonResponse({ error: "Booking already confirmed" }, 409);
      }
      if (url.includes("/admin/bookings") && method === "GET") {
        return jsonResponse([PENDING_BOOKING, CONFIRMED_BOOKING]);
      }
      throw new Error(`Unhandled fetch call: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AdminCalendar onSessionEnded={() => {}} />);
    await screen.findByTestId("admin-calendar-grid");

    fireEvent.click(screen.getByText("Deep Tissue Massage — Jane Doe"));
    await screen.findByRole("dialog", { name: "Booking details" });
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Booking details" })).toHaveTextContent(
        "Booking already confirmed",
      );
    });

    fireEvent.click(screen.getByText("Deep Tissue Massage — John Smith"));
    const dialog = await screen.findByRole("dialog", { name: "Booking details" });
    expect(dialog).toHaveTextContent("Status: confirmed");
    expect(dialog).not.toHaveTextContent("Booking already confirmed");
    expect(screen.queryByLabelText("Reason (optional)")).toBeNull();
  });
});

describe("AdminCalendar Month-view week numbers", () => {
  it("shows one distinct, ISO-week-numbered control per Month-view row", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    stubFetch([]);

    render(<AdminCalendar onSessionEnded={() => {}} />);
    await screen.findByTestId("admin-calendar-grid");
    fireEvent.click(screen.getByRole("button", { name: "Month" }));

    // August 2026 (NOW's month) renders as six Monday-start rows spanning
    // Jul 27 -- Sep 6. Monday-start rows no longer straddle two ISO weeks
    // (every day in a row now shares one ISO week number), so these come
    // out as 31..36 directly from each row's leading (Monday) cell.
    const weekButtons = screen.getAllByRole("button", { name: /^Week \d+$/ });
    expect(weekButtons.map((button) => button.textContent)).toEqual([
      "Wk 31",
      "Wk 32",
      "Wk 33",
      "Wk 34",
      "Wk 35",
      "Wk 36",
    ]);

    // Each week button must be a separate, distinctly-labelled control from
    // the date-number button in the same (Monday) cell, not confusable with
    // it -- verified via distinct accessible names/roles rather than pixels,
    // which also holds at a narrow (phone-width) viewport since it doesn't
    // depend on layout. "10" (Aug 10, 2026) is the Monday that starts the
    // "Week 33" row.
    expect(screen.getByRole("button", { name: "10" })).not.toBe(screen.getByRole("button", { name: "Week 33" }));
  });

  it("clicking a week number switches to Week view navigated to that exact week", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    stubFetch([]);

    const { container } = render(<AdminCalendar onSessionEnded={() => {}} />);
    await screen.findByTestId("admin-calendar-grid");
    fireEvent.click(screen.getByRole("button", { name: "Month" }));

    // Week 31 (Jul 27 -- Aug 2) is a different week than NOW (Aug 10, week
    // 33) falls in, so landing there confirms navigation actually happened
    // rather than Week view merely already showing a plausible default.
    fireEvent.click(screen.getByRole("button", { name: "Week 31" }));

    expect(container.querySelector(".rbc-time-view")).not.toBeNull();
    expect(container.querySelector(".rbc-month-view")).toBeNull();
    expect(screen.getByRole("button", { name: "Week" })).toHaveClass("rbc-active");
    expect(
      Array.from(container.querySelectorAll(".rbc-header")).map((header) => header.textContent),
    ).toEqual(["27 Mon", "28 Tue", "29 Wed", "30 Thu", "31 Fri", "01 Sat", "02 Sun"]);
  });

  it("leaves the existing date-number-to-Day-view behavior unchanged", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    stubFetch([]);

    const { container } = render(<AdminCalendar onSessionEnded={() => {}} />);
    await screen.findByTestId("admin-calendar-grid");
    fireEvent.click(screen.getByRole("button", { name: "Month" }));

    // "10" (Aug 10, 2026) rather than a day in the 27-31 range: those values
    // appear twice in this grid (once as July's off-range padding, once as
    // August's in-range date), which would make the button name ambiguous.
    fireEvent.click(screen.getByRole("button", { name: "10" }));

    expect(container.querySelector(".rbc-time-view")).not.toBeNull();
    expect(container.querySelector(".rbc-month-view")).toBeNull();
    expect(screen.getByRole("button", { name: "Day" })).toHaveClass("rbc-active");
    expect(
      Array.from(container.querySelectorAll(".rbc-header")).map((header) => header.textContent),
    ).toEqual(["10 Mon"]);
  });

  it("computes the correct ISO week number for a row spanning a year boundary", () => {
    // Dec 28, 2026 (Monday) starts a Month-view row running through Jan 3,
    // 2027 -- ISO week 53 of 2026, not a reset to week 1 -- the classic
    // year-boundary trap for hand-rolled week-number logic.
    expect(isoWeekNumberForRow(new Date(2026, 11, 28))).toBe(53);
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
  // Task 020 originally deferred this fetch until Manage mode was entered,
  // specifically to keep View mode's network behavior unchanged from task
  // 018. Task 027 revisits that: blocked time needs to be visible in View
  // mode too, so the fetch now runs unconditionally on mount (same timing as
  // the bookings fetch) rather than lazily on first entry into Manage mode.
  it("fetches blocked availability-exceptions on mount (View mode, the default) and does not re-fetch when Manage mode is entered", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    const { fetchMock } = stubFetch([PENDING_BOOKING], { list: () => jsonResponse([BLOCKED_EXCEPTION]) });

    render(<AdminCalendar onSessionEnded={() => {}} />);
    await screen.findByTestId("admin-calendar-grid");

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.filter(([url]) => (url as string).includes("/admin/availability-exceptions"))
          .length,
      ).toBe(1);
    });

    fireEvent.click(screen.getByRole("button", { name: "Manage availability" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Manage availability" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });
    // Still exactly one call -- entering Manage mode reuses what was already
    // fetched on mount rather than re-requesting it.
    expect(
      fetchMock.mock.calls.filter(([url]) => (url as string).includes("/admin/availability-exceptions"))
        .length,
    ).toBe(1);
  });

  it("renders an existing blocked exception in View mode, the default, without needing to enter Manage mode", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    stubFetch([PENDING_BOOKING], { list: () => jsonResponse([BLOCKED_EXCEPTION]) });

    render(<AdminCalendar onSessionEnded={() => {}} />);
    await screen.findByTestId("admin-calendar-grid");

    const blockedEvent = await screen.findByText("Blocked");
    expect(blockedEvent.closest(".rbc-event")).toHaveClass("admin-calendar-event-blocked");
  });

  it("tapping a blocked exception in View mode shows a read-only detail instead of unblocking it", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    const { fetchMock } = stubFetch([], { list: () => jsonResponse([BLOCKED_EXCEPTION]) });

    render(<AdminCalendar onSessionEnded={() => {}} />);
    await screen.findByTestId("admin-calendar-grid");

    const blockedEvent = await screen.findByText("Blocked");
    fireEvent.click(blockedEvent);

    await screen.findByRole("dialog", { name: "Blocked time details" });

    // Still on the grid -- View mode must not delete it. Two matches now:
    // the original grid event plus the read-only detail's own heading.
    expect(screen.getAllByText("Blocked")).toHaveLength(2);

    const deleteCalls = fetchMock.mock.calls.filter(
      ([url, init]) =>
        (url as string).includes(`/admin/availability-exceptions/${BLOCKED_EXCEPTION.id}`) &&
        (init as RequestInit | undefined)?.method === "DELETE",
    );
    expect(deleteCalls).toHaveLength(0);
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

    // Blocked exceptions are now fetched unconditionally on mount (task
    // 027), so there IS availability-exceptions traffic by this point -- the
    // one call from mount. What this test actually needs to prove is that
    // clicking inside the grid triggers no *additional* traffic, since
    // selectable is false in View mode and react-big-calendar attaches no
    // drag-select affordance at all.
    const exceptionsCallCountBefore = fetchMock.mock.calls.filter(([url]) =>
      (url as string).includes("/admin/availability-exceptions"),
    ).length;
    expect(exceptionsCallCountBefore).toBe(1);

    fireEvent.mouseDown(grid);
    fireEvent.mouseUp(grid);

    expect(
      fetchMock.mock.calls.filter(([url]) => (url as string).includes("/admin/availability-exceptions"))
        .length,
    ).toBe(exceptionsCallCountBefore);
  });
});
