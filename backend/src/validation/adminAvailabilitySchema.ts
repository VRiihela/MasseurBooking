import { DateTime } from "luxon";
import { z } from "zod";

// HH:MM:SS, bounded to valid ranges (not just any two digits) -- matches the
// zero-padded shape Postgres returns for a TIME column, so string comparison
// for end_time > start_time is always safe (equal-length, digit-only).
const timeOfDay = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/, "must be in HH:MM:SS format");

const weekday = z
  .number()
  .int()
  .min(1, "weekday must be between 1 and 7")
  .max(7, "weekday must be between 1 and 7");

export const createAvailabilityRuleSchema = z
  .object({
    weekday,
    start_time: timeOfDay,
    end_time: timeOfDay,
  })
  .strict()
  .refine((data) => data.end_time > data.start_time, {
    message: "end_time must be after start_time",
    path: ["end_time"],
  });

export type CreateAvailabilityRuleInput = z.infer<typeof createAvailabilityRuleSchema>;

// No cross-field end_time > start_time check here -- a partial patch may
// only touch one of the two fields, so that check runs in
// adminCatalogService.ts against the merged current-row + patch values.
export const updateAvailabilityRuleSchema = z
  .object({
    weekday: weekday.optional(),
    start_time: timeOfDay.optional(),
    end_time: timeOfDay.optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "at least one field must be provided",
  });

export type UpdateAvailabilityRuleInput = z.infer<typeof updateAvailabilityRuleSchema>;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be in YYYY-MM-DD format")
  .refine((value) => DateTime.fromISO(value).isValid, {
    message: "date must be a valid calendar date",
  });

export const createAvailabilityExceptionSchema = z
  .object({
    date: isoDate,
    type: z.enum(["blocked", "open"]),
    start_time: timeOfDay,
    end_time: timeOfDay,
  })
  .strict()
  .refine((data) => data.end_time > data.start_time, {
    message: "end_time must be after start_time",
    path: ["end_time"],
  });

export type CreateAvailabilityExceptionInput = z.infer<typeof createAvailabilityExceptionSchema>;
