// Zod request schemas live in "@mmc/shared/schemas" so the page bundle stays free of Zod.
export * from "./types";
export * from "./tree";

/** Estimated US$ cost of one reply. Null if the price or token counts are unknown. */
export function estimateCostUsd(
  price: { inputPricePerMTok: number | null; outputPricePerMTok: number | null } | undefined,
  inputTokens: number | null,
  outputTokens: number | null,
): number | null {
  if (!price || price.inputPricePerMTok == null || price.outputPricePerMTok == null) return null;
  if (inputTokens == null && outputTokens == null) return null;
  return (
    ((inputTokens ?? 0) * price.inputPricePerMTok + (outputTokens ?? 0) * price.outputPricePerMTok) / 1_000_000
  );
}
