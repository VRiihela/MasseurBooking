import { z } from "zod";

export const declineBookingSchema = z
  .object({
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export type DeclineBookingInput = z.infer<typeof declineBookingSchema>;
