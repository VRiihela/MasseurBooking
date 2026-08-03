import { createHash, randomBytes } from "node:crypto";
import type { PoolClient } from "pg";

const TOKEN_BYTES = 32;

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Mints and stores a fresh customer-access token for a booking, in the
 * caller's transaction. Unlike admin_sessions/admin_login_tokens (006),
 * a booking accumulates one token row per email sent for it rather than a
 * single reused token -- every token ever issued for a booking stays valid
 * for that booking indefinitely (no rotation, no expiry). See
 * src/db/migrations/007_customer_booking_tokens.sql.
 */
export async function mintCustomerToken(client: PoolClient, bookingId: string): Promise<string> {
  const rawToken = randomBytes(TOKEN_BYTES).toString("hex");
  await client.query(
    `INSERT INTO customer_booking_tokens (booking_id, token_hash) VALUES ($1, $2)`,
    [bookingId, hashToken(rawToken)],
  );
  return rawToken;
}
