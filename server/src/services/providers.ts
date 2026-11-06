// Picks the AI SDK model for a lane. Keys come from .env and never leave the server.
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import type { Provider } from "@mmc/shared";
import { env } from "../env";
import { createMockModel } from "./mockModel";

type ProviderOptions = NonNullable<Parameters<typeof import("ai").streamText>[0]["providerOptions"]>;

const KEY_VARS: Record<Exclude<Provider, "mock">, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_API_KEY",
};

export function providerAvailability(provider: Provider): { available: boolean; reason?: string } {
  if (provider === "mock") {
    return env.enableMockModels
      ? { available: true }
      : { available: false, reason: "Set ENABLE_MOCK_MODELS=true in .env" };
  }
  return env.keys[provider] ? { available: true } : { available: false, reason: `Set ${KEY_VARS[provider]} in .env` };
}

// One client per provider, created on first use.
let anthropic: ReturnType<typeof createAnthropic> | undefined;
let openai: ReturnType<typeof createOpenAI> | undefined;
let google: ReturnType<typeof createGoogle> | undefined;

export class ProviderUnavailableError extends Error {}

export function getLanguageModel(provider: string, modelId: string): LanguageModel {
  const p = provider as Provider;
  const availability = providerAvailability(p);
  if (!availability.available) throw new ProviderUnavailableError(availability.reason ?? `${provider} is unavailable`);
  switch (p) {
    case "anthropic":
      anthropic ??= createAnthropic({ apiKey: env.keys.anthropic });
      return anthropic(modelId);
    case "openai":
      openai ??= createOpenAI({ apiKey: env.keys.openai });
      return openai(modelId);
    case "google":
      // The Google provider sends the key in the x-goog-api-key header, not the URL.
      google ??= createGoogle({ apiKey: env.keys.google });
      return google(modelId);
    case "mock":
      return createMockModel(modelId);
    default:
      throw new ProviderUnavailableError(`Unknown provider "${provider}"`);
  }
}

/**
 * Per-provider call options.
 * OpenAI: don't store responses on OpenAI's side, and ask for reasoning in encrypted form,
 * so the reply in message_json is self-contained and Postgres stays the only copy of each
 * thread (no item references that expire or break when keys change).
 */
export function providerOptionsFor(provider: string): ProviderOptions | undefined {
  if (provider === "openai") {
    return { openai: { store: false, include: ["reasoning.encrypted_content"] } };
  }
  return undefined;
}
