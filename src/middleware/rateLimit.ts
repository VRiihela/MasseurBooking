import rateLimit from "express-rate-limit";

export const bookingCreationRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many booking requests. Please try again shortly." },
});
