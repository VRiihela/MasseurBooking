import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { BookingWidget } from "../src/pages/BookingWidget";

const SERVICE = { id: "svc-1", name: "Deep Tissue Massage", price: 90, duration_minutes: 60 };
const SLOT = "2026-08-10T09:00:00.000Z";
const SLOT_2 = "2026-08-10T10:00:00.000Z";
const DATE_A = "2026-08-11";
const DATE_B = "2026-08-12";
const SLOT_A = "2026-08-11T09:00:00.000Z";
const SLOT_B = "2026-08-12T09:00:00.000Z";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface FetchRoutes {
  bookings?: (body: unknown) => Response;
  availability?: (date: string) => Response | Promise<Response>;
}

function stubFetch(routes: FetchRoutes = {}) {
  let availabilityCalls = 0;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/services")) {
      return jsonResponse([SERVICE]);
    }
    if (url.includes("/availability")) {
      availabilityCalls += 1;
      if (routes.availability) {
        return routes.availability(new URL(url, "http://localhost").searchParams.get("date") ?? "");
      }
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

function changeDate(date: string) {
  fireEvent.change(screen.getByLabelText("Päivämäärä"), { target: { value: date } });
}

// Lets a resolved fetch work through response parsing and React state updates,
// for asserting that something did NOT change afterwards.
async function flushResponses() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

function fillCustomerForm({ email = "jane@example.com" }: { email?: string } = {}) {
  fireEvent.change(screen.getByLabelText("Nimi"), { target: { value: "Jane Doe" } });
  fireEvent.change(screen.getByLabelText("Sähköposti"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Puhelin"), { target: { value: "555-0100" } });
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
    // "odottaa" (awaiting) signals pending, not final; the message must
    // explicitly say the booking is NOT yet confirmed ("ei ole vielä
    // vahvistettu"), not just avoid the word "vahvistettu" outright -- Finnish
    // has no separate word for "confirmation" (the process) vs "confirmed"
    // (the status) the way the original English test's wording relied on.
    expect(confirmation.textContent).toMatch(/odottaa/i);
    expect(confirmation.textContent).toContain("ei ole vielä vahvistettu");
    expect(confirmation.textContent).not.toMatch(/varauksesi on vahvistettu/i);
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

    expect(await screen.findByRole("alert")).toHaveTextContent(/varattiin juuri/i);
    await waitFor(() => expect(getAvailabilityCalls()).toBeGreaterThan(callsBeforeSubmit));
  });

  it("blocks submit on an invalid email without calling the API", async () => {
    const { fetchMock } = stubFetch();
    render(<BookingWidget />);

    await selectServiceAndSlot();
    fillCustomerForm({ email: "not-an-email" });
    fireEvent.click(screen.getByTestId("submit-booking"));

    expect(await screen.findByRole("alert")).toHaveTextContent(/kelvollinen sähköpostiosoite/i);
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
    expect(screen.getByLabelText("Päivämäärä")).toHaveAttribute("min", expected);
  });
  it("links to the privacy notice in a new tab from the customer details form", async () => {
    stubFetch();
    render(<BookingWidget />);

    await selectServiceAndSlot();

    const link = screen.getByRole("link", { name: "Lue tietosuojaseloste" });
    expect(link).toHaveAttribute("href", "/tietosuoja");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("does not show the privacy link before the customer details step", async () => {
    stubFetch();
    render(<BookingWidget />);

    await screen.findByTestId(`service-option-${SERVICE.id}`);

    expect(screen.queryByRole("link", { name: "Lue tietosuojaseloste" })).not.toBeInTheDocument();
  });

  it("shows time-only tiles in a labelled group", async () => {
    stubFetch();
    render(<BookingWidget />);
    fireEvent.click(await screen.findByTestId(`service-option-${SERVICE.id}`));

    const tile = await screen.findByTestId(`slot-option-${SLOT}`);
    expect(tile.textContent).toBe("12.00");
    expect(tile.tagName).toBe("BUTTON");
    expect(within(screen.getByRole("group", { name: "Vapaat ajat" })).getAllByRole("button")).toHaveLength(2);
  });

  it("shows the service and the selected date with weekday and year in the header", async () => {
    stubFetch();
    render(<BookingWidget />);
    fireEvent.click(await screen.findByTestId(`service-option-${SERVICE.id}`));
    await screen.findByTestId(`slot-option-${SLOT}`);

    changeDate("2026-08-10");

    expect(screen.getByText("ma 10.8.2026")).toBeInTheDocument();
    expect(screen.getByText(SERVICE.name)).toBeInTheDocument();
  });

  it("goes straight to the details form on tapping a slot, with no extra step", async () => {
    stubFetch();
    render(<BookingWidget />);

    await selectServiceAndSlot();

    expect(screen.getByLabelText("Nimi")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /jatka/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId(`slot-option-${SLOT}`)).not.toBeInTheDocument();
  });

  it("shows the selected tile as selected after going back from the form", async () => {
    stubFetch();
    render(<BookingWidget />);

    await selectServiceAndSlot();
    fireEvent.click(screen.getByRole("button", { name: /Takaisin/ }));

    const selected = screen.getByTestId(`slot-option-${SLOT}`);
    expect(selected).toHaveAttribute("aria-pressed", "true");
    expect(selected).toHaveTextContent("✓ Valittu");
    const other = screen.getByTestId(`slot-option-${SLOT_2}`);
    expect(other).toHaveAttribute("aria-pressed", "false");
    expect(other).not.toHaveTextContent("Valittu");
  });

  it("clears the selection when the date changes", async () => {
    stubFetch();
    render(<BookingWidget />);

    await selectServiceAndSlot();
    fireEvent.click(screen.getByRole("button", { name: /Takaisin/ }));
    changeDate(DATE_A);

    const tile = await screen.findByTestId(`slot-option-${SLOT}`);
    expect(tile).toHaveAttribute("aria-pressed", "false");
    expect(tile).not.toHaveTextContent("Valittu");
  });

  it("does not crash when the date input is cleared", async () => {
    stubFetch({
      availability: (date) =>
        date === "" ? jsonResponse({ error: "invalid date" }, 400) : jsonResponse([SLOT]),
    });
    render(<BookingWidget />);
    fireEvent.click(await screen.findByTestId(`service-option-${SERVICE.id}`));
    await screen.findByTestId(`slot-option-${SLOT}`);

    changeDate("");

    expect(await screen.findByRole("alert")).toHaveTextContent(/Vapaita aikoja ei voitu ladata/);
    expect(screen.getByText(SERVICE.name)).toBeInTheDocument();
  });

  it("hides the previous date's tiles and keeps the loading text while new slots load", async () => {
    stubFetch({
      availability: (date) =>
        date === DATE_A ? new Promise<Response>(() => undefined) : jsonResponse([SLOT]),
    });
    render(<BookingWidget />);
    fireEvent.click(await screen.findByTestId(`service-option-${SERVICE.id}`));
    await screen.findByTestId(`slot-option-${SLOT}`);

    changeDate(DATE_A);

    expect(screen.queryByTestId(`slot-option-${SLOT}`)).not.toBeInTheDocument();
    expect(screen.getByText(/Ladataan vapaita aikoja/)).toBeInTheDocument();
  });

  it("hides the previous date's tiles when fetching the new date fails", async () => {
    stubFetch({
      availability: (date) =>
        date === DATE_A ? jsonResponse({ error: "boom" }, 500) : jsonResponse([SLOT]),
    });
    render(<BookingWidget />);
    fireEvent.click(await screen.findByTestId(`service-option-${SERVICE.id}`));
    await screen.findByTestId(`slot-option-${SLOT}`);

    changeDate(DATE_A);

    expect(await screen.findByRole("alert")).toHaveTextContent(/Vapaita aikoja ei voitu ladata/);
    expect(screen.queryByTestId(`slot-option-${SLOT}`)).not.toBeInTheDocument();
  });

  it("shows the empty message and no grid when a date has no slots", async () => {
    stubFetch({ availability: () => jsonResponse([]) });
    render(<BookingWidget />);
    fireEvent.click(await screen.findByTestId(`service-option-${SERVICE.id}`));

    expect(await screen.findByText("Ei vapaita aikoja tälle päivälle.")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Vapaat ajat" })).not.toBeInTheDocument();
  });

  describe("with out-of-order availability responses", () => {
    function stubDeferredDates() {
      const respond = new Map<string, (response: Response) => void>();
      stubFetch({
        availability: (date) =>
          date === DATE_A || date === DATE_B
            ? new Promise<Response>((resolve) => respond.set(date, resolve))
            : jsonResponse([]),
      });
      return respond;
    }

    async function requestBothDates() {
      render(<BookingWidget />);
      fireEvent.click(await screen.findByTestId(`service-option-${SERVICE.id}`));
      await screen.findByText("Ei vapaita aikoja tälle päivälle.");
      changeDate(DATE_A);
      changeDate(DATE_B);
      await waitFor(() => expect(screen.getByText("ke 12.8.2026")).toBeInTheDocument());
    }

    it("ignores a late response for an earlier date", async () => {
      const respond = stubDeferredDates();
      await requestBothDates();

      respond.get(DATE_B)?.(jsonResponse([SLOT_B]));
      await screen.findByTestId(`slot-option-${SLOT_B}`);
      respond.get(DATE_A)?.(jsonResponse([SLOT_A]));
      await flushResponses();

      expect(screen.getByTestId(`slot-option-${SLOT_B}`)).toBeInTheDocument();
      expect(screen.queryByTestId(`slot-option-${SLOT_A}`)).not.toBeInTheDocument();
    });

    it("keeps loading when an earlier request finishes before the latest one", async () => {
      const respond = stubDeferredDates();
      await requestBothDates();

      respond.get(DATE_A)?.(jsonResponse([SLOT_A]));
      await flushResponses();

      expect(screen.getByText(/Ladataan vapaita aikoja/)).toBeInTheDocument();
      expect(screen.queryByTestId(`slot-option-${SLOT_A}`)).not.toBeInTheDocument();
    });

    it("ignores a late failure for an earlier date", async () => {
      const respond = stubDeferredDates();
      await requestBothDates();

      respond.get(DATE_B)?.(jsonResponse([SLOT_B]));
      await screen.findByTestId(`slot-option-${SLOT_B}`);
      respond.get(DATE_A)?.(jsonResponse({ error: "boom" }, 500));
      await flushResponses();

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.getByTestId(`slot-option-${SLOT_B}`)).toBeInTheDocument();
    });
  });
});
