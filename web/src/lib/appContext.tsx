// App-wide data: the model list (for labels and prices) and the conversation list.
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ConversationSummary, ModelInfo, ModelsResponse } from "@mmc/shared";
import { api } from "./api";

interface AppData {
  models: ModelsResponse | null;
  modelsError: string | null;
  conversations: ConversationSummary[];
  refreshConversations: () => void;
  findModel: (provider: string, modelId: string) => ModelInfo | undefined;
  modelLabel: (provider: string, modelId: string) => string;
}

const Ctx = createContext<AppData | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [models, setModels] = useState<ModelsResponse | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);

  useEffect(() => {
    api
      .models()
      .then(setModels)
      .catch((e: Error) => setModelsError(`Can't reach the API server: ${e.message}`));
  }, []);

  const refreshConversations = useCallback(() => {
    api
      .conversations()
      .then(setConversations)
      .catch(() => {});
  }, []);
  useEffect(refreshConversations, [refreshConversations]);

  const value = useMemo<AppData>(() => {
    const findModel = (provider: string, modelId: string) =>
      models?.models.find((m) => m.provider === provider && m.id === modelId);
    return {
      models,
      modelsError,
      conversations,
      refreshConversations,
      findModel,
      modelLabel: (provider, modelId) => findModel(provider, modelId)?.label ?? modelId,
    };
  }, [models, modelsError, conversations, refreshConversations]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppData(): AppData {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAppData outside AppDataProvider");
  return v;
}
