import { Router } from "express";
import type { Service } from "../db/types.js";
import { publicServicesRateLimit } from "../middleware/rateLimit.js";
import { listActiveServices } from "../services/adminCatalogService.js";

export const servicesRouter = Router();

// Public-safe subset only -- no buffer_before/after_minutes (internal
// scheduling detail already folded into GET /availability's slot sizes),
// no provider_id, no active (this list is already active-only).
function publicServiceResponse(service: Service) {
  return {
    id: service.id,
    name: service.name,
    price: service.price,
    duration_minutes: service.durationMinutes,
  };
}

servicesRouter.get("/services", publicServicesRateLimit, async (_req, res, next) => {
  try {
    const services = await listActiveServices();
    res.status(200).json(services.map(publicServiceResponse));
  } catch (error) {
    next(error);
  }
});
