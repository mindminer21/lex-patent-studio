import type { TokenWorkload } from "./pricing";
import { WORKFLOW_TIER_FLOOR, type WorkflowKey, type WorkTier } from "./tiers";

/**
 * Composer-facing workflow metadata (PRD §5.1, §8.3).
 *
 * Workload profiles are LOCAL-MODE planning estimates used for the
 * pre-run charge range; production estimates come from the orchestrator's
 * per-workflow calibration data.
 */

export interface WorkflowMeta {
  key: WorkflowKey;
  label: string;
  description: string;
  tier: WorkTier;
  deliverableTypes: string[];
  workload: TokenWorkload;
}

const W = (
  key: WorkflowKey,
  label: string,
  description: string,
  deliverableTypes: string[],
  workload: TokenWorkload,
): WorkflowMeta => ({
  key,
  label,
  description,
  tier: WORKFLOW_TIER_FLOOR[key],
  deliverableTypes,
  workload,
});

export const COMPOSER_WORKFLOWS: WorkflowMeta[] = [
  W(
    "section_draft",
    "Section drafting",
    "Draft specification sections from the approved fact ledger only.",
    ["Background & summary", "Detailed description", "Abstract"],
    { inputTokens: 90_000, outputTokens: 18_000, variance: 0.35 },
  ),
  W(
    "claim_tree_draft",
    "Claim tree with fallbacks",
    "Independent/dependent claim tree with planned-retreat fallback hierarchy.",
    ["Claim set draft", "Claim strategy skeleton"],
    { inputTokens: 70_000, outputTokens: 14_000, variance: 0.35 },
  ),
  W(
    "oa_analysis",
    "Office-action analysis",
    "Parse rejections into an evidence-linked rejection matrix.",
    ["Rejection matrix", "Rejection matrix + response-path options"],
    { inputTokens: 120_000, outputTokens: 16_000, variance: 0.3 },
  ),
  W(
    "oa_response_draft",
    "OA response drafting",
    "Amendments with MPEP-compliant markup, separate from arguments.",
    ["Amendment draft", "Argument outline", "Response shell"],
    { inputTokens: 110_000, outputTokens: 22_000, variance: 0.35 },
  ),
  W(
    "search_report",
    "Search report",
    "Public-data search orchestration with per-reference relevance rationale.",
    ["Search report (house style)"],
    { inputTokens: 150_000, outputTokens: 20_000, variance: 0.4 },
  ),
  W(
    "research_memo",
    "Cited research memo",
    "Primary-authority-first research with as-of dating and supersession checks.",
    ["Research memo with source trail"],
    { inputTokens: 130_000, outputTokens: 15_000, variance: 0.35 },
  ),
  W(
    "ids_packet",
    "IDS packet preparation",
    "Reference extraction, citation classification, SB/08 field validation.",
    ["IDS packet (SB/08 fields)"],
    { inputTokens: 40_000, outputTokens: 8_000, variance: 0.25 },
  ),
  W(
    "dependent_claim_draft",
    "Dependent claims (established strategy)",
    "Routine dependent-claim drafting per an approved strategy.",
    ["Dependent claim additions"],
    { inputTokens: 45_000, outputTokens: 9_000, variance: 0.25 },
  ),
  W(
    "response_path_options",
    "Response-path options",
    "Options, tradeoffs, and estoppel flags. The practitioner decides.",
    ["Decision-support brief (options only)"],
    { inputTokens: 100_000, outputTokens: 12_000, variance: 0.3 },
  ),
];

export function getWorkflowMeta(key: string): WorkflowMeta | undefined {
  return COMPOSER_WORKFLOWS.find((w) => w.key === key);
}
