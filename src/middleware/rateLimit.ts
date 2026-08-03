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
