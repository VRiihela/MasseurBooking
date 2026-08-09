import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { DatabaseError } from "pg";
import { adminAvailabilityRouter } from "./routes/adminAvailability.js";
import { adminProviderRouter } from "./routes/adminProvider.js";
import { adminServicesRouter } from "./routes/adminServices.js";
import { authRouter } from "./routes/auth.js";
import { availabilityRouter } from "./routes/availability.js";
import { bookingsRouter } from "./routes/bookings.js";
import { servicesRouter } from "./routes/services.js";
import { loadCorsOrigin } from "./config/cors.js";
import { AppError } from "./errors.js";

// Postgres SQLSTATE class 23 = integrity constraint violation (CHECK, NOT
// NULL, FK, UNIQUE). Every constraint this app relies on should already be
// caught by server-side validation before a query runs -- this is a
// defense-in-depth fallback so a gap in that validation (or a constraint
// changing under it) still surfaces as a clean 400, never a raw 500.
function isConstraintViolation(err: unknown): boolean {
  return err instanceof DatabaseError && typeof err.code === "string" && err.code.startsWith("23");
}

export function createApp() {
  const app = express();
  const allowedOrigin = loadCorsOrigin();
  app.use(
    cors({
      origin: (origin, callback) => {
        // No Origin header means same-origin, curl, or a server-to-server
        // call -- nothing to gate. Cross-origin browser requests must match
        // the single configured origin exactly.
        if (!origin || origin === allowedOrigin) {
          callback(null, true);
          return;
        }
        callback(null, false);
      },
    }),
  );
  app.use(express.json());
  app.use(bookingsRouter);
  app.use(availabilityRouter);
  app.use(authRouter);
  app.use(adminServicesRouter);
  app.use(adminAvailabilityRouter);
  app.use(adminProviderRouter);
  app.use(servicesRouter);

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ error: err.clientMessage });
      return;
    }
    if (isConstraintViolation(err)) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
