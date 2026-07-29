import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

process.env.MASSEUR_ADMIN_TOKEN = "test-admin-token";

const { requireMasseurAuth } = await import("../../src/middleware/requireMasseurAuth.js");
const { UnauthorizedError } = await import("../../src/errors.js");

function makeRequest(authorization?: string): Request {
  return {
    header: (name: string) => (name.toLowerCase() === "authorization" ? authorization : undefined),
  } as unknown as Request;
}

describe("requireMasseurAuth", () => {
  let next: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    next = vi.fn();
  });

  it("calls next() with no error when the bearer token matches", () => {
    requireMasseurAuth(makeRequest("Bearer test-admin-token"), {} as Response, next);
    expect(next).toHaveBeenCalledWith();
  });

  it("rejects a missing Authorization header", () => {
    requireMasseurAuth(makeRequest(undefined), {} as Response, next);
    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
  });

  it("rejects a non-Bearer Authorization header", () => {
    requireMasseurAuth(makeRequest("Basic dGVzdA=="), {} as Response, next);
    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
  });

  it("rejects a wrong bearer token", () => {
    requireMasseurAuth(makeRequest("Bearer wrong-token"), {} as Response, next);
    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
  });

  it("rejects an empty bearer token", () => {
    requireMasseurAuth(makeRequest("Bearer "), {} as Response, next);
    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
  });
});
