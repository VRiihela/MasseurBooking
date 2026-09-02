import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ManageBooking } from "../src/pages/ManageBooking";

const BOOKING_ID = "booking-1";
const TOKEN = "a".repeat(64);
const SERVICE_ID = "svc-1";
const SLOT = "2026-08-20T09:00:00.000Z";
const SLOT_2 = "2026-08-20T10:00:00.000Z";

const PENDING_VIEW = {
  id: BOOKING_ID,
  status: "pending",
  service_id: SERVICE_ID,
  service_name: "Deep Tissue Massage",
  start_at_local: "maanantai 10. elokuuta 2026 klo 9.00",
  end_at_local: "maanantai 10. elokuuta 2026 klo 10.00",
};

const CANCELLED_VIEW = {
  ...PENDING_VIEW,
  status: "cancelled",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface FetchRoutes {
  view?: () => Response;
  cancel?: () => Response;
  reschedule?: (body: unknown) => Response;
  availability?: () => Response;
}

function stubFetch(routes: FetchRoutes = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.includes("/reschedule")) {
      const body: unknown = init?.body ? JSON.parse(init.body as string) : undefined;
      return routes.reschedule
        ? routes.reschedule(body)
        : jsonResponse({ id: BOOKING_ID, status: "pending", start_at: SLOT, end_at: SLOT }, 201);
    }
    if (url.includes("/cancel")) {
      return routes.cancel
        ? routes.cancel()
        : jsonResponse({ id: BOOKING_ID, status: "cancelled", cancelled_at: "2026-08-01T00:00:00.000Z" });
    }
    if (url.includes("/availability")) {
      return routes.availability ? routes.availability() : jsonResponse([SLOT, SLOT_2]);
    }
    if (url.includes(`/bookings/${BOOKING_ID}`)) {
      return routes.view ? routes.view() : jsonResponse(PENDING_VIEW);
    }
    throw new Error(`Unhandled fetch call: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

function setUrl(search: string) {
  window.history.pushState({}, "", `/bookings/${BOOKING_ID}${search}`);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ManageBooking", () => {
  it("renders service, status, and local start/end time on successful load", async () => {
    setUrl(`?token=${TOKEN}`);
    stubFetch();

    render(<ManageBooking bookingId={BOOKING_ID} />);

    expect(await screen.findByText(/Deep Tissue Massage/)).toBeInTheDocument();
    expect(screen.getByText("Tila: odottaa vahvistusta")).toBeInTheDocument();
    // Confirms both start and end local times render, joined by the en-dash
    // connector, rather than checking either field in isolation.
    expect(screen.getByText(/klo 9\.00 – maanantai/)).toBeInTheDocument();
  });

  it("shows a generic not-found state, never mentioning the token, when the token is missing", async () => {
    setUrl("");
    const { fetchMock } = stubFetch();

    render(<ManageBooking bookingId={BOOKING_ID} />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent?.toLowerCase()).not.toContain("token");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the same generic not-found state on a backend 404 (wrong token or wrong id)", async () => {
    setUrl(`?token=${TOKEN}`);
    stubFetch({ view: () => jsonResponse({ error: "Booking not found" }, 404) });

    render(<ManageBooking bookingId={BOOKING_ID} />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent?.toLowerCase()).not.toContain("token");
    expect(screen.getByRole("heading")).toHaveTextContent("Varausta ei löytynyt");
  });

  it("renders read-only with no Cancel/Reschedule controls for a cancelled booking", async () => {
    setUrl(`?token=${TOKEN}`);
    stubFetch({ view: () => jsonResponse(CANCELLED_VIEW) });

    render(<ManageBooking bookingId={BOOKING_ID} />);

    await screen.findByText("Tila: peruttu");
    expect(screen.queryByRole("button", { name: "Peru varaus" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Siirrä aikaa" })).not.toBeInTheDocument();
  });

  it("requires an explicit confirm step before calling POST /bookings/:id/cancel", async () => {
    setUrl(`?token=${TOKEN}`);
    const { fetchMock } = stubFetch();

    render(<ManageBooking bookingId={BOOKING_ID} />);
    await screen.findByText("Tila: odottaa vahvistusta");

    fireEvent.click(screen.getByRole("button", { name: "Peru varaus" }));
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/cancel"))).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Vahvista peruutus" }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/cancel"))).toBe(true);
    });
    await waitFor(() => expect(screen.getByText("Tila: peruttu")).toBeInTheDocument());
  });

  it("reschedules by POSTing the exact ISO string returned by GET /availability", async () => {
    setUrl(`?token=${TOKEN}`);
    let rescheduleBody: unknown;
    stubFetch({
      reschedule: (body) => {
        rescheduleBody = body;
        return jsonResponse({ id: "booking-2", status: "pending", start_at: SLOT, end_at: SLOT }, 201);
      },
    });

    render(<ManageBooking bookingId={BOOKING_ID} />);
    await screen.findByText("Tila: odottaa vahvistusta");

    fireEvent.click(screen.getByRole("button", { name: "Siirrä aikaa" }));
    fireEvent.click(await screen.findByTestId(`slot-option-${SLOT}`));
    fireEvent.click(screen.getByRole("button", { name: "Vahvista uusi aika" }));

    await waitFor(() => {
      expect(rescheduleBody).toEqual({ newStartAt: SLOT });
    });
  });

  it("on a successful reschedule, shows a distinct success state with the new time instead of refetching the now-cancelled old booking", async () => {
    setUrl(`?token=${TOKEN}`);
    const { fetchMock } = stubFetch({
      reschedule: () =>
        jsonResponse({ id: "booking-2", status: "pending", start_at: SLOT, end_at: SLOT }, 201),
    });

    render(<ManageBooking bookingId={BOOKING_ID} />);
    await screen.findByText("Tila: odottaa vahvistusta");
    const viewCallsBeforeReschedule = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes(`/bookings/${BOOKING_ID}?`),
    ).length;

    fireEvent.click(screen.getByRole("button", { name: "Siirrä aikaa" }));
    fireEvent.click(await screen.findByTestId(`slot-option-${SLOT}`));
    fireEvent.click(screen.getByRole("button", { name: "Vahvista uusi aika" }));

    const success = await screen.findByTestId("reschedule-success");
    expect(success).toHaveTextContent(/vahvistusviestin/i);
    expect(screen.queryByText("Tila: peruttu")).not.toBeInTheDocument();
    expect(screen.queryByText("Tila: odottaa vahvistusta")).not.toBeInTheDocument();

    const viewCallsAfterReschedule = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes(`/bookings/${BOOKING_ID}?`),
    ).length;
    expect(viewCallsAfterReschedule).toBe(viewCallsBeforeReschedule);
  });

  it("does not show a service picker while rescheduling", async () => {
    setUrl(`?token=${TOKEN}`);
    stubFetch();

    render(<ManageBooking bookingId={BOOKING_ID} />);
    await screen.findByText("Tila: odottaa vahvistusta");

    fireEvent.click(screen.getByRole("button", { name: "Siirrä aikaa" }));
    await screen.findByTestId(`slot-option-${SLOT}`);

    expect(screen.queryByText(/valitse palvelu/i)).not.toBeInTheDocument();
  });

  it("on a 409 slot-taken during reschedule, refreshes slots and shows an inline message", async () => {
    setUrl(`?token=${TOKEN}`);
    let rescheduleAttempts = 0;
    let availabilityCalls = 0;
    stubFetch({
      reschedule: () => {
        rescheduleAttempts += 1;
        return jsonResponse({ error: "slot no longer available" }, 409);
      },
      availability: () => {
        availabilityCalls += 1;
        return jsonResponse(availabilityCalls === 1 ? [SLOT, SLOT_2] : [SLOT_2]);
      },
      view: () => jsonResponse(PENDING_VIEW),
    });

    render(<ManageBooking bookingId={BOOKING_ID} />);
    await screen.findByText("Tila: odottaa vahvistusta");

    fireEvent.click(screen.getByRole("button", { name: "Siirrä aikaa" }));
    fireEvent.click(await screen.findByTestId(`slot-option-${SLOT}`));
    const callsBeforeSubmit = availabilityCalls;
    fireEvent.click(screen.getByRole("button", { name: "Vahvista uusi aika" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/varattiin juuri/i);
    await waitFor(() => expect(availabilityCalls).toBeGreaterThan(callsBeforeSubmit));
    expect(rescheduleAttempts).toBe(1);
  });

  it("on a 409 during reschedule where the booking became non-modifiable, shows the read-only state instead of a slot-taken message", async () => {
    setUrl(`?token=${TOKEN}`);
    let viewCallCount = 0;
    stubFetch({
      reschedule: () => jsonResponse({ error: "Booking cannot be modified" }, 409),
      view: () => {
        viewCallCount += 1;
        return jsonResponse(viewCallCount === 1 ? PENDING_VIEW : CANCELLED_VIEW);
      },
    });

    render(<ManageBooking bookingId={BOOKING_ID} />);
    await screen.findByText("Tila: odottaa vahvistusta");

    fireEvent.click(screen.getByRole("button", { name: "Siirrä aikaa" }));
    fireEvent.click(await screen.findByTestId(`slot-option-${SLOT}`));
    fireEvent.click(screen.getByRole("button", { name: "Vahvista uusi aika" }));

    await waitFor(() => expect(screen.getByText("Tila: peruttu")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Siirrä aikaa" })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("never renders booking-derived strings via dangerouslySetInnerHTML", async () => {
    setUrl(`?token=${TOKEN}`);
    stubFetch({
      view: () =>
        jsonResponse({
          ...PENDING_VIEW,
          service_name: "<img src=x onerror=alert(1)>",
        }),
    });

    render(<ManageBooking bookingId={BOOKING_ID} />);

    await screen.findByText(/onerror=alert/);
    expect(document.querySelector("img")).not.toBeInTheDocument();
  });
});
