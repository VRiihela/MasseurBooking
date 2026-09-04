import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AdminAvailability } from "../src/pages/AdminAvailability";

const SESSION_TOKEN_STORAGE_KEY = "masseurSessionToken";
const TOKEN = "session-token-abc";

const MONDAY_MORNING = {
  id: "rule-1",
  weekday: 1,
  start_time: "09:00:00",
  end_time: "12:00:00",
};

const MONDAY_AFTERNOON = {
  id: "rule-2",
  weekday: 1,
  start_time: "14:00:00",
  end_time: "18:00:00",
};

const TUESDAY = {
  id: "rule-3",
  weekday: 2,
  start_time: "10:00:00",
  end_time: "19:00:00",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface FetchRoutes {
  rules?: () => Response;
  create?: (body: unknown) => Response;
  delete?: (id: string) => Response;
}

function stubFetch(routes: FetchRoutes = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const method = init?.method ?? "GET";

    if (url.includes("/admin/availability-rules") && method === "DELETE") {
      const id = url.split("/").pop() as string;
      return routes.delete ? routes.delete(id) : jsonResponse({ id, deleted: true });
    }
    if (url.includes("/admin/availability-rules") && method === "POST") {
      const body: unknown = init?.body ? JSON.parse(init.body as string) : undefined;
      return routes.create
        ? routes.create(body)
        : jsonResponse({ id: "new-rule", ...(body as object) }, 201);
    }
    if (url.includes("/admin/availability-rules")) {
      return routes.rules ? routes.rules() : jsonResponse([]);
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

describe("AdminAvailability", () => {
  it("shows all 7 weekdays, Monday first", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    stubFetch({ rules: () => jsonResponse([]) });

    render(<AdminAvailability onSessionEnded={() => {}} />);
    await screen.findByTestId("weekday-1");

    const headings = screen.getAllByRole("heading", { level: 2 }).map((el) => el.textContent);
    expect(headings).toEqual([
      "Maanantai",
      "Tiistai",
      "Keskiviikko",
      "Torstai",
      "Perjantai",
      "Lauantai",
      "Sunnuntai",
    ]);
  });

  it("groups existing rules under the correct weekday and shows multiple ranges per day", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    stubFetch({ rules: () => jsonResponse([MONDAY_MORNING, MONDAY_AFTERNOON, TUESDAY]) });

    render(<AdminAvailability onSessionEnded={() => {}} />);
    await screen.findByTestId("weekday-1");

    const monday = within(screen.getByTestId("weekday-1"));
    expect(monday.getByTestId("rule-rule-1")).toHaveTextContent("09:00–12:00");
    expect(monday.getByTestId("rule-rule-2")).toHaveTextContent("14:00–18:00");

    const tuesday = within(screen.getByTestId("weekday-2"));
    expect(tuesday.getByTestId("rule-rule-3")).toHaveTextContent("10:00–19:00");

    const wednesday = within(screen.getByTestId("weekday-3"));
    expect(wednesday.getByText("Ei asetettuja aikoja")).not.toBeNull();
  });

  it("adds a new time range, appending ':00' for the backend's strict HH:MM:SS format", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    let createBody: unknown;
    stubFetch({
      rules: () => jsonResponse([]),
      create: (body) => {
        createBody = body;
        return jsonResponse(
          { id: "new-rule", weekday: 1, start_time: "09:00:00", end_time: "17:00:00" },
          201,
        );
      },
    });

    render(<AdminAvailability onSessionEnded={() => {}} />);
    await screen.findByTestId("weekday-1");

    const monday = within(screen.getByTestId("weekday-1"));
    fireEvent.change(monday.getByLabelText("Alkamisaika"), { target: { value: "09:00" } });
    fireEvent.change(monday.getByLabelText("Päättymisaika"), { target: { value: "17:00" } });
    fireEvent.click(monday.getByRole("button", { name: "Lisää aikaväli" }));

    await waitFor(() => {
      expect(monday.getByTestId("rule-new-rule")).toHaveTextContent("09:00–17:00");
    });
    expect(createBody).toEqual({ weekday: 1, start_time: "09:00:00", end_time: "17:00:00" });
  });

  it("rejects end time <= start time client-side with an inline error, sending no request", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    const { fetchMock } = stubFetch({ rules: () => jsonResponse([]) });

    render(<AdminAvailability onSessionEnded={() => {}} />);
    await screen.findByTestId("weekday-1");

    const monday = within(screen.getByTestId("weekday-1"));
    fireEvent.change(monday.getByLabelText("Alkamisaika"), { target: { value: "17:00" } });
    fireEvent.change(monday.getByLabelText("Päättymisaika"), { target: { value: "09:00" } });
    fireEvent.click(monday.getByRole("button", { name: "Lisää aikaväli" }));

    expect(await monday.findByRole("alert")).toHaveTextContent("Päättymisajan on oltava alkamisajan jälkeen.");
    expect(fetchMock.mock.calls.some(([url, init]) => (init as RequestInit)?.method === "POST")).toBe(
      false,
    );
  });

  it("surfaces a backend validation error as readable text, not a generic failure", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    stubFetch({
      rules: () => jsonResponse([]),
      create: () => jsonResponse({ error: "end_time must be after start_time" }, 400),
    });

    render(<AdminAvailability onSessionEnded={() => {}} />);
    await screen.findByTestId("weekday-1");

    const monday = within(screen.getByTestId("weekday-1"));
    fireEvent.change(monday.getByLabelText("Alkamisaika"), { target: { value: "09:00" } });
    fireEvent.change(monday.getByLabelText("Päättymisaika"), { target: { value: "17:00" } });
    fireEvent.click(monday.getByRole("button", { name: "Lisää aikaväli" }));

    expect(await monday.findByRole("alert")).toHaveTextContent("end_time must be after start_time");
  });

  it("deletes a time range, removing the row without a full refetch", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    const { fetchMock } = stubFetch({ rules: () => jsonResponse([MONDAY_MORNING]) });

    render(<AdminAvailability onSessionEnded={() => {}} />);
    await screen.findByTestId("rule-rule-1");

    fireEvent.click(screen.getByRole("button", { name: "Poista" }));

    await waitFor(() => {
      expect(screen.queryByTestId("rule-rule-1")).toBeNull();
    });
    const rulesGetCalls = fetchMock.mock.calls.filter(
      ([url, init]) =>
        (url as string).includes("/admin/availability-rules") &&
        ((init as RequestInit | undefined)?.method ?? "GET") === "GET",
    );
    expect(rulesGetCalls).toHaveLength(1);
  });

  it("surfaces a failed delete as readable text instead of silently failing", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    stubFetch({
      rules: () => jsonResponse([MONDAY_MORNING]),
      delete: () => jsonResponse({ error: "Availability rule not found" }, 404),
    });

    render(<AdminAvailability onSessionEnded={() => {}} />);
    await screen.findByTestId("rule-rule-1");

    fireEvent.click(screen.getByRole("button", { name: "Poista" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Availability rule not found");
    // The row stays -- the delete didn't actually succeed.
    expect(screen.getByTestId("rule-rule-1")).not.toBeNull();
  });

  it("clears the session and reports it ended on a 401 from the initial load", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    stubFetch({ rules: () => jsonResponse({ error: "Unauthorized" }, 401) });
    const onSessionEnded = vi.fn();

    render(<AdminAvailability onSessionEnded={onSessionEnded} />);

    await waitFor(() => {
      expect(onSessionEnded).toHaveBeenCalled();
    });
    expect(localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)).toBeNull();
  });
});
