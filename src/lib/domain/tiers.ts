/**
 * Work-tier model (PRD-lex-patent-studio §5.3).
 *
 * Every workflow output carries a tier, displayed in UI, exports, and the
 * audit log. Tier assignments per workflow are PLATFORM POLICY: a tenant may
 * promote work to a stricter tier, but may never demote below the platform
 * floor (Invariant 15).
 */

export const WORK_TIERS = ["A", "B", "C"] as const;
export type WorkTier = (typeof WORK_TIERS)[number];

/** Strictness ordering: A (prepare) < B (draft for review) < C (decision support). */
const TIER_RANK: Record<WorkTier, number> = { A: 0, B: 1, C: 2 };

export const TIER_META: Record<
  WorkTier,
  { label: string; meaning: string; requiredHumanAction: string }
> = {
  A: {
    label: "Tier A — Prepare",
    meaning: "Routine, verifiable, low-judgment work",
    requiredHumanAction: "Operator review (agent/paralegal seat sufficient)",
  },
  B: {
    label: "Tier B — Draft for review",
    meaning: "Substantive work product",
    requiredHumanAction:
      "Responsible practitioner reviews and edits before any downstream use",
  },
  C: {
    label: "Tier C — Decision support only",
    meaning: "Strategy and judgment",
    requiredHumanAction:
      "Lex provides options, tradeoffs, and evidence; the practitioner decides",
  },
};

export const WORKFLOW_KEYS = [
  "ids_packet",
  "formalities_check",
  "dependent_claim_draft",
  "status_digest",
  "invention_intake",
  "fact_extraction",
  "section_draft",
  "claim_tree_draft",
  "oa_analysis",
  "oa_response_draft",
  "search_report",
  "research_memo",
  "declaration_132",
  "response_path_options",
  "claim_scope_strategy",
  "filing_strategy_options",
] as const;
export type WorkflowKey = (typeof WORKFLOW_KEYS)[number];

/**
 * Platform tier floor per workflow (PRD §5.3 examples). Not user-editable
 * below the floor by any role.
 */
export const WORKFLOW_TIER_FLOOR: Record<WorkflowKey, WorkTier> = {
  ids_packet: "A",
  formalities_check: "A",
  dependent_claim_draft: "A",
  status_digest: "A",
  invention_intake: "B",
  fact_extraction: "B",
  section_draft: "B",
  claim_tree_draft: "B",
  oa_analysis: "B",
  oa_response_draft: "B",
  search_report: "B",
  research_memo: "B",
  declaration_132: "B",
  response_path_options: "C",
  claim_scope_strategy: "C",
  filing_strategy_options: "C",
};

export function tierRank(tier: WorkTier): number {
  return TIER_RANK[tier];
}

export function isStricterOrEqual(a: WorkTier, b: WorkTier): boolean {
  return TIER_RANK[a] >= TIER_RANK[b];
}

/**
 * Resolve the effective tier for a workflow given an optional tenant
 * override. Promotion (stricter) is honored; demotion below the platform
 * floor is silently clamped to the floor — the platform never runs work
 * below policy.
 */
export function effectiveTier(
  workflow: WorkflowKey,
  tenantOverride?: WorkTier,
): WorkTier {
  const floor = WORKFLOW_TIER_FLOOR[workflow];
  if (!tenantOverride) return floor;
  return isStricterOrEqual(tenantOverride, floor) ? tenantOverride : floor;
}

/**
 * Validate a requested tier assignment. Returns an error string when the
 * request attempts to demote below the platform floor.
 */
export function validateTierAssignment(
  workflow: WorkflowKey,
  requested: WorkTier,
): { ok: true } | { ok: false; error: string } {
  const floor = WORKFLOW_TIER_FLOOR[workflow];
  if (!isStricterOrEqual(requested, floor)) {
    return {
      ok: false,
      error: `Workflow "${workflow}" has a platform tier floor of ${floor}; requested tier ${requested} is a demotion and is not permitted for any role.`,
    };
  }
  return { ok: true };
}
