import { z } from "zod";

export const bookingIdParamSchema = z.object({
  id: z.string().uuid("booking id must be a valid UUID"),
});
