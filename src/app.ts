import express, { type NextFunction, type Request, type Response } from "express";
import { AppError } from "./errors.js";
import { bookingsRouter } from "./routes/bookings.js";

export function createApp() {
  const app = express();
  app.use(express.json());
  app.use(bookingsRouter);

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ error: err.clientMessage });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
