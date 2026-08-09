import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { loadAdminEmail, loadAppBaseUrl } from "../config/auth.js";
import { getPool, withTransaction } from "../db/pool.js";
import { UnauthorizedError } from "../errors.js";
import { enqueueMasseurLoginLink } from "./emailQueueService.js";

const LOGIN_TOKEN_TTL_MS = 15 * 60_000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60_000;
const TOKEN_BYTES = 32;

function generateRawToken(): string {
  return randomBytes(TOKEN_BYTES).toString("hex");
}

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

// Hash both sides to a fixed-length digest so timingSafeEqual never throws on
// a length mismatch and comparison time doesn't vary with the (attacker-
// controlled) submitted value -- same discipline as requireMasseurAuth.ts.
function emailsMatch(submitted: string, expected: string): boolean {
  const submittedDigest = createHash("sha256").update(submitted.trim().toLowerCase()).digest();
  const expectedDigest = createHash("sha256").update(expected.trim().toLowerCase()).digest();
  return timingSafeEqual(submittedDigest, expectedDigest);
}

/**
 * Always resolves the same way regardless of whether `email` matches
 * ADMIN_EMAIL -- callers must not branch on this to build a response that
 * differs by outcome.
 */
export async function requestLoginLink(email: string): Promise<void> {
  const adminEmail = loadAdminEmail();
  if (!emailsMatch(email, adminEmail)) {
    return;
  }

  const rawLoginToken = generateRawToken();
  const appBaseUrl = loadAppBaseUrl();

  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO admin_login_tokens (token_hash, expires_at)
       VALUES ($1, now() + ($2 || ' milliseconds')::interval)`,
      [hashToken(rawLoginToken), LOGIN_TOKEN_TTL_MS],
    );
    await enqueueMasseurLoginLink(client, { rawLoginToken, adminEmail, appBaseUrl });
  });
}

/**
 * Consumes a login token and mints a session in one transaction, so a token
 * is never burned without a resulting session (or vice versa). The UPDATE's
 * WHERE clause (token_hash + used_at IS NULL + expires_at > now()) is the
 * atomic claim: Postgres serializes concurrent attempts against the same row
 * via its normal row lock, and the loser's WHERE clause re-evaluates against
 * the already-consumed row and matches nothing -- same pattern as
 * transitionPendingBooking in bookingService.ts and claimQueuedJobs in
 * emailWorker.ts.
 */
export async function consumeLoginTokenAndCreateSession(rawLoginToken: string): Promise<string> {
  return withTransaction(async (client) => {
    const consumed = await client.query(
      `UPDATE admin_login_tokens
       SET used_at = now()
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
       RETURNING id`,
      [hashToken(rawLoginToken)],
    );

    if (consumed.rowCount === 0) {
      throw new UnauthorizedError();
    }

    const rawSessionToken = generateRawToken();
    await client.query(
      `INSERT INTO admin_sessions (token_hash, expires_at)
       VALUES ($1, now() + ($2 || ' milliseconds')::interval)`,
      [hashToken(rawSessionToken), SESSION_TTL_MS],
    );

    return rawSessionToken;
  });
}

export async function validateSession(rawSessionToken: string): Promise<boolean> {
  const result = await getPool().query(
    `SELECT 1 FROM admin_sessions
     WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
    [hashToken(rawSessionToken)],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function revokeSession(rawSessionToken: string): Promise<void> {
  await getPool().query(
    `UPDATE admin_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`,
    [hashToken(rawSessionToken)],
  );
}
