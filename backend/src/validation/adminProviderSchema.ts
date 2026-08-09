import { Info } from "luxon";
import { z } from "zod";

export const updateProviderSchema = z
  .object({
    name: z.string().trim().min(1, "name is required").optional(),
    timezone: z
      .string()
      .refine((value) => Info.isValidIANAZone(value), {
        message: "timezone must be a valid IANA timezone",
      })
      .optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "at least one field must be provided",
  });

export type UpdateProviderInput = z.infer<typeof updateProviderSchema>;
