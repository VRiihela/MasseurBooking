import { Router } from "express";
import { ValidationError } from "../errors.js";
import { adminRateLimit, loginRequestRateLimit } from "../middleware/rateLimit.js";
import { requireMasseurAuth } from "../middleware/requireMasseurAuth.js";
import {
  consumeLoginTokenAndCreateSession,
  requestLoginLink,
  revokeSession,
} from "../services/adminAuthService.js";
import { loginRequestSchema } from "../validation/loginRequestSchema.js";
import { loginTokenQuerySchema } from "../validation/loginTokenQuerySchema.js";

export const authRouter = Router();

// Identical regardless of whether the submitted email matched ADMIN_EMAIL --
// never branch this message on the result of requestLoginLink.
const GENERIC_LOGIN_REQUEST_MESSAGE =
  "Jos sähköpostiosoite on rekisteröity, kirjautumislinkki on lähetetty.";

authRouter.post("/auth/login-request", loginRequestRateLimit, async (req, res, next) => {
  try {
    const parsed = loginRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid request body");
    }

    await requestLoginLink(parsed.data.email);

    res.status(200).json({ message: GENERIC_LOGIN_REQUEST_MESSAGE });
  } catch (error) {
    next(error);
  }
});

authRouter.get("/auth/login", async (req, res, next) => {
  try {
    const parsed = loginTokenQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid login token");
    }

    const sessionToken = await consumeLoginTokenAndCreateSession(parsed.data.token);

    res.status(200).json({ token: sessionToken });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/auth/logout", requireMasseurAuth, adminRateLimit, async (req, res, next) => {
  try {
    await revokeSession(res.locals.sessionToken as string);
    res.status(200).json({ message: "Logged out" });
  } catch (error) {
    next(error);
  }
});
