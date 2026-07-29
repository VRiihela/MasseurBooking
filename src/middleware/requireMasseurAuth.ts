import { createHash, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { loadMasseurAdminToken } from "../config/auth.js";
import { UnauthorizedError } from "../errors.js";

const BEARER_PREFIX = "Bearer ";

// Hash both sides to a fixed-length digest before comparing, so
// timingSafeEqual never throws on a length mismatch and comparison time
// doesn't vary with the length of the (attacker-controlled) provided token.
function tokensMatch(provided: string, expected: string): boolean {
  const providedDigest = createHash("sha256").update(provided).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}

export function requireMasseurAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.header("authorization") ?? "";
  if (!header.startsWith(BEARER_PREFIX)) {
    next(new UnauthorizedError());
    return;
  }

  const provided = header.slice(BEARER_PREFIX.length).trim();
  const expected = loadMasseurAdminToken();

  if (!provided || !tokensMatch(provided, expected)) {
    next(new UnauthorizedError());
    return;
  }

  next();
}
