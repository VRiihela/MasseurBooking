import { z } from "zod";

export const loginTokenQuerySchema = z
  .object({
    token: z.string().trim().min(1, "token is required"),
  })
  .strict();

export type LoginTokenQueryInput = z.infer<typeof loginTokenQuerySchema>;
