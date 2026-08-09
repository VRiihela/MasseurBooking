import { z } from "zod";

export const createServiceSchema = z
  .object({
    name: z.string().trim().min(1, "name is required"),
    price: z.number().positive("price must be a positive number"),
    duration_minutes: z.number().int().positive("duration_minutes must be a positive integer"),
    buffer_before_minutes: z
      .number()
      .int()
      .min(0, "buffer_before_minutes must be zero or greater")
      .default(0),
    buffer_after_minutes: z
      .number()
      .int()
      .min(0, "buffer_after_minutes must be zero or greater")
      .default(0),
    active: z.boolean().default(true),
  })
  .strict();

export type CreateServiceInput = z.infer<typeof createServiceSchema>;

export const updateServiceSchema = z
  .object({
    name: z.string().trim().min(1, "name is required").optional(),
    price: z.number().positive("price must be a positive number").optional(),
    duration_minutes: z
      .number()
      .int()
      .positive("duration_minutes must be a positive integer")
      .optional(),
    buffer_before_minutes: z
      .number()
      .int()
      .min(0, "buffer_before_minutes must be zero or greater")
      .optional(),
    buffer_after_minutes: z
      .number()
      .int()
      .min(0, "buffer_after_minutes must be zero or greater")
      .optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "at least one field must be provided",
  });

export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;
