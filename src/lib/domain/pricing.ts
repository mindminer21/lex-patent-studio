/**
 * Model catalog and cost-estimate math (PRD-lex-patent-studio FR-6, FR-9).
 *
 * Customer charge = provider cost × 1.50 (PRD-wepatent FR-6), with
 * effective-dated rates. The rates below are LOCAL-MODE PLACEHOLDER entries
 * in the effective-dated price-registry shape; production rates load from
 * the model_prices table and are never hard-coded in frontend source.
 *
 * No adapter in this repository calls a live paid API.
 */

export const USAGE_MARKUP = 1.5;

export const MODEL_TIERS = ["fast", "advanced", "frontier"] as const;
export type ModelTier = (typeof MODEL_TIERS)[number];

export const MODEL_TIER_LABELS: Record<ModelTier, string> = {
  fast: "Fast",
  advanced: "Advanced",
  frontier: "Frontier",
};

export type ModelProvider = "openai" | "anthropic" | "xai";

export interface ModelCatalogEntry {
  id: string;
  provider: ModelProvider;
  displayName: string;
  tier: ModelTier;
  /** Provider cost, USD per 1M tokens. Effective-dated registry entry. */
  inputPerMTokUsd: number;
  outputPerMTokUsd: number;
  effectiveDate: string; // ISO date the rate became effective
  notes?: string;
}

/**
 * Local-mode price registry snapshot. Production reads model_registry +
 * model_prices via the billing adapter. xAI/Grok customer enablement is
 * approval-gated (PRD §20.13) — listed here as catalog contract only.
 */
export const MODEL_CATALOG: ModelCatalogEntry[] = [
  {
    id: "gpt-5-mini",
    provider: "openai",
    displayName: "GPT-5 mini",
    tier: "fast",
    inputPerMTokUsd: 0.25,
    outputPerMTokUsd: 2.0,
    effectiveDate: "2026-07-01",
  },
  {
    id: "claude-haiku-4-5",
    provider: "anthropic",
    displayName: "Claude Haiku 4.5",
    tier: "fast",
    inputPerMTokUsd: 1.0,
    outputPerMTokUsd: 5.0,
    effectiveDate: "2026-07-01",
  },
  {
    id: "grok-4-fast",
    provider: "xai",
    displayName: "Grok 4 Fast",
    tier: "fast",
    inputPerMTokUsd: 0.2,
    outputPerMTokUsd: 0.5,
    effectiveDate: "2026-07-01",
    notes: "Customer enablement approval-gated (PRD §20.13)",
  },
  {
    id: "gpt-5",
    provider: "openai",
    displayName: "GPT-5",
    tier: "advanced",
    inputPerMTokUsd: 1.25,
    outputPerMTokUsd: 10.0,
    effectiveDate: "2026-07-01",
  },
  {
    id: "claude-sonnet-4-5",
    provider: "anthropic",
    displayName: "Claude Sonnet 4.5",
    tier: "advanced",
    inputPerMTokUsd: 3.0,
    outputPerMTokUsd: 15.0,
    effectiveDate: "2026-07-01",
  },
  {
    id: "grok-4",
    provider: "xai",
    displayName: "Grok 4",
    tier: "advanced",
    inputPerMTokUsd: 3.0,
    outputPerMTokUsd: 15.0,
    effectiveDate: "2026-07-01",
    notes: "Customer enablement approval-gated (PRD §20.13)",
  },
  {
    id: "claude-opus-4-1",
    provider: "anthropic",
    displayName: "Claude Opus 4.1",
    tier: "frontier",
    inputPerMTokUsd: 15.0,
    outputPerMTokUsd: 75.0,
    effectiveDate: "2026-07-01",
  },
  {
    id: "gpt-5-pro",
    provider: "openai",
    displayName: "GPT-5 Pro",
    tier: "frontier",
    inputPerMTokUsd: 15.0,
    outputPerMTokUsd: 120.0,
    effectiveDate: "2026-07-01",
  },
];

export function getModel(id: string): ModelCatalogEntry | undefined {
  return MODEL_CATALOG.find((m) => m.id === id);
}

export function modelsForTier(tier: ModelTier): ModelCatalogEntry[] {
  return MODEL_CATALOG.filter((m) => m.tier === tier);
}

export interface TokenWorkload {
  /** Expected token counts for the run. */
  inputTokens: number;
  outputTokens: number;
  /**
   * Estimate variance band, e.g. 0.35 → the range spans −35%/+35% of the
   * expected charge. Disclosed to the user as the estimate range.
   */
  variance: number;
}

export interface ChargeEstimate {
  providerCostUsd: number;
  /** providerCost × USAGE_MARKUP, rounded to cents. */
  expectedChargeUsd: number;
  lowChargeUsd: number;
  highChargeUsd: number;
  markup: number;
}

export function roundUsd(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Provider cost in USD for a workload on a model (pre-markup). */
export function providerCostUsd(
  model: ModelCatalogEntry,
  workload: Pick<TokenWorkload, "inputTokens" | "outputTokens">,
): number {
  return (
    (workload.inputTokens / 1_000_000) * model.inputPerMTokUsd +
    (workload.outputTokens / 1_000_000) * model.outputPerMTokUsd
  );
}

/** Full estimate: provider cost × 1.50, with the disclosed variance band. */
export function estimateCharge(
  model: ModelCatalogEntry,
  workload: TokenWorkload,
): ChargeEstimate {
  if (workload.variance < 0 || workload.variance >= 1) {
    throw new Error(`Estimate variance must be in [0, 1); got ${workload.variance}`);
  }
  const cost = providerCostUsd(model, workload);
  const expected = roundUsd(cost * USAGE_MARKUP);
  return {
    providerCostUsd: roundUsd(cost),
    expectedChargeUsd: expected,
    lowChargeUsd: roundUsd(expected * (1 - workload.variance)),
    highChargeUsd: roundUsd(expected * (1 + workload.variance)),
    markup: USAGE_MARKUP,
  };
}

/** Is the wallet balance sufficient to reserve the high end of the estimate? */
export function walletSufficient(
  walletBalanceUsd: number,
  estimate: ChargeEstimate,
): boolean {
  return walletBalanceUsd >= estimate.highChargeUsd;
}

export function formatUsd(v: number): string {
  return v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });
}
