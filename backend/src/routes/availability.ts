import { Router } from "express";
import { ValidationError } from "../errors.js";
import { availabilityRateLimit } from "../middleware/rateLimit.js";
import { computeAvailableSlots } from "../services/availabilityService.js";
import { availabilityQuerySchema } from "../validation/availabilityQuerySchema.js";

export const availabilityRouter = Router();

availabilityRouter.get("/availability", availabilityRateLimit, async (req, res, next) => {
  try {
    const parsed = availabilityQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid query parameters");
    }

    const slots = await computeAvailableSlots({
      serviceId: parsed.data.service_id,
      date: parsed.data.date,
    });

    res.status(200).json(slots);
  } catch (error) {
    next(error);
  }
});
