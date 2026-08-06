import { Router } from "express";
import type { Service } from "../db/types.js";
import { ValidationError } from "../errors.js";
import { adminRateLimit } from "../middleware/rateLimit.js";
import { requireMasseurAuth } from "../middleware/requireMasseurAuth.js";
import { createService, listServices, updateService } from "../services/adminCatalogService.js";
import { createServiceSchema, updateServiceSchema } from "../validation/adminServiceSchema.js";
import { idParamSchema } from "../validation/idParamSchema.js";

export const adminServicesRouter = Router();

function serviceResponse(service: Service) {
  return {
    id: service.id,
    name: service.name,
    price: service.price,
    duration_minutes: service.durationMinutes,
    buffer_before_minutes: service.bufferBeforeMinutes,
    buffer_after_minutes: service.bufferAfterMinutes,
    active: service.active,
  };
}

adminServicesRouter.get(
  "/admin/services",
  requireMasseurAuth,
  adminRateLimit,
  async (_req, res, next) => {
    try {
      const services = await listServices();
      res.status(200).json(services.map(serviceResponse));
    } catch (error) {
      next(error);
    }
  },
);

adminServicesRouter.post(
  "/admin/services",
  requireMasseurAuth,
  adminRateLimit,
  async (req, res, next) => {
    try {
      const parsed = createServiceSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid request body");
      }

      const service = await createService(parsed.data);

      res.status(201).json(serviceResponse(service));
    } catch (error) {
      next(error);
    }
  },
);

adminServicesRouter.patch(
  "/admin/services/:id",
  requireMasseurAuth,
  adminRateLimit,
  async (req, res, next) => {
    try {
      const parsedParams = idParamSchema.safeParse(req.params);
      if (!parsedParams.success) {
        throw new ValidationError(parsedParams.error.issues[0]?.message ?? "Invalid id");
      }

      const parsedBody = updateServiceSchema.safeParse(req.body);
      if (!parsedBody.success) {
        throw new ValidationError(parsedBody.error.issues[0]?.message ?? "Invalid request body");
      }

      const service = await updateService(parsedParams.data.id, parsedBody.data);

      res.status(200).json(serviceResponse(service));
    } catch (error) {
      next(error);
    }
  },
);
