import rateLimit from "express-rate-limit";

export const bookingCreationRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many booking requests. Please try again shortly." },
});

// Defense-in-depth against brute-forcing the admin session bearer token
// (see src/services/adminAuthService.ts) -- not a load-related limit.
export const adminRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again shortly." },
});

// Bounds inbox-bombing the admin's email with login-link messages and
// brute-forcing the email-match check in POST /auth/login-request.
export const loginRequestRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again shortly." },
});

// Read-only and public, but still capped against a scripted loop scraping
// every future date.
export const availabilityRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
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
  message: { error: "Too many requests. Please try again shortly." },
});
