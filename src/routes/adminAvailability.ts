import { Router } from "express";
import type { AvailabilityException, AvailabilityRule } from "../db/types.js";
import { ValidationError } from "../errors.js";
import { adminRateLimit } from "../middleware/rateLimit.js";
import { requireMasseurAuth } from "../middleware/requireMasseurAuth.js";
import {
  createAvailabilityException,
  createAvailabilityRule,
  deleteAvailabilityException,
  deleteAvailabilityRule,
  listAvailabilityExceptions,
  listAvailabilityRules,
  updateAvailabilityRule,
} from "../services/adminCatalogService.js";
import {
  createAvailabilityExceptionSchema,
  createAvailabilityRuleSchema,
  updateAvailabilityRuleSchema,
} from "../validation/adminAvailabilitySchema.js";
import { idParamSchema } from "../validation/idParamSchema.js";

export const adminAvailabilityRouter = Router();

function ruleResponse(rule: AvailabilityRule) {
  return {
    id: rule.id,
    weekday: rule.weekday,
    start_time: rule.startTime,
    end_time: rule.endTime,
  };
}

function exceptionResponse(exception: AvailabilityException) {
  return {
    id: exception.id,
    date: exception.date,
    type: exception.type,
    start_time: exception.startTime,
    end_time: exception.endTime,
  };
}

adminAvailabilityRouter.get(
  "/admin/availability-rules",
  requireMasseurAuth,
  adminRateLimit,
  async (_req, res, next) => {
    try {
      const rules = await listAvailabilityRules();
      res.status(200).json(rules.map(ruleResponse));
    } catch (error) {
      next(error);
    }
  },
);

adminAvailabilityRouter.post(
  "/admin/availability-rules",
  requireMasseurAuth,
  adminRateLimit,
  async (req, res, next) => {
    try {
      const parsed = createAvailabilityRuleSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid request body");
      }

      const rule = await createAvailabilityRule(parsed.data);

      res.status(201).json(ruleResponse(rule));
    } catch (error) {
      next(error);
    }
  },
);

adminAvailabilityRouter.patch(
  "/admin/availability-rules/:id",
  requireMasseurAuth,
  adminRateLimit,
  async (req, res, next) => {
    try {
      const parsedParams = idParamSchema.safeParse(req.params);
      if (!parsedParams.success) {
        throw new ValidationError(parsedParams.error.issues[0]?.message ?? "Invalid id");
      }

      const parsedBody = updateAvailabilityRuleSchema.safeParse(req.body);
      if (!parsedBody.success) {
        throw new ValidationError(parsedBody.error.issues[0]?.message ?? "Invalid request body");
      }

      const rule = await updateAvailabilityRule(parsedParams.data.id, parsedBody.data);

      res.status(200).json(ruleResponse(rule));
    } catch (error) {
      next(error);
    }
  },
);

adminAvailabilityRouter.delete(
  "/admin/availability-rules/:id",
  requireMasseurAuth,
  adminRateLimit,
  async (req, res, next) => {
    try {
      const parsedParams = idParamSchema.safeParse(req.params);
      if (!parsedParams.success) {
        throw new ValidationError(parsedParams.error.issues[0]?.message ?? "Invalid id");
      }

      await deleteAvailabilityRule(parsedParams.data.id);

      res.status(200).json({ id: parsedParams.data.id, deleted: true });
    } catch (error) {
      next(error);
    }
  },
);

adminAvailabilityRouter.get(
  "/admin/availability-exceptions",
  requireMasseurAuth,
  adminRateLimit,
  async (_req, res, next) => {
    try {
      const exceptions = await listAvailabilityExceptions();
      res.status(200).json(exceptions.map(exceptionResponse));
    } catch (error) {
      next(error);
    }
  },
);

adminAvailabilityRouter.post(
  "/admin/availability-exceptions",
  requireMasseurAuth,
  adminRateLimit,
  async (req, res, next) => {
    try {
      const parsed = createAvailabilityExceptionSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid request body");
      }

      const exception = await createAvailabilityException(parsed.data);

      res.status(201).json(exceptionResponse(exception));
    } catch (error) {
      next(error);
    }
  },
);

adminAvailabilityRouter.delete(
  "/admin/availability-exceptions/:id",
  requireMasseurAuth,
  adminRateLimit,
  async (req, res, next) => {
    try {
      const parsedParams = idParamSchema.safeParse(req.params);
      if (!parsedParams.success) {
        throw new ValidationError(parsedParams.error.issues[0]?.message ?? "Invalid id");
      }

      await deleteAvailabilityException(parsedParams.data.id);

      res.status(200).json({ id: parsedParams.data.id, deleted: true });
    } catch (error) {
      next(error);
    }
  },
);
