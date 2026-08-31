import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BookingWidget } from "../src/pages/BookingWidget";

const SERVICE = { id: "svc-1", name: "Deep Tissue Massage", price: 90, duration_minutes: 60 };
const SLOT = "2026-08-10T09:00:00.000Z";
const SLOT_2 = "2026-08-10T10:00:00.000Z";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface FetchRoutes {
  bookings?: (body: unknown) => Response;
}

function stubFetch(routes: FetchRoutes = {}) {
  let availabilityCalls = 0;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/services")) {
      return jsonResponse([SERVICE]);
    }
    if (url.includes("/availability")) {
      availabilityCalls += 1;
      return jsonResponse([SLOT, SLOT_2]);
    }
    if (url.includes("/bookings")) {
      const body: unknown = init?.body ? JSON.parse(init.body as string) : undefined;
      if (routes.bookings) {
        return routes.bookings(body);
      }
      return jsonResponse(
        { id: "booking-1", status: "pending", start_at: SLOT, end_at: SLOT },
        201,
      );
    }
    throw new Error(`Unhandled fetch call: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, getAvailabilityCalls: () => availabilityCalls };
}

async function selectServiceAndSlot(slot = SLOT) {
  fireEvent.click(await screen.findByTestId(`service-option-${SERVICE.id}`));
  fireEvent.click(await screen.findByTestId(`slot-option-${slot}`));
}

function fillCustomerForm({ email = "jane@example.com" }: { email?: string } = {}) {
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Jane Doe" } });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "555-0100" } });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("BookingWidget", () => {
  it("lists active services from GET /services", async () => {
    stubFetch();
    render(<BookingWidget />);

    expect(await screen.findByTestId(`service-option-${SERVICE.id}`)).toHaveTextContent(
      SERVICE.name,
    );
  });

  it("fetches and shows slots for the selected service and date", async () => {
    stubFetch();
    render(<BookingWidget />);

    fireEvent.click(await screen.findByTestId(`service-option-${SERVICE.id}`));

    expect(await screen.findByTestId(`slot-option-${SLOT}`)).toBeInTheDocument();
  });

  it("submits the exact UTC start_at string received from /availability, unmodified", async () => {
    const { fetchMock } = stubFetch();
    render(<BookingWidget />);

    await selectServiceAndSlot();
    fillCustomerForm();
    fireEvent.click(screen.getByTestId("submit-booking"));

    await waitFor(() => {
      const bookingCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/bookings"));
      expect(bookingCall).toBeDefined();
      const body = JSON.parse((bookingCall?.[1] as RequestInit).body as string) as {
        start_at: string;
      };
      expect(body.start_at).toBe(SLOT);
    });
  });

  it("shows a pending-confirmation message, not a final booked message, on success", async () => {
    stubFetch();
    render(<BookingWidget />);

    await selectServiceAndSlot();
    fillCustomerForm();
    fireEvent.click(screen.getByTestId("submit-booking"));

    const confirmation = await screen.findByTestId("confirmation-pending");
    expect(confirmation.textContent).toMatch(/awaiting/i);
    expect(confirmation.textContent).not.toMatch(/you.?re booked/i);
    expect(confirmation.textContent?.toLowerCase()).not.toContain("confirmed");
  });

  it("disables the submit button while the request is in flight", async () => {
    let resolveBooking: (value: Response) => void = () => {};
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/services")) return jsonResponse([SERVICE]);
      if (url.includes("/availability")) return jsonResponse([SLOT]);
      if (url.includes("/bookings")) {
        return new Promise<Response>((resolve) => {
          resolveBooking = resolve;
        });
      }
      throw new Error(`Unhandled fetch call: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<BookingWidget />);
    await selectServiceAndSlot();
    fillCustomerForm();

    const submitButton = screen.getByTestId("submit-booking");
    fireEvent.click(submitButton);

    expect(submitButton).toBeDisabled();

    resolveBooking(
      jsonResponse({ id: "booking-1", status: "pending", start_at: SLOT, end_at: SLOT }, 201),
    );
    await screen.findByTestId("confirmation-pending");
  });

  it("on 409, shows a specific message and re-fetches availability instead of a generic error", async () => {
    const { getAvailabilityCalls } = stubFetch({
      bookings: () => jsonResponse({ error: "slot no longer available" }, 409),
    });
    render(<BookingWidget />);

    await selectServiceAndSlot();
    fillCustomerForm();
    const callsBeforeSubmit = getAvailabilityCalls();
    fireEvent.click(screen.getByTestId("submit-booking"));

    expect(await screen.findByRole("alert")).toHaveTextContent(/just taken/i);
    await waitFor(() => expect(getAvailabilityCalls()).toBeGreaterThan(callsBeforeSubmit));
  });

  it("blocks submit on an invalid email without calling the API", async () => {
    const { fetchMock } = stubFetch();
    render(<BookingWidget />);

    await selectServiceAndSlot();
    fillCustomerForm({ email: "not-an-email" });
    fireEvent.click(screen.getByTestId("submit-booking"));

    expect(await screen.findByRole("alert")).toHaveTextContent(/valid email/i);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/bookings"))).toBe(false);
  });

  it("sets min on the date input to today, as defense-in-depth against past dates", async () => {
    stubFetch();
    render(<BookingWidget />);

    fireEvent.click(await screen.findByTestId(`service-option-${SERVICE.id}`));
    await screen.findByTestId(`slot-option-${SLOT}`);

    const today = new Date();
    const expected = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
      today.getDate(),
    ).padStart(2, "0")}`;
    expect(screen.getByLabelText("Date")).toHaveAttribute("min", expected);
  });
});
