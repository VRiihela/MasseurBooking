import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AdminServices } from "../src/pages/AdminServices";

const SESSION_TOKEN_STORAGE_KEY = "masseurSessionToken";
const TOKEN = "session-token-abc";

const ACTIVE_SERVICE = {
  id: "svc-1",
  name: "Deep Tissue Massage",
  price: 80,
  duration_minutes: 60,
  buffer_before_minutes: 5,
  buffer_after_minutes: 10,
  active: true,
};

const INACTIVE_SERVICE = {
  id: "svc-2",
  name: "Retired Service",
  price: 50,
  duration_minutes: 30,
  buffer_before_minutes: 0,
  buffer_after_minutes: 0,
  active: false,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface FetchRoutes {
  list?: () => Response;
  create?: (body: unknown) => Response;
  update?: (id: string, body: unknown) => Response;
}

function stubFetch(routes: FetchRoutes = {}) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body: unknown = init?.body ? JSON.parse(init.body as string) : undefined;

    if (url.includes("/admin/services/") && method === "PATCH") {
      const id = url.split("/").pop() as string;
      return routes.update
        ? routes.update(id, body)
        : jsonResponse({ ...ACTIVE_SERVICE, id, ...(body as object) });
    }
    if (url.includes("/admin/services") && method === "POST") {
      return routes.create
        ? routes.create(body)
        : jsonResponse({ id: "new-service", active: true, ...(body as object) }, 201);
    }
    if (url.includes("/admin/services")) {
      return routes.list ? routes.list() : jsonResponse([ACTIVE_SERVICE]);
    }
    throw new Error(`Unhandled fetch call: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function addServiceSection() {
  return within(screen.getByRole("region", { name: "Lisää uusi palvelu" }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("AdminServices", () => {
  it("lists active and inactive services, visually distinguishing inactive ones", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    stubFetch({ list: () => jsonResponse([ACTIVE_SERVICE, INACTIVE_SERVICE]) });

    render(<AdminServices onSessionEnded={() => {}} />);
    await screen.findByTestId("service-svc-1");

    const activeRow = screen.getByTestId("service-svc-1");
    const inactiveRow = screen.getByTestId("service-svc-2");
    expect(activeRow.className).not.toContain("admin-service-inactive");
    expect(inactiveRow).toHaveClass("admin-service-inactive");
    expect(inactiveRow).toHaveTextContent("(ei käytössä)");
    expect(activeRow).not.toHaveTextContent("(ei käytössä)");
  });

  it("creates a new service, coercing string input values to real numbers before sending", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    let createBody: unknown;
    const fetchMock = stubFetch({
      list: () => jsonResponse([]),
      create: (body) => {
        createBody = body;
        return jsonResponse({ id: "new-service", active: true, ...(body as object) }, 201);
      },
    });

    render(<AdminServices onSessionEnded={() => {}} />);
    await screen.findByRole("region", { name: "Lisää uusi palvelu" });

    const form = addServiceSection();
    fireEvent.change(form.getByLabelText("Nimi"), { target: { value: "Hot Stone Massage" } });
    fireEvent.change(form.getByLabelText("Hinta"), { target: { value: "95.50" } });
    fireEvent.change(form.getByLabelText("Hieronnan kesto (minuuttia)"), { target: { value: "90" } });
    fireEvent.change(form.getByLabelText(/Puskuri ennen/), { target: { value: "10" } });
    fireEvent.change(form.getByLabelText(/Puskuri jälkeen/), { target: { value: "15" } });
    fireEvent.click(form.getByRole("button", { name: "Lisää palvelu" }));

    await screen.findByTestId("service-new-service");

    expect(createBody).toEqual({
      name: "Hot Stone Massage",
      price: 95.5,
      duration_minutes: 90,
      buffer_before_minutes: 10,
      buffer_after_minutes: 15,
    });
    // Every numeric field must be an actual number, never the raw string.
    const created = createBody as Record<string, unknown>;
    expect(typeof created.price).toBe("number");
    expect(typeof created.duration_minutes).toBe("number");
    expect(typeof created.buffer_before_minutes).toBe("number");
    expect(typeof created.buffer_after_minutes).toBe("number");

    const postCalls = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit)?.method === "POST");
    expect(postCalls).toHaveLength(1);
  });

  it("rejects an empty name client-side with no request sent", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    const fetchMock = stubFetch({ list: () => jsonResponse([]) });

    render(<AdminServices onSessionEnded={() => {}} />);
    await screen.findByRole("region", { name: "Lisää uusi palvelu" });

    const form = addServiceSection();
    fireEvent.change(form.getByLabelText("Hinta"), { target: { value: "50" } });
    fireEvent.change(form.getByLabelText("Hieronnan kesto (minuuttia)"), { target: { value: "30" } });
    fireEvent.click(form.getByRole("button", { name: "Lisää palvelu" }));

    expect(await form.findByRole("alert")).toHaveTextContent("Nimi on pakollinen.");
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit)?.method === "POST")).toBe(false);
  });

  it("rejects a non-positive price client-side with no request sent", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    const fetchMock = stubFetch({ list: () => jsonResponse([]) });

    render(<AdminServices onSessionEnded={() => {}} />);
    await screen.findByRole("region", { name: "Lisää uusi palvelu" });

    const form = addServiceSection();
    fireEvent.change(form.getByLabelText("Nimi"), { target: { value: "Free Massage" } });
    fireEvent.change(form.getByLabelText("Hinta"), { target: { value: "0" } });
    fireEvent.change(form.getByLabelText("Hieronnan kesto (minuuttia)"), { target: { value: "30" } });
    fireEvent.click(form.getByRole("button", { name: "Lisää palvelu" }));

    expect(await form.findByRole("alert")).toHaveTextContent("Hinnan on oltava positiivinen luku.");
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit)?.method === "POST")).toBe(false);
  });

  it("rejects a non-integer duration client-side with no request sent", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    const fetchMock = stubFetch({ list: () => jsonResponse([]) });

    render(<AdminServices onSessionEnded={() => {}} />);
    await screen.findByRole("region", { name: "Lisää uusi palvelu" });

    const form = addServiceSection();
    fireEvent.change(form.getByLabelText("Nimi"), { target: { value: "Half-Minute Massage" } });
    fireEvent.change(form.getByLabelText("Hinta"), { target: { value: "50" } });
    fireEvent.change(form.getByLabelText("Hieronnan kesto (minuuttia)"), { target: { value: "30.5" } });
    fireEvent.click(form.getByRole("button", { name: "Lisää palvelu" }));

    expect(await form.findByRole("alert")).toHaveTextContent(
      "Hieronnan keston on oltava positiivinen kokonaisluku minuutteina.",
    );
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit)?.method === "POST")).toBe(false);
  });

  it("rejects a negative buffer client-side with no request sent", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    const fetchMock = stubFetch({ list: () => jsonResponse([]) });

    render(<AdminServices onSessionEnded={() => {}} />);
    await screen.findByRole("region", { name: "Lisää uusi palvelu" });

    const form = addServiceSection();
    fireEvent.change(form.getByLabelText("Nimi"), { target: { value: "Rushed Massage" } });
    fireEvent.change(form.getByLabelText("Hinta"), { target: { value: "50" } });
    fireEvent.change(form.getByLabelText("Hieronnan kesto (minuuttia)"), { target: { value: "30" } });
    fireEvent.change(form.getByLabelText(/Puskuri ennen/), { target: { value: "-5" } });
    fireEvent.click(form.getByRole("button", { name: "Lisää palvelu" }));

    expect(await form.findByRole("alert")).toHaveTextContent(
      "Puskurin ennen on oltava nolla tai positiivinen kokonaisluku minuutteina.",
    );
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit)?.method === "POST")).toBe(false);
  });

  it("surfaces a backend rejection on create as readable text, not a generic failure", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    stubFetch({
      list: () => jsonResponse([]),
      create: () => jsonResponse({ error: "price must be a positive number" }, 400),
    });

    render(<AdminServices onSessionEnded={() => {}} />);
    await screen.findByRole("region", { name: "Lisää uusi palvelu" });

    const form = addServiceSection();
    fireEvent.change(form.getByLabelText("Nimi"), { target: { value: "Hot Stone Massage" } });
    fireEvent.change(form.getByLabelText("Hinta"), { target: { value: "50" } });
    fireEvent.change(form.getByLabelText("Hieronnan kesto (minuuttia)"), { target: { value: "60" } });
    fireEvent.click(form.getByRole("button", { name: "Lisää palvelu" }));

    expect(await form.findByRole("alert")).toHaveTextContent("price must be a positive number");
  });

  it("edits an existing service: pre-fills the form and PATCHes all fields as numbers", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    let updateBody: unknown;
    const fetchMock = stubFetch({
      list: () => jsonResponse([ACTIVE_SERVICE]),
      update: (id, body) => {
        updateBody = body;
        return jsonResponse({ ...ACTIVE_SERVICE, id, ...(body as object) });
      },
    });

    render(<AdminServices onSessionEnded={() => {}} />);
    const row = await screen.findByTestId("service-svc-1");

    fireEvent.click(within(row).getByRole("button", { name: "Muokkaa" }));

    expect(within(row).getByLabelText("Nimi")).toHaveValue("Deep Tissue Massage");
    expect(within(row).getByLabelText("Hinta")).toHaveValue(80);
    expect(within(row).getByLabelText("Hieronnan kesto (minuuttia)")).toHaveValue(60);

    fireEvent.change(within(row).getByLabelText("Hinta"), { target: { value: "100" } });
    fireEvent.click(within(row).getByRole("button", { name: "Tallenna" }));

    await waitFor(() => {
      expect(within(screen.getByTestId("service-svc-1"))).toBeTruthy();
    });
    expect(updateBody).toEqual({
      name: "Deep Tissue Massage",
      price: 100,
      duration_minutes: 60,
      buffer_before_minutes: 5,
      buffer_after_minutes: 10,
    });
    const patchCalls = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit)?.method === "PATCH");
    expect(patchCalls).toHaveLength(1);
    expect(screen.getByTestId("service-svc-1")).toHaveTextContent("Hinta: 100");
  });

  it("cancels an edit without sending a request, leaving the original values", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    const fetchMock = stubFetch({ list: () => jsonResponse([ACTIVE_SERVICE]) });

    render(<AdminServices onSessionEnded={() => {}} />);
    const row = await screen.findByTestId("service-svc-1");

    fireEvent.click(within(row).getByRole("button", { name: "Muokkaa" }));
    fireEvent.change(within(row).getByLabelText("Hinta"), { target: { value: "999" } });
    fireEvent.click(within(row).getByRole("button", { name: "Peruuta" }));

    expect(screen.getByTestId("service-svc-1")).toHaveTextContent("Hinta: 80");
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit)?.method === "PATCH")).toBe(false);
  });

  it("surfaces a backend rejection on edit as readable text, keeping the row in edit mode", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    stubFetch({
      list: () => jsonResponse([ACTIVE_SERVICE]),
      update: () => jsonResponse({ error: "duration_minutes must be a positive integer" }, 400),
    });

    render(<AdminServices onSessionEnded={() => {}} />);
    const row = await screen.findByTestId("service-svc-1");

    fireEvent.click(within(row).getByRole("button", { name: "Muokkaa" }));
    fireEvent.click(within(row).getByRole("button", { name: "Tallenna" }));

    expect(await within(row).findByRole("alert")).toHaveTextContent(
      "duration_minutes must be a positive integer",
    );
    expect(within(row).getByRole("button", { name: "Tallenna" })).not.toBeNull();
  });

  it("deactivates an active service immediately on a single tap", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    let updateBody: unknown;
    stubFetch({
      list: () => jsonResponse([ACTIVE_SERVICE]),
      update: (id, body) => {
        updateBody = body;
        return jsonResponse({ ...ACTIVE_SERVICE, id, ...(body as object) });
      },
    });

    render(<AdminServices onSessionEnded={() => {}} />);
    const row = await screen.findByTestId("service-svc-1");

    fireEvent.click(within(row).getByRole("button", { name: "Poista käytöstä" }));

    await waitFor(() => {
      expect(screen.getByTestId("service-svc-1")).toHaveClass("admin-service-inactive");
    });
    expect(updateBody).toEqual({ active: false });
    expect(within(screen.getByTestId("service-svc-1")).getByRole("button", { name: "Aktivoi" })).not.toBeNull();
  });

  it("reactivates an inactive service immediately on a single tap", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    let updateBody: unknown;
    stubFetch({
      list: () => jsonResponse([INACTIVE_SERVICE]),
      update: (id, body) => {
        updateBody = body;
        return jsonResponse({ ...INACTIVE_SERVICE, id, ...(body as object) });
      },
    });

    render(<AdminServices onSessionEnded={() => {}} />);
    const row = await screen.findByTestId("service-svc-2");
    expect(row).toHaveClass("admin-service-inactive");

    fireEvent.click(within(row).getByRole("button", { name: "Aktivoi" }));

    await waitFor(() => {
      expect(screen.getByTestId("service-svc-2")).not.toHaveClass("admin-service-inactive");
    });
    expect(updateBody).toEqual({ active: true });
    expect(screen.getByTestId("service-svc-2")).not.toHaveTextContent("(ei käytössä)");
    expect(within(screen.getByTestId("service-svc-2")).getByRole("button", { name: "Poista käytöstä" })).not.toBeNull();
  });

  it("surfaces a failed activate/deactivate as readable text", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    stubFetch({
      list: () => jsonResponse([ACTIVE_SERVICE]),
      update: () => jsonResponse({ error: "Service not found" }, 404),
    });

    render(<AdminServices onSessionEnded={() => {}} />);
    const row = await screen.findByTestId("service-svc-1");

    fireEvent.click(within(row).getByRole("button", { name: "Poista käytöstä" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Service not found");
    expect(screen.getByTestId("service-svc-1")).not.toHaveClass("admin-service-inactive");
  });

  it("clears the session and reports it ended on a 401 from the initial load", async () => {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, TOKEN);
    stubFetch({ list: () => jsonResponse({ error: "Unauthorized" }, 401) });
    const onSessionEnded = vi.fn();

    render(<AdminServices onSessionEnded={onSessionEnded} />);

    await waitFor(() => {
      expect(onSessionEnded).toHaveBeenCalled();
    });
    expect(localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)).toBeNull();
  });
});
