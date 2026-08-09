import { Router } from "express";
import type { Provider } from "../db/types.js";
import { ValidationError } from "../errors.js";
import { adminRateLimit } from "../middleware/rateLimit.js";
import { requireMasseurAuth } from "../middleware/requireMasseurAuth.js";
import { getProvider, updateProvider } from "../services/adminCatalogService.js";
import { updateProviderSchema } from "../validation/adminProviderSchema.js";

export const adminProviderRouter = Router();

function providerResponse(provider: Provider) {
  return {
    id: provider.id,
    name: provider.name,
    timezone: provider.timezone,
  };
}

adminProviderRouter.get(
  "/admin/provider",
  requireMasseurAuth,
  adminRateLimit,
  async (_req, res, next) => {
    try {
      const provider = await getProvider();
      res.status(200).json(providerResponse(provider));
    } catch (error) {
      next(error);
    }
  },
);

adminProviderRouter.patch(
  "/admin/provider",
  requireMasseurAuth,
  adminRateLimit,
  async (req, res, next) => {
    try {
      const parsed = updateProviderSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid request body");
      }

      const provider = await updateProvider(parsed.data);

      res.status(200).json(providerResponse(provider));
    } catch (error) {
      next(error);
    }
  },
);
