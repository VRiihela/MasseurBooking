import { z } from "zod";

// Shared by the admin resource routes (services/availability-rules/
// availability-exceptions) -- a plain UUID :id check with a message that
// doesn't name a specific resource, unlike bookingIdParamSchema.
export const idParamSchema = z.object({
  id: z.string().uuid("id must be a valid UUID"),
});
