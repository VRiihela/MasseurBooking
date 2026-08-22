import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AdminCalendar } from "../src/pages/AdminCalendar";

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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubFetch(bookings: unknown[] | (() => Response) = [PENDING_BOOKING, CONFIRMED_BOOKING]) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes("/admin/bookings")) {
      return typeof bookings === "function" ? bookings() : jsonResponse(bookings);
    }
    throw new Error(`Unhandled fetch call: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
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
