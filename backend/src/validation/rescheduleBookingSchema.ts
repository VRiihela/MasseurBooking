import { z } from "zod";
import { strictUtcTimestamp } from "./bookingSchema.js";

export const rescheduleBookingSchema = z
  .object({
    newStartAt: strictUtcTimestamp,
  })
  .strict();

export type RescheduleBookingInput = z.infer<typeof rescheduleBookingSchema>;
