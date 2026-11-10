/**
 * Name of a request header that holds the real client IP, set by a trusted
 * proxy in front of this app (on Railway: "x-real-ip", which the public edge
 * overwrites on every request). Unset means the header is ignored and the
 * rate limiters key on req.ip, as before task 041.
 *
 * Only set this where that proxy always sits in front of the app. Anywhere
 * else, clients could send the header themselves and choose their own
 * rate-limit bucket.
 *
 * Read on every request (not cached) so tests can toggle it per case.
 */
export function loadRateLimitClientIpHeader(): string | undefined {
  const value = process.env.RATE_LIMIT_CLIENT_IP_HEADER?.trim().toLowerCase();
  return value ? value : undefined;
}
