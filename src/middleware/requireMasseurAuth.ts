import type { NextFunction, Request, Response } from "express";
import { UnauthorizedError } from "../errors.js";
import { validateSession } from "../services/adminAuthService.js";

const BEARER_PREFIX = "Bearer ";

export async function requireMasseurAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.header("authorization") ?? "";
  if (!header.startsWith(BEARER_PREFIX)) {
    next(new UnauthorizedError());
    return;
  }

  const provided = header.slice(BEARER_PREFIX.length).trim();
  if (!provided) {
    next(new UnauthorizedError());
    return;
  }

  let valid: boolean;
  try {
    valid = await validateSession(provided);
  } catch (error) {
    // Express 4 does not catch rejections from an async middleware itself --
    // without this, a DB error here would be an unhandled rejection and the
    // request would hang instead of getting a 500.
    next(error);
    return;
  }

  if (!valid) {
    next(new UnauthorizedError());
    return;
  }

  // Stashed so /auth/logout can revoke exactly the session that authenticated
  // this request, not "some" session belonging to the admin.
  res.locals.sessionToken = provided;
  next();
}
