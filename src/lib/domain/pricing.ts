/**
 * Model catalog and cost-estimate math (PRD-lex-patent-studio FR-6, FR-9).
 *
 * Customer charge = provider cost × a TASK-TYPE multiplier (PRD-wepatent
 * FR-6, Jeff's directive 2026-08-04), with effective-dated rates:
 *
 *   generation 2.0×  ·  analysis 1.5×
 *
 * The multiplier catalog is shared with wepatent
 * (`src/lib/shared/billing/markup.ts`) and the exhaustive workflow →
 * category table lives in `src/lib/shared/billing/task-category.ts`. Lex's
 * drafting, claim, OA-response, memo, declaration, search-report, and
 * strategy workflows are generation; its extraction, classification,
 * formalities, digest, and analysis workflows are analysis.
 *
 * The rates below are LOCAL-MODE PLACEHOLDER entries in the effective-dated
 * price-registry shape; production rates load from the model_prices table
 * and are never hard-coded in frontend source.
 *
 * No adapter in this repository calls a live paid API.
 */
import {
  DEFAULT_BILLING_CATEGORY,
  markupMultiplierFor,
  MARKUP_MULTIPLIERS,
  type BillingCategory,
} from "@/lib/shared/billing/markup";
import { LEX_WORKFLOW_CATEGORY } from "@/lib/shared/billing/task-category";
import type { WorkflowKey } from "./tiers";

export { MARKUP_MULTIPLIERS, markupMultiplierFor, type BillingCategory };

/**
 * The generation and analysis multipliers, named for Lex call sites.
 *
 * There is deliberately no single `USAGE_MARKUP` constant any more: a bare
 * number cannot be printed on a customer-facing page without saying which
 * kind of task it applies to, and printing the wrong one is the exact
 * substantiation failure docs/legal-ethics-risk-memo.md warns about.
 */
export const USAGE_MARKUP_GENERATION = MARKUP_MULTIPLIERS.generation;
export const USAGE_MARKUP_ANALYSIS = MARKUP_MULTIPLIERS.analysis;

/** The billing category a Lex workflow's model spend falls under. */
export function markupForWorkflow(workflow: WorkflowKey): number {
  return markupMultiplierFor(LEX_WORKFLOW_CATEGORY[workflow] ?? DEFAULT_BILLING_CATEGORY);
}

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

/**
 * Second-model critique routing (FR-6): the critic model MUST differ from
 * the drafting model. Preference order: same tier + different provider,
 * then any different provider, then any different model id. Deterministic.
 */
export function pickCriticModel(draftingModelId: string): ModelCatalogEntry {
  const drafting = getModel(draftingModelId);
  const candidates = MODEL_CATALOG.filter((m) => m.id !== draftingModelId);
  if (candidates.length === 0) {
    throw new Error("Model catalog cannot satisfy critic-model independence.");
  }
  if (!drafting) return candidates[0];
  const sameTierOtherProvider = candidates.find(
    (m) => m.tier === drafting.tier && m.provider !== drafting.provider,
  );
  if (sameTierOtherProvider) return sameTierOtherProvider;
  const otherProvider = candidates.find((m) => m.provider !== drafting.provider);
  return otherProvider ?? candidates[0];
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
  /** providerCost × the task-type markup, rounded to cents. */
  expectedChargeUsd: number;
  lowChargeUsd: number;
  highChargeUsd: number;
  markup: number;
  /** Which task category set the multiplier. */
  category: BillingCategory;
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

/**
 * Full estimate: provider cost × the task-type multiplier, with the
 * disclosed variance band.
 *
 * `category` defaults to the platform default (analysis, 1.5) so an
 * uncategorised estimate is never quoted HIGHER than it would have been
 * before the task-type rule; every caller that knows its workflow passes
 * the workflow's category explicitly.
 */
export function estimateCharge(
  model: ModelCatalogEntry,
  workload: TokenWorkload,
  category: BillingCategory = DEFAULT_BILLING_CATEGORY,
): ChargeEstimate {
  if (workload.variance < 0 || workload.variance >= 1) {
    throw new Error(`Estimate variance must be in [0, 1); got ${workload.variance}`);
  }
  const markup = markupMultiplierFor(category);
  const cost = providerCostUsd(model, workload);
  const expected = roundUsd(cost * markup);
  return {
    providerCostUsd: roundUsd(cost),
    expectedChargeUsd: expected,
    lowChargeUsd: roundUsd(expected * (1 - workload.variance)),
    highChargeUsd: roundUsd(expected * (1 + workload.variance)),
    markup,
    category,
  };
}

/** Estimate for a named Lex workflow — resolves the category for you. */
export function estimateChargeForWorkflow(
  model: ModelCatalogEntry,
  workload: TokenWorkload,
  workflow: WorkflowKey,
): ChargeEstimate {
  return estimateCharge(
    model,
    workload,
    LEX_WORKFLOW_CATEGORY[workflow] ?? DEFAULT_BILLING_CATEGORY,
  );
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
