import { afterEach, describe, expect, it, vi } from "vitest";
import { ResendEmailSender } from "../../src/services/emailSender.js";

const API_KEY = "re_secret_test_key";
const FROM_ADDRESS = "bookings@example.com";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ResendEmailSender", () => {
  it("POSTs to Resend's send endpoint with the expected auth header and body shape", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: "email-1" }));
    vi.stubGlobal("fetch", fetchMock);

    const sender = new ResendEmailSender(API_KEY, FROM_ADDRESS);
    await sender.send({
      to: "jane@example.com",
      subject: "Your booking is confirmed",
      body: "See you Monday at 9am.",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    });
    expect(JSON.parse(init.body as string)).toEqual({
      from: FROM_ADDRESS,
      to: "jane@example.com",
      subject: "Your booking is confirmed",
      text: "See you Monday at 9am.",
    });
  });

  it("on a non-ok response, throws an Error with the status and response body, never the API key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("invalid `to` field", { status: 422 })),
    );

    const sender = new ResendEmailSender(API_KEY, FROM_ADDRESS);

    await expect(
      sender.send({ to: "not-an-email", subject: "Subject", body: "Body" }),
    ).rejects.toThrow(/422/);
    await expect(
      sender.send({ to: "not-an-email", subject: "Subject", body: "Body" }),
    ).rejects.toThrow(/invalid `to` field/);
    await expect(
      sender.send({ to: "not-an-email", subject: "Subject", body: "Body" }),
    ).rejects.not.toThrow(new RegExp(API_KEY));
  });

  it("still throws a clean error if reading the failure response body itself fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        text: () => Promise.reject(new Error("stream already consumed")),
      })),
    );

    const sender = new ResendEmailSender(API_KEY, FROM_ADDRESS);

    await expect(
      sender.send({ to: "jane@example.com", subject: "Subject", body: "Body" }),
    ).rejects.toThrow(/500/);
  });
});
