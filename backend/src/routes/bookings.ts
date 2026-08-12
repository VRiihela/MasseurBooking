import { Router } from "express";
import { ValidationError } from "../errors.js";
import {
  adminRateLimit,
  bookingCreationRateLimit,
  customerBookingActionRateLimit,
  customerBookingViewRateLimit,
} from "../middleware/rateLimit.js";
import { requireMasseurAuth } from "../middleware/requireMasseurAuth.js";
import {
  cancelBookingForAdmin,
  cancelBookingForCustomer,
  confirmBooking,
  createBooking,
  declineBooking,
  getBookingForCustomer,
  listBookingsForAdmin,
  rescheduleBookingForCustomer,
} from "../services/bookingService.js";
import { adminBookingsQuerySchema } from "../validation/adminBookingsQuerySchema.js";
import { bookingIdParamSchema, bookingTokenQuerySchema } from "../validation/bookingIdParam.js";
import { createBookingSchema } from "../validation/bookingSchema.js";
import { declineBookingSchema } from "../validation/declineBookingSchema.js";
import { rescheduleBookingSchema } from "../validation/rescheduleBookingSchema.js";

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

bookingsRouter.post(
  "/admin/bookings/:id/cancel",
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

      const booking = await cancelBookingForAdmin(parsedParams.data.id, parsedBody.data.reason);

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

bookingsRouter.get(
  "/admin/bookings",
  requireMasseurAuth,
  adminRateLimit,
  async (req, res, next) => {
    try {
      const parsedQuery = adminBookingsQuerySchema.safeParse(req.query);
      if (!parsedQuery.success) {
        throw new ValidationError(parsedQuery.error.issues[0]?.message ?? "Invalid query parameters");
      }

      const bookings = await listBookingsForAdmin(parsedQuery.data.status);

      res.status(200).json(
        bookings.map((booking) => ({
          id: booking.id,
          status: booking.status,
          service_name: booking.serviceName,
          customer_name: booking.customerName,
          customer_email: booking.customerEmail,
          customer_phone: booking.customerPhone,
          start_at_local: booking.startAtLocal,
          end_at_local: booking.endAtLocal,
          created_at: booking.createdAt.toISOString(),
        })),
      );
    } catch (error) {
      next(error);
    }
  },
);

function parseBookingIdAndToken(req: {
  params: unknown;
  query: unknown;
}): { id: string; token: string } {
  const parsedParams = bookingIdParamSchema.safeParse(req.params);
  if (!parsedParams.success) {
    throw new ValidationError(parsedParams.error.issues[0]?.message ?? "Invalid booking id");
  }

  const parsedQuery = bookingTokenQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    throw new ValidationError(parsedQuery.error.issues[0]?.message ?? "Invalid token");
  }

  return { id: parsedParams.data.id, token: parsedQuery.data.token };
}

bookingsRouter.get("/bookings/:id", customerBookingViewRateLimit, async (req, res, next) => {
  try {
    const { id, token } = parseBookingIdAndToken(req);

    const view = await getBookingForCustomer(id, token);

    res.status(200).json({
      id: view.id,
      status: view.status,
      service_id: view.serviceId,
      service_name: view.serviceName,
      start_at_local: view.startAtLocal,
      end_at_local: view.endAtLocal,
    });
  } catch (error) {
    next(error);
  }
});

bookingsRouter.post(
  "/bookings/:id/cancel",
  customerBookingActionRateLimit,
  async (req, res, next) => {
    try {
      const { id, token } = parseBookingIdAndToken(req);

      const booking = await cancelBookingForCustomer(id, token);

      res.status(200).json({
        id: booking.id,
        status: booking.status,
        cancelled_at: booking.cancelledAt?.toISOString() ?? null,
      });
    } catch (error) {
      next(error);
    }
  },
);

bookingsRouter.post(
  "/bookings/:id/reschedule",
  customerBookingActionRateLimit,
  async (req, res, next) => {
    try {
      const { id, token } = parseBookingIdAndToken(req);

      const parsedBody = rescheduleBookingSchema.safeParse(req.body);
      if (!parsedBody.success) {
        throw new ValidationError(parsedBody.error.issues[0]?.message ?? "Invalid request body");
      }

      const booking = await rescheduleBookingForCustomer(id, token, parsedBody.data.newStartAt);

      res.status(201).json({
        id: booking.id,
        status: booking.status,
        start_at: booking.startAt.toISOString(),
        end_at: booking.endAt.toISOString(),
      });
    } catch (error) {
      next(error);
    }
  },
);
