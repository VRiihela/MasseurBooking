import { z } from "zod";

const strictUtcTimestamp = z
  .string()
  .refine(
    (value) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|\+00:00)$/.test(value),
    {
      message:
        "start_at must be an ISO 8601 timestamp with an explicit UTC offset (Z or +00:00)",
    },
  )
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "start_at must be a valid date",
  })
  .refine((value) => new Date(value).getTime() > Date.now(), {
    message: "start_at must be in the future",
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
