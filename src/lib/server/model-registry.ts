import type { ModelRate } from "@/lib/wepatent/domain/usage";
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
  provider: "local-synthetic";
  rate: ModelRate;
  maxOutputTokens: number;
};

export const MODEL_TIERS: readonly ModelTier[] = [
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
