import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AdminLoginCallback } from "../src/pages/AdminLoginCallback";

const SESSION_TOKEN_STORAGE_KEY = "masseurSessionToken";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function setSearch(search: string) {
  window.history.pushState(null, "", `/auth/login${search}`);
}

const originalLocation = window.location;

function stubLocationAssign() {
  const assignSpy = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...originalLocation, assign: assignSpy },
  });
  return assignSpy;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
  localStorage.clear();
  window.history.pushState(null, "", "/auth/login");
});

describe("AdminLoginCallback", () => {
  it("exchanges a valid token, stores the session, and navigates to /admin", async () => {
    setSearch("?token=raw-token-123");
    const fetchMock = vi.fn(async (_url: string) => jsonResponse({ token: "session-abc" }));
    vi.stubGlobal("fetch", fetchMock);
    const assignSpy = stubLocationAssign();

    render(<AdminLoginCallback />);

    await vi.waitFor(() => {
      expect(assignSpy).toHaveBeenCalledWith("/admin");
    });
    expect(localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)).toBe("session-abc");
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain("/auth/login?token=raw-token-123");
  });

  it("shows an error and a link back to /admin when the token query param is missing", async () => {
    setSearch("");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ message: "unused" })),
    );

    render(<AdminLoginCallback />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/puuttuu/i);
    expect(screen.getByRole("link", { name: /pyydä uusi kirjautumislinkki/i })).toHaveAttribute(
      "href",
      "/admin",
    );
  });

  it("shows the backend's error and a link back to /admin when the token is invalid/expired", async () => {
    setSearch("?token=already-used");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "Kirjautumislinkki ei ole enää voimassa." }, 401)),
    );

    render(<AdminLoginCallback />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Kirjautumislinkki ei ole enää voimassa.");
    expect(screen.getByRole("link", { name: /pyydä uusi kirjautumislinkki/i })).toHaveAttribute(
      "href",
      "/admin",
    );
    expect(localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)).toBeNull();
  });
});
