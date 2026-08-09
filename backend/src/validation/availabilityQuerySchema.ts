import { DateTime } from "luxon";
import { z } from "zod";

export const availabilityQuerySchema = z
  .object({
    service_id: z.string().uuid("service_id must be a valid UUID"),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be in YYYY-MM-DD format")
      .refine((value) => DateTime.fromISO(value).isValid, {
        message: "date must be a valid calendar date",
      }),
  })
  .strict();

export type AvailabilityQueryInput = z.infer<typeof availabilityQuerySchema>;
