import { z } from "zod";

// Shared by createBookingSchema's start_at and rescheduleBookingSchema's
// newStartAt -- messages stay field-name-agnostic so they read correctly at
// either call site.
export const strictUtcTimestamp = z
  .string()
  .refine(
    (value) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|\+00:00)$/.test(value),
    {
      message: "must be an ISO 8601 timestamp with an explicit UTC offset (Z or +00:00)",
    },
  )
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "must be a valid date",
  })
  .refine((value) => new Date(value).getTime() > Date.now(), {
    message: "must be in the future",
  });

export const createBookingSchema = z
  .object({
    service_id: z.string().uuid("service_id must be a valid UUID"),
    start_at: strictUtcTimestamp,
    customer: z
      .object({
        name: z.string().trim().min(1, "customer.name is required"),
        email: z.string().trim().email("customer.email must be a valid email"),
        phone: z.string().trim().min(1, "customer.phone is required"),
      })
      .strict(),
  })
  .strict();

export type CreateBookingInput = z.infer<typeof createBookingSchema>;
