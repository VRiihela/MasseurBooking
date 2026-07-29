import { Router } from "express";
import { bookingCreationRateLimit } from "../middleware/rateLimit.js";
import { createBooking } from "../services/bookingService.js";
import { ValidationError } from "../errors.js";
import { createBookingSchema } from "../validation/bookingSchema.js";

export const bookingsRouter = Router();

bookingsRouter.post("/bookings", bookingCreationRateLimit, async (req, res, next) => {
  try {
    const parsed = createBookingSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid request body");
    }

    const booking = await createBooking(parsed.data);

    res.status(201).json({
      id: booking.id,
      status: booking.status,
      start_at: booking.startAt.toISOString(),
      end_at: booking.endAt.toISOString(),
    });
  } catch (error) {
    next(error);
  }
});
