import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AdminLoginRequest } from "../src/pages/AdminLoginRequest";

const GENERIC_MESSAGE = "If that email is registered, a login link has been sent.";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubFetch(handler: (url: string) => Response) {
  const fetchMock = vi.fn(async (url: string) => handler(url));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AdminLoginRequest", () => {
  it("shows the backend's generic message after a valid submission", async () => {
    stubFetch(() => jsonResponse({ message: GENERIC_MESSAGE }));

    render(<AdminLoginRequest />);
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "masseur@example.com" },
    });
    fireEvent.click(screen.getByTestId("request-login-link"));

    expect(await screen.findByRole("status")).toHaveTextContent(GENERIC_MESSAGE);
  });

  it("rejects an obviously malformed email without making a network call", () => {
    const fetchMock = stubFetch(() => jsonResponse({ message: GENERIC_MESSAGE }));

    render(<AdminLoginRequest />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "not-an-email" } });
    fireEvent.click(screen.getByTestId("request-login-link"));

    expect(screen.getByRole("alert")).toHaveTextContent("valid email");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows a generic failure message on a rate-limit or network error", async () => {
    stubFetch(() => jsonResponse({ error: "Too many requests" }, 429));

    render(<AdminLoginRequest />);
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "masseur@example.com" },
    });
    fireEvent.click(screen.getByTestId("request-login-link"));

    expect(await screen.findByRole("alert")).toHaveTextContent(/went wrong/i);
  });
});
