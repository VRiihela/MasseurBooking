import { z } from "zod";

export const loginRequestSchema = z
  .object({
    email: z.string().trim().email("email must be a valid email"),
  })
  .strict();

export type LoginRequestInput = z.infer<typeof loginRequestSchema>;
