import { z } from "zod";

export const bookingIdParamSchema = z.object({
  id: z.string().uuid("booking id must be a valid UUID"),
});

// 32 raw bytes -> 64 hex characters -- matches bookingTokenService's
// TOKEN_BYTES, same shape as the admin session/login tokens from 006.
export const bookingTokenQuerySchema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/, "token must be a valid access token"),
});
