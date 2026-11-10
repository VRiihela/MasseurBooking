import { isIP } from "node:net";
import type { Request } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { loadRateLimitClientIpHeader } from "../config/rateLimit.js";

/**
 * The client IP every limiter keys on. Behind Railway, req.ip is the address
 * of Railway's internal proxy (trust proxy stays off, and X-Forwarded-For
 * carries an extra Railway hop), so production sets
 * RATE_LIMIT_CLIENT_IP_HEADER=x-real-ip to use the header Railway's edge
 * overwrites with the real client address. A missing or invalid header value
 * falls back to req.ip.
 */
export function clientIpFromRequest(req: Request): string | undefined {
  const headerName = loadRateLimitClientIpHeader();
  if (headerName) {
    const value = req.headers[headerName];
    if (typeof value === "string" && isIP(value) !== 0) {
      return value;
    }
  }
  return req.ip;
}

/**
 * ipKeyGenerator folds IPv4-mapped IPv6 addresses into plain IPv4 and groups
 * IPv6 addresses by /56, so one client can't rotate through its own IPv6
 * range to get fresh buckets. A request with no address at all (connection
 * already gone) shares one "unknown" bucket.
 */
export function rateLimitKey(req: Request): string {
  const ip = clientIpFromRequest(req);
  return ip ? ipKeyGenerator(ip) : "unknown";
}

export const bookingCreationRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKey,
  message: { error: "Too many booking requests. Please try again shortly." },
});

// Defense-in-depth against brute-forcing the admin session bearer token
// (see src/services/adminAuthService.ts) -- not a load-related limit.
export const adminRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKey,
  message: { error: "Too many requests. Please try again shortly." },
});

// Bounds inbox-bombing the admin's email with login-link messages and
// brute-forcing the email-match check in POST /auth/login-request.
export const loginRequestRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKey,
  message: { error: "Too many requests. Please try again shortly." },
});

// Read-only and public, but still capped against a scripted loop scraping
// every future date.
export const availabilityRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKey,
  message: { error: "Too many requests. Please try again shortly." },
});

// GET /services -- public, read-only, same risk profile and values as
// availabilityRateLimit but its own independent bucket, so a burst of
// service-catalog scraping can't eat into a legitimate customer's
// availability-checking budget mid-booking-flow (or vice versa).
export const publicServicesRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKey,
  message: { error: "Too many requests. Please try again shortly." },
});

// GET /bookings/:id -- public, token-gated read. Capped against brute-forcing
// the token (paired with booking-id guessing), same reasoning as
// availabilityRateLimit but slightly tighter since a token is a credential.
export const customerBookingViewRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKey,
  message: { error: "Too many requests. Please try again shortly." },
});

// POST /bookings/:id/cancel and /reschedule -- mutating customer actions.
// Unlike bookingCreationRateLimit (fully anonymous, no credential at all),
// these require the caller to already hold a valid, high-entropy per-booking
// token -- closer in risk profile to adminRateLimit's "defense in depth
// against brute-forcing a bearer credential" than to the public creation
// endpoint, so it gets the same limit as adminRateLimit rather than
// bookingCreationRateLimit's tighter one.
export const customerBookingActionRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKey,
  message: { error: "Too many requests. Please try again shortly." },
});
