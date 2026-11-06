import { Router } from "express";
import type { ModelsResponse, Provider } from "@mmc/shared";
import { MODELS, PROVIDER_LABELS } from "../config/models";
import { env } from "../env";
import { providerAvailability } from "../services/providers";

export const modelsRouter = Router();

/** GET /api/models: the model list from config, with which providers have keys. */
modelsRouter.get("/models", (_req, res) => {
  const providerIds = (Object.keys(PROVIDER_LABELS) as Provider[]).filter((p) => p !== "mock" || env.enableMockModels);
  const body: ModelsResponse = {
    providers: providerIds.map((id) => {
      const a = providerAvailability(id);
      return { id, label: PROVIDER_LABELS[id], available: a.available, unavailableReason: a.reason };
    }),
    models: MODELS.filter((m) => providerIds.includes(m.provider)).map((m) => {
      const a = providerAvailability(m.provider);
      return { ...m, available: a.available, unavailableReason: a.reason };
    }),
  };
  res.json(body);
});
