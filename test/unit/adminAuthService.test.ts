import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.ADMIN_EMAIL = "admin@example.com";
process.env.APP_BASE_URL = "https://admin.example.com";

const queryMock = vi.fn();

vi.mock("../../src/db/pool.js", () => ({
  getPool: () => ({ query: queryMock }),
  withTransaction: async (work: (client: unknown) => Promise<unknown>) =>
    work({ query: queryMock }),
}));

const {
  requestLoginLink,
  consumeLoginTokenAndCreateSession,
  validateSession,
  revokeSession,
} = await import("../../src/services/adminAuthService.js");
const { UnauthorizedError } = await import("../../src/errors.js");

const SHA256_HEX = /^[a-f0-9]{64}$/;

beforeEach(() => {
  queryMock.mockReset();
});

describe("requestLoginLink", () => {
  it("stores only a hash of the login token and enqueues a login-link email when the email matches ADMIN_EMAIL", async () => {
    queryMock.mockResolvedValueOnce(undefined); // insert admin_login_tokens
    queryMock.mockResolvedValueOnce(undefined); // insert email_jobs

    await requestLoginLink("admin@example.com");

    expect(queryMock).toHaveBeenCalledTimes(2);

    const [tokenSql, tokenParams] = queryMock.mock.calls[0];
    expect(tokenSql).toMatch(/INSERT INTO admin_login_tokens/);
    expect(tokenParams[0]).toMatch(SHA256_HEX);

    const [jobSql, jobParams] = queryMock.mock.calls[1];
    expect(jobSql).toMatch(/INSERT INTO email_jobs/);
    expect(jobParams[0]).toBe("masseur_login_link");
    const payload = JSON.parse(jobParams[1]);
    expect(payload.adminEmail).toBe("admin@example.com");
    expect(payload.loginUrl).toMatch(
      /^https:\/\/admin\.example\.com\/auth\/login\?token=[a-f0-9]{64}$/,
    );
  });

  it("does nothing when the submitted email does not match ADMIN_EMAIL", async () => {
    await requestLoginLink("someone-else@example.com");
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("matches case-insensitively and ignores surrounding whitespace", async () => {
    queryMock.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined);
    await requestLoginLink("  ADMIN@Example.com  ");
    expect(queryMock).toHaveBeenCalledTimes(2);
  });
});

describe("consumeLoginTokenAndCreateSession", () => {
  it("throws UnauthorizedError and never creates a session when the token UPDATE matches no rows", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    await expect(consumeLoginTokenAndCreateSession("unknown-or-expired-token")).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it("creates a new session with a raw token distinct from the login token", async () => {
    queryMock
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: "token-1" }] })
      .mockResolvedValueOnce(undefined); // insert admin_sessions

    const sessionToken = await consumeLoginTokenAndCreateSession("raw-login-token");

    expect(sessionToken).not.toBe("raw-login-token");
    expect(sessionToken).toMatch(/^[a-f0-9]{64}$/);

    const [sessionSql, sessionParams] = queryMock.mock.calls[1];
    expect(sessionSql).toMatch(/INSERT INTO admin_sessions/);
    expect(sessionParams[0]).toMatch(SHA256_HEX);
    expect(sessionParams[0]).not.toBe(sessionToken);
  });
});

describe("validateSession", () => {
  it("returns true when a matching, non-revoked, unexpired session exists", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1, rows: [{}] });
    await expect(validateSession("raw-session-token")).resolves.toBe(true);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/revoked_at IS NULL/);
    expect(params[0]).toMatch(SHA256_HEX);
  });

  it("returns false when no session row matches", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    await expect(validateSession("unknown-token")).resolves.toBe(false);
  });
});

describe("revokeSession", () => {
  it("marks the matching session revoked by its hash", async () => {
    queryMock.mockResolvedValueOnce(undefined);
    await revokeSession("raw-session-token");
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/SET revoked_at = now\(\)/);
    expect(params[0]).toMatch(SHA256_HEX);
  });
});
