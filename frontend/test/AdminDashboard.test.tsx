import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AdminDashboard } from "../src/pages/AdminDashboard";

const SESSION_TOKEN_STORAGE_KEY = "masseurSessionToken";
const TOKEN = "session-token-abc";

const PENDING_BOOKING = {
  id: "booking-1",
  status: "pending",
  service_name: "Deep Tissue Massage",
  customer_name: "Jane Doe",
  customer_email: "jane@example.com",
  customer_phone: "555-0100",
  start_at_local: "Monday, August 10, 2026 at 9:00 AM GMT+3",
  end_at_local: "Monday, August 10, 2026 at 10:00 AM GMT+3",
  created_at: "2026-08-01T00:00:00.000Z",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface FetchRoutes {
  bookings?: () => Response;
  confirm?: () => Response;
  decline?: (body: unknown) => Response;
  logout?: () => Response;
}

function stubFetch(routes: FetchRoutes = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.includes("/admin/bookings")) {
      return routes.bookings ? routes.bookings() : jsonResponse([PENDING_BOOKING]);
    }
    if (url.includes("/confirm")) {
      return routes.confirm
        ? routes.confirm()
        : jsonResponse({ id: "booking-1", status: "confirmed", confirmed_at: "2026-08-01T00:00:00.000Z" });
    }
    if (url.includes("/decline")) {
      const body: unknown = init?.body ? JSON.parse(init.body as string) : undefined;
      return routes.decline
        ? routes.decline(body)
        : jsonResponse({
            id: "booking-1",
            status: "cancelled",
            cancelled_at: "2026-08-01T00:00:00.000Z",
            cancellation_reason: null,
          });
    }
    if (url.includes("/auth/logout")) {
      return routes.logout ? routes.logout() : jsonResponse({ message: "Logged out" });
    }
    throw new Error(`Unhandled fetch call: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("AdminDashboard", () => {
  it("sends the Authorization header on GET /admin/bookings and lists pending bookings", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    const { calls } = stubFetch();

    render(<AdminDashboard onSessionEnded={() => {}} />);

    await screen.findByTestId("booking-booking-1");
    const bookingsCall = calls.find((call) => call.url.includes("/admin/bookings"));
    expect(bookingsCall?.init?.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}` });
  });

  it("confirms a pending booking in place without refetching the list", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    const { fetchMock } = stubFetch();

    render(<AdminDashboard onSessionEnded={() => {}} />);
    await screen.findByTestId("booking-booking-1");

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(screen.getByTestId("booking-booking-1")).toHaveTextContent("Status: confirmed");
    });
    const bookingsCalls = fetchMock.mock.calls.filter(([url]) =>
      (url as string).includes("/admin/bookings"),
    );
    expect(bookingsCalls).toHaveLength(1);
  });

  it("declines with a blank reason by omitting the reason field, not sending an empty string", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    let declineBody: unknown;
    stubFetch({
      decline: (body) => {
        declineBody = body;
        return jsonResponse({
          id: "booking-1",
          status: "cancelled",
          cancelled_at: "2026-08-01T00:00:00.000Z",
          cancellation_reason: null,
        });
      },
    });

    render(<AdminDashboard onSessionEnded={() => {}} />);
    await screen.findByTestId("booking-booking-1");

    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm decline" }));

    await waitFor(() => {
      expect(screen.getByTestId("booking-booking-1")).toHaveTextContent("Status: cancelled");
    });
    expect(declineBody).toEqual({});
  });

  it("sends a trimmed reason when one is provided", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    let declineBody: unknown;
    stubFetch({
      decline: (body) => {
        declineBody = body;
        return jsonResponse({
          id: "booking-1",
          status: "cancelled",
          cancelled_at: "2026-08-01T00:00:00.000Z",
          cancellation_reason: "Not available",
        });
      },
    });

    render(<AdminDashboard onSessionEnded={() => {}} />);
    await screen.findByTestId("booking-booking-1");

    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    fireEvent.change(screen.getByLabelText("Reason (optional)"), {
      target: { value: "  Not available  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm decline" }));

    await waitFor(() => {
      expect(declineBody).toEqual({ reason: "Not available" });
    });
  });

  it("clears the session and reports it ended on a 401 from the bookings list", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    stubFetch({ bookings: () => jsonResponse({ error: "Unauthorized" }, 401) });
    const onSessionEnded = vi.fn();

    render(<AdminDashboard onSessionEnded={onSessionEnded} />);

    await waitFor(() => {
      expect(onSessionEnded).toHaveBeenCalled();
    });
    expect(localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)).toBeNull();
  });

  it("logs out, clears the token, and ends the session even if the logout call fails", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    stubFetch({ logout: () => jsonResponse({ error: "Unauthorized" }, 401) });
    const onSessionEnded = vi.fn();

    render(<AdminDashboard onSessionEnded={onSessionEnded} />);
    await screen.findByTestId("booking-booking-1");

    fireEvent.click(screen.getByRole("button", { name: "Log out" }));

    await waitFor(() => {
      expect(onSessionEnded).toHaveBeenCalled();
    });
    expect(localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)).toBeNull();
  });
});
