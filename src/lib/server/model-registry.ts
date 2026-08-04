import type { ModelRate } from "@/lib/wepatent/domain/usage";
import { isLocalMode } from "@/lib/wepatent/env";
import type { DraftWorkflow } from "./adapters/types";

/**
 * Effective-dated model-price registry and per-workflow allowlist (FR-5/FR-6,
 * local subset). Provider rates are server-side only and are never hard-coded
 * in frontend source; the UI receives computed estimates.
 *
 * In local mode both tiers resolve to the deterministic synthetic generator —
 * no external provider account exists or is called.
 */
export type ModelTier = {
  id: string;
  displayName: string;
  modelId: string;
  provider: "local-synthetic" | "openai";
  rate: ModelRate;
  maxOutputTokens: number;
};

/**
 * Production tiers resolve to real provider models present in
 * PROVIDER_PRICE_REGISTRY. Only OpenAI is keyed/enabled today (Jeff's
 * OpenAI-only directive, 2026-08-02); both tiers map to gpt-4.1 until
 * additional providers are approved. Rates are the provider registry rates;
 * retail is applied downstream by TASK CATEGORY (FR-6, Jeff's directive
 * 2026-08-04): 2.0x for generation tasks, 1.5x for analysis tasks. See
 * src/lib/shared/billing/task-category.ts for the exhaustive mapping.
 */
const PRODUCTION_MODEL_TIERS: readonly ModelTier[] = [
  {
    id: "standard",
    displayName: "Standard drafting model (GPT-4.1)",
    modelId: "gpt-4.1",
    provider: "openai",
    rate: {
      rateVersion: "2026-07-01.openai.gpt-4.1",
      inputCentsPerMillionTokens: 200, // $2.00 / M input tokens (provider)
      outputCentsPerMillionTokens: 800, // $8.00 / M output tokens (provider)
    },
    maxOutputTokens: 4_000,
  },
  {
    id: "advanced",
    displayName: "Advanced drafting model (GPT-4.1, extended output)",
    modelId: "gpt-4.1",
    provider: "openai",
    rate: {
      rateVersion: "2026-07-01.openai.gpt-4.1",
      inputCentsPerMillionTokens: 200,
      outputCentsPerMillionTokens: 800,
    },
    maxOutputTokens: 8_000,
  },
];

const LOCAL_MODEL_TIERS: readonly ModelTier[] = [
  {
    id: "standard",
    displayName: "Standard drafting model (synthetic local)",
    modelId: "wepatent-local-standard",
    provider: "local-synthetic",
    rate: {
      rateVersion: "2026-07-01.local.standard",
      inputCentsPerMillionTokens: 300, // $3.00 / M input tokens
      outputCentsPerMillionTokens: 1500, // $15.00 / M output tokens
    },
    maxOutputTokens: 4_000,
  },
  {
    id: "advanced",
    displayName: "Advanced drafting model (synthetic local)",
    modelId: "wepatent-local-advanced",
    provider: "local-synthetic",
    rate: {
      rateVersion: "2026-07-01.local.advanced",
      inputCentsPerMillionTokens: 1500, // $15.00 / M input tokens
      outputCentsPerMillionTokens: 7500, // $75.00 / M output tokens
    },
    maxOutputTokens: 8_000,
  },
];

export const MODEL_TIERS: readonly ModelTier[] = isLocalMode
  ? LOCAL_MODEL_TIERS
  : PRODUCTION_MODEL_TIERS;

export function getModelTier(tierId: string): ModelTier | null {
  return MODEL_TIERS.find((tier) => tier.id === tierId) ?? null;
}

/** Per-workflow model allowlist (FR-5). */
export const WORKFLOW_ALLOWLIST: Record<DraftWorkflow, readonly string[]> = {
  invention_disclosure_summary: ["standard", "advanced"],
  counsel_question_list: ["standard"],
  gap_analysis: ["standard", "advanced"],
};

export const WORKFLOW_TITLES: Record<DraftWorkflow, string> = {
  invention_disclosure_summary: "Invention disclosure summary",
  counsel_question_list: "Questions to prepare for counsel",
  gap_analysis: "Documentation gap analysis",
};

export function isWorkflowAllowed(workflow: DraftWorkflow, tierId: string): boolean {
  return WORKFLOW_ALLOWLIST[workflow]?.includes(tierId) ?? false;
}
