import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  start_at_local: "maanantai 10. elokuuta 2026 klo 9.00",
  end_at_local: "maanantai 10. elokuuta 2026 klo 10.00",
  created_at: "2026-08-01T00:00:00.000Z",
};

const CONFIRMED_BOOKING = {
  ...PENDING_BOOKING,
  id: "booking-2",
  status: "confirmed",
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
  cancel?: (body: unknown) => Response;
  logout?: () => Response;
  availabilityRules?: () => Response;
  services?: () => Response;
}

function stubFetch(routes: FetchRoutes = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    // Nested /admin/bookings/:id/* paths are checked before the plain list
    // route below, since they also contain the "/admin/bookings" substring.
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
    if (url.includes("/cancel")) {
      const body: unknown = init?.body ? JSON.parse(init.body as string) : undefined;
      return routes.cancel
        ? routes.cancel(body)
        : jsonResponse({
            id: "booking-2",
            status: "cancelled",
            cancelled_at: "2026-08-01T00:00:00.000Z",
            cancellation_reason: "cancelled by masseur",
          });
    }
    if (url.includes("/admin/bookings")) {
      return routes.bookings ? routes.bookings() : jsonResponse([PENDING_BOOKING]);
    }
    if (url.includes("/admin/availability-rules")) {
      return routes.availabilityRules ? routes.availabilityRules() : jsonResponse([]);
    }
    if (url.includes("/admin/services")) {
      return routes.services ? routes.services() : jsonResponse([]);
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

    fireEvent.click(screen.getByRole("button", { name: "Vahvista" }));

    await waitFor(() => {
      expect(screen.getByTestId("booking-booking-1")).toHaveTextContent("Tila: vahvistettu");
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

    fireEvent.click(screen.getByRole("button", { name: "Hylkää" }));
    fireEvent.click(screen.getByRole("button", { name: "Vahvista hylkäys" }));

    await waitFor(() => {
      expect(screen.getByTestId("booking-booking-1")).toHaveTextContent("Tila: peruttu");
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

    fireEvent.click(screen.getByRole("button", { name: "Hylkää" }));
    fireEvent.change(screen.getByLabelText("Syy (valinnainen)"), {
      target: { value: "  Not available  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Vahvista hylkäys" }));

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

  it("shows Cancel booking only for a confirmed booking, not a pending one", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    stubFetch({ bookings: () => jsonResponse([PENDING_BOOKING, CONFIRMED_BOOKING]) });

    render(<AdminDashboard onSessionEnded={() => {}} />);
    await screen.findByTestId("booking-booking-1");

    const pendingItem = within(screen.getByTestId("booking-booking-1"));
    expect(pendingItem.queryByRole("button", { name: "Peru varaus" })).toBeNull();

    const confirmedItem = within(screen.getByTestId("booking-booking-2"));
    expect(confirmedItem.getByRole("button", { name: "Peru varaus" })).not.toBeNull();
    expect(confirmedItem.queryByRole("button", { name: "Vahvista" })).toBeNull();
    expect(confirmedItem.queryByRole("button", { name: "Hylkää" })).toBeNull();
  });

  it("cancels a confirmed booking in place without refetching the list, using the two-step confirm", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    stubFetch({ bookings: () => jsonResponse([CONFIRMED_BOOKING]) });

    render(<AdminDashboard onSessionEnded={() => {}} />);
    await screen.findByTestId("booking-booking-2");

    fireEvent.click(screen.getByRole("button", { name: "Peru varaus" }));
    expect(screen.getByRole("button", { name: "Älä peru" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Vahvista peruutus" }));

    await waitFor(() => {
      expect(screen.getByTestId("booking-booking-2")).toHaveTextContent("Tila: peruttu");
    });
  });

  it("backs out of the cancel flow via Never mind without sending a request", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    const { fetchMock } = stubFetch({ bookings: () => jsonResponse([CONFIRMED_BOOKING]) });

    render(<AdminDashboard onSessionEnded={() => {}} />);
    await screen.findByTestId("booking-booking-2");

    fireEvent.click(screen.getByRole("button", { name: "Peru varaus" }));
    fireEvent.click(screen.getByRole("button", { name: "Älä peru" }));

    expect(screen.getByRole("button", { name: "Peru varaus" })).not.toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => (url as string).includes("/cancel"))).toBe(false);
  });

  it("cancels with a blank reason by omitting the reason field, not sending an empty string", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    let cancelBody: unknown;
    stubFetch({
      bookings: () => jsonResponse([CONFIRMED_BOOKING]),
      cancel: (body) => {
        cancelBody = body;
        return jsonResponse({
          id: "booking-2",
          status: "cancelled",
          cancelled_at: "2026-08-01T00:00:00.000Z",
          cancellation_reason: "cancelled by masseur",
        });
      },
    });

    render(<AdminDashboard onSessionEnded={() => {}} />);
    await screen.findByTestId("booking-booking-2");

    fireEvent.click(screen.getByRole("button", { name: "Peru varaus" }));
    fireEvent.click(screen.getByRole("button", { name: "Vahvista peruutus" }));

    await waitFor(() => {
      expect(screen.getByTestId("booking-booking-2")).toHaveTextContent("Tila: peruttu");
    });
    expect(cancelBody).toEqual({});
  });

  it("sends a trimmed reason when one is provided for cancel", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    let cancelBody: unknown;
    stubFetch({
      bookings: () => jsonResponse([CONFIRMED_BOOKING]),
      cancel: (body) => {
        cancelBody = body;
        return jsonResponse({
          id: "booking-2",
          status: "cancelled",
          cancelled_at: "2026-08-01T00:00:00.000Z",
          cancellation_reason: "Something came up",
        });
      },
    });

    render(<AdminDashboard onSessionEnded={() => {}} />);
    await screen.findByTestId("booking-booking-2");

    fireEvent.click(screen.getByRole("button", { name: "Peru varaus" }));
    fireEvent.change(screen.getByLabelText("Syy (valinnainen)"), {
      target: { value: "  Something came up  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Vahvista peruutus" }));

    await waitFor(() => {
      expect(cancelBody).toEqual({ reason: "Something came up" });
    });
  });

  it("clears the session and reports it ended on a 401 from cancel", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    stubFetch({
      bookings: () => jsonResponse([CONFIRMED_BOOKING]),
      cancel: () => jsonResponse({ error: "Unauthorized" }, 401),
    });
    const onSessionEnded = vi.fn();

    render(<AdminDashboard onSessionEnded={onSessionEnded} />);
    await screen.findByTestId("booking-booking-2");

    fireEvent.click(screen.getByRole("button", { name: "Peru varaus" }));
    fireEvent.click(screen.getByRole("button", { name: "Vahvista peruutus" }));

    await waitFor(() => {
      expect(onSessionEnded).toHaveBeenCalled();
    });
    expect(localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)).toBeNull();
  });

  it("switches to the calendar view and back via the toggle, without refetching or losing list state", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    const { fetchMock } = stubFetch();

    render(<AdminDashboard onSessionEnded={() => {}} />);
    await screen.findByTestId("booking-booking-1");

    fireEvent.click(screen.getByRole("button", { name: "Kalenteri" }));

    expect(screen.queryByTestId("booking-booking-1")).toBeNull();
    await screen.findByTestId("admin-calendar-grid");

    fireEvent.click(screen.getByRole("button", { name: "Lista" }));

    await screen.findByTestId("booking-booking-1");
    expect(screen.queryByTestId("admin-calendar-grid")).toBeNull();

    // The list's own bookings state persists across the toggle -- no refetch
    // on switching back, only the one initial load plus the calendar's own
    // independent fetch when it mounted.
    const listBookingsCalls = fetchMock.mock.calls.filter(([url]) =>
      (url as string).includes("/admin/bookings") && !(url as string).includes("status="),
    );
    expect(listBookingsCalls.length).toBeLessThanOrEqual(1);
  });

  it("switches to the availability view and back via the toggle, without disturbing the list", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    stubFetch();

    render(<AdminDashboard onSessionEnded={() => {}} />);
    await screen.findByTestId("booking-booking-1");

    fireEvent.click(screen.getByRole("button", { name: "Saatavuus" }));

    expect(screen.queryByTestId("booking-booking-1")).toBeNull();
    await screen.findByTestId("weekday-1");

    fireEvent.click(screen.getByRole("button", { name: "Lista" }));

    await screen.findByTestId("booking-booking-1");
    expect(screen.queryByTestId("weekday-1")).toBeNull();
  });

  it("switches to the services view and back via the toggle, without disturbing the list", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    stubFetch();

    render(<AdminDashboard onSessionEnded={() => {}} />);
    await screen.findByTestId("booking-booking-1");

    fireEvent.click(screen.getByRole("button", { name: "Palvelut" }));

    expect(screen.queryByTestId("booking-booking-1")).toBeNull();
    await screen.findByRole("region", { name: "Lisää uusi palvelu" });

    fireEvent.click(screen.getByRole("button", { name: "Lista" }));

    await screen.findByTestId("booking-booking-1");
    expect(screen.queryByRole("region", { name: "Lisää uusi palvelu" })).toBeNull();
  });

  it("logs out, clears the token, and ends the session even if the logout call fails", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    stubFetch({ logout: () => jsonResponse({ error: "Unauthorized" }, 401) });
    const onSessionEnded = vi.fn();

    render(<AdminDashboard onSessionEnded={onSessionEnded} />);
    await screen.findByTestId("booking-booking-1");

    fireEvent.click(screen.getByRole("button", { name: "Kirjaudu ulos" }));

    await waitFor(() => {
      expect(onSessionEnded).toHaveBeenCalled();
    });
    expect(localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)).toBeNull();
  });
});
