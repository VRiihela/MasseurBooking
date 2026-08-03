import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

const validateSessionMock = vi.fn();

vi.mock("../../src/services/adminAuthService.js", () => ({
  validateSession: validateSessionMock,
}));

const { requireMasseurAuth } = await import("../../src/middleware/requireMasseurAuth.js");
const { UnauthorizedError } = await import("../../src/errors.js");

function makeRequest(authorization?: string): Request {
  return {
    header: (name: string) => (name.toLowerCase() === "authorization" ? authorization : undefined),
  } as unknown as Request;
}

function makeResponse(): Response {
  return { locals: {} } as unknown as Response;
}

describe("requireMasseurAuth", () => {
  let next: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    next = vi.fn();
    validateSessionMock.mockReset();
  });

  it("calls next() with no error and stashes the session token when the session is valid", async () => {
    validateSessionMock.mockResolvedValueOnce(true);
    const res = makeResponse();

    await requireMasseurAuth(makeRequest("Bearer valid-session-token"), res, next);

    expect(next).toHaveBeenCalledWith();
    expect(validateSessionMock).toHaveBeenCalledWith("valid-session-token");
    expect(res.locals.sessionToken).toBe("valid-session-token");
  });

  it("rejects a missing Authorization header without checking the session", async () => {
    await requireMasseurAuth(makeRequest(undefined), makeResponse(), next);
    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    expect(validateSessionMock).not.toHaveBeenCalled();
  });

  it("rejects a non-Bearer Authorization header", async () => {
    await requireMasseurAuth(makeRequest("Basic dGVzdA=="), makeResponse(), next);
    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    expect(validateSessionMock).not.toHaveBeenCalled();
  });

  it("rejects an empty bearer token without checking the session", async () => {
    await requireMasseurAuth(makeRequest("Bearer "), makeResponse(), next);
    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    expect(validateSessionMock).not.toHaveBeenCalled();
  });

  it("rejects when the session is expired, revoked, or unknown", async () => {
    validateSessionMock.mockResolvedValueOnce(false);
    await requireMasseurAuth(makeRequest("Bearer stale-or-unknown-token"), makeResponse(), next);
    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
  });

  it("forwards to next(error) instead of throwing when the session lookup rejects", async () => {
    const dbError = new Error("connection lost");
    validateSessionMock.mockRejectedValueOnce(dbError);

    await requireMasseurAuth(makeRequest("Bearer some-token"), makeResponse(), next);

    expect(next).toHaveBeenCalledWith(dbError);
  });
});
