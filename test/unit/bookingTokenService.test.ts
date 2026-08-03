import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashToken, mintCustomerToken } from "../../src/services/bookingTokenService.js";

const queryMock = vi.fn();
const client = { query: queryMock } as unknown as Parameters<typeof mintCustomerToken>[0];

beforeEach(() => {
  queryMock.mockReset();
});

describe("hashToken", () => {
  it("is deterministic for the same input", () => {
    expect(hashToken("raw-token")).toBe(hashToken("raw-token"));
  });

  it("produces a 64-character hex digest", () => {
    expect(hashToken("raw-token")).toMatch(/^[a-f0-9]{64}$/);
  });

  it("produces different hashes for different inputs", () => {
    expect(hashToken("token-a")).not.toBe(hashToken("token-b"));
  });
});

describe("mintCustomerToken", () => {
  it("stores only the hash, in the caller's transaction, and returns the raw token", async () => {
    queryMock.mockResolvedValueOnce(undefined);

    const rawToken = await mintCustomerToken(client, "booking-1");

    expect(rawToken).toMatch(/^[a-f0-9]{64}$/);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO customer_booking_tokens/);
    expect(params[0]).toBe("booking-1");
    expect(params[1]).toBe(hashToken(rawToken));
    expect(params[1]).not.toBe(rawToken);
  });

  it("mints a distinct token on every call, even for the same booking", async () => {
    queryMock.mockResolvedValue(undefined);

    const first = await mintCustomerToken(client, "booking-1");
    const second = await mintCustomerToken(client, "booking-1");

    expect(first).not.toBe(second);
  });
});
