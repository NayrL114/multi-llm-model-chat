// The model list. Add, retire or reprice models here; no other code changes needed.
//
// `id` is the provider's API model id and is what a lane stores, so don't rename an id
// that existing conversations use: add a new entry instead.
//
// Prices are US$ per million tokens, standard tier, used only for the estimate shown on
// the page. Checked Nov 2026 from provider pages and secondary reports; verify against
// your invoices before relying on them.
//   Claude:  https://platform.claude.com/docs/en/about-claude/pricing
//   OpenAI:  https://developers.openai.com/api/docs/pricing
//   Gemini:  https://aistudio.google.com/docs/pricing
import type { ModelInfo, Provider } from "@mmc/shared";

export type ModelConfig = Omit<ModelInfo, "available" | "unavailableReason">;

export const PROVIDER_LABELS: Record<Provider, string> = {
  anthropic: "Claude",
  openai: "GPT",
  google: "Gemini",
  mock: "Mock (offline)",
};

export const MODELS: ModelConfig[] = [
  // Anthropic
  { id: "claude-opus-5-5", provider: "anthropic", label: "Claude Opus 5.5", tier: "large", inputPricePerMTok: 4, outputPricePerMTok: 20 },
  { id: "claude-sonnet-5-5", provider: "anthropic", label: "Claude Sonnet 5.5", tier: "medium", inputPricePerMTok: 2, outputPricePerMTok: 10 },
  // Haiku 5.5 rises to $0.50 / $2.50 above 100K input tokens.
  { id: "claude-haiku-5-5", provider: "anthropic", label: "Claude Haiku 5.5", tier: "small", inputPricePerMTok: 0.1, outputPricePerMTok: 0.5 },

  // OpenAI (the bare "gpt-5.6" alias points at Sol, so name the tier explicitly)
  { id: "gpt-5.6-sol", provider: "openai", label: "GPT-5.6 Sol", tier: "large", inputPricePerMTok: 5, outputPricePerMTok: 30 },
  { id: "gpt-5.6-terra", provider: "openai", label: "GPT-5.6 Terra", tier: "medium", inputPricePerMTok: 2, outputPricePerMTok: 12 },
  { id: "gpt-5.6-luna", provider: "openai", label: "GPT-5.6 Luna", tier: "small", inputPricePerMTok: 0.2, outputPricePerMTok: 1.2 },

  // Google (3.8 Flash doubles to $1.50 / $7.50 from Jan 1, 2027)
  { id: "gemini-3.1-pro-preview", provider: "google", label: "Gemini 3.1 Pro (preview)", tier: "large", inputPricePerMTok: 2, outputPricePerMTok: 12 },
  { id: "gemini-3.8-flash", provider: "google", label: "Gemini 3.8 Flash", tier: "medium", inputPricePerMTok: 0.75, outputPricePerMTok: 3.75 },
  { id: "gemini-3.5-flash-lite", provider: "google", label: "Gemini 3.5 Flash-Lite", tier: "small", inputPricePerMTok: 0.3, outputPricePerMTok: 2.5 },

  // Offline mock models (ENABLE_MOCK_MODELS=true). They reply by describing exactly what
  // they were sent, so lane separation can be checked for free. "Flaky" fails the first
  // attempt at every reply with a fake bad-key error, so manual retry can be tested.
  { id: "mock-alpha", provider: "mock", label: "Mock Alpha", tier: "large", inputPricePerMTok: 0, outputPricePerMTok: 0 },
  { id: "mock-beta", provider: "mock", label: "Mock Beta", tier: "medium", inputPricePerMTok: 0, outputPricePerMTok: 0 },
  { id: "mock-flaky", provider: "mock", label: "Mock Flaky", tier: "small", inputPricePerMTok: 0, outputPricePerMTok: 0 },
];

export function findModel(provider: string, id: string): ModelConfig | undefined {
  return MODELS.find((m) => m.provider === provider && m.id === id);
}
