import { Router } from "express";
import { ValidationError } from "../errors.js";
import { adminRateLimit, bookingCreationRateLimit } from "../middleware/rateLimit.js";
import { requireMasseurAuth } from "../middleware/requireMasseurAuth.js";
import { confirmBooking, createBooking, declineBooking } from "../services/bookingService.js";
import { bookingIdParamSchema } from "../validation/bookingIdParam.js";
import { createBookingSchema } from "../validation/bookingSchema.js";
import { declineBookingSchema } from "../validation/declineBookingSchema.js";

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

bookingsRouter.post(
  "/bookings/:id/confirm",
  requireMasseurAuth,
  adminRateLimit,
  async (req, res, next) => {
    try {
      const parsedParams = bookingIdParamSchema.safeParse(req.params);
      if (!parsedParams.success) {
        throw new ValidationError(
          parsedParams.error.issues[0]?.message ?? "Invalid booking id",
        );
      }

      const booking = await confirmBooking(parsedParams.data.id);

      res.status(200).json({
        id: booking.id,
        status: booking.status,
        confirmed_at: booking.confirmedAt?.toISOString() ?? null,
      });
    } catch (error) {
      next(error);
    }
  },
);

bookingsRouter.post(
  "/bookings/:id/decline",
  requireMasseurAuth,
  adminRateLimit,
  async (req, res, next) => {
    try {
      const parsedParams = bookingIdParamSchema.safeParse(req.params);
      if (!parsedParams.success) {
        throw new ValidationError(
          parsedParams.error.issues[0]?.message ?? "Invalid booking id",
        );
      }

      const parsedBody = declineBookingSchema.safeParse(req.body ?? {});
      if (!parsedBody.success) {
        throw new ValidationError(parsedBody.error.issues[0]?.message ?? "Invalid request body");
      }

      const booking = await declineBooking(parsedParams.data.id, parsedBody.data.reason);

      res.status(200).json({
        id: booking.id,
        status: booking.status,
        cancelled_at: booking.cancelledAt?.toISOString() ?? null,
        cancellation_reason: booking.cancellationReason,
      });
    } catch (error) {
      next(error);
    }
  },
);
