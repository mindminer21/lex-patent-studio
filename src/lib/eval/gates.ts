import type { WorkflowKey } from "@/lib/domain/tiers";
import type { SuiteRunReport } from "./types";

/**
 * Per-workflow release gates (PRD §14, approval gate §20.12).
 *
 * A workflow ships to production ONLY when:
 *  1. the attorney-validated suite meets its thresholds,
 *  2. workflow-specific metrics pass, and
 *  3. Jeff signs off on that workflow's production enablement.
 *
 * Every workflow starts NOT enabled. Nothing in this repository can flip
 * `productionEnabled` — it is data an authorized release process changes
 * after the human sign-off, and the check below refuses when the evidence
 * is machine-seeded only.
 */

export interface WorkflowReleaseGate {
  workflowKey: WorkflowKey;
  /** Minimum pass rate on the attorney-validated suite subset. */
  minValidatedPassRate: number;
  /** Cross-matter leakage must be zero for EVERY release (non-negotiable). */
  requireZeroLeakage: true;
  /** §20.12 sign-off recorded? Always false until Jeff approves. */
  productionEnabled: boolean;
  signOff?: { approvedBy: string; approvedAt: string };
}

const GATE = (workflowKey: WorkflowKey): WorkflowReleaseGate => ({
  workflowKey,
  minValidatedPassRate: 0.95,
  requireZeroLeakage: true,
  productionEnabled: false, // approval-gated (§20.12) — default OFF
});

export const WORKFLOW_RELEASE_GATES: WorkflowReleaseGate[] = [
  GATE("invention_intake"),
  GATE("fact_extraction"),
  GATE("section_draft"),
  GATE("claim_tree_draft"),
  GATE("dependent_claim_draft"),
  GATE("oa_analysis"),
  GATE("oa_response_draft"),
  GATE("search_report"),
  GATE("research_memo"),
  GATE("ids_packet"),
  GATE("formalities_check"),
  GATE("status_digest"),
  GATE("declaration_132"),
  GATE("response_path_options"),
  GATE("claim_scope_strategy"),
  GATE("filing_strategy_options"),
];

export interface GateDecision {
  workflowKey: WorkflowKey;
  releasable: boolean;
  reasons: string[];
}

/**
 * Evaluate a workflow's release gate against a suite report. Machine-seeded
 * evidence can NEVER release a workflow: the attorney-validated count must
 * cover the suite (PRD §14 "public quality claims may only cite
 * attorney-validated results"; §20.12 sign-off required).
 */
export function evaluateReleaseGate(
  gate: WorkflowReleaseGate,
  report: SuiteRunReport,
): GateDecision {
  const reasons: string[] = [];

  if (report.attorneyValidatedCount < report.total) {
    reasons.push(
      `only ${report.attorneyValidatedCount}/${report.total} questions are attorney-validated — machine-seeded evidence cannot release a workflow`,
    );
  }
  if (!report.crossMatterLeakageZero) {
    reasons.push("cross-matter leakage detected — automatic release block");
  }
  const passRate = report.total === 0 ? 0 : report.passed / report.total;
  if (passRate < gate.minValidatedPassRate) {
    reasons.push(
      `pass rate ${(passRate * 100).toFixed(1)}% below threshold ${(gate.minValidatedPassRate * 100).toFixed(0)}%`,
    );
  }
  if (!gate.productionEnabled || !gate.signOff) {
    reasons.push(
      "production enablement not signed off (approval gate §20.12 — requires Jeff)",
    );
  }
  return { workflowKey: gate.workflowKey, releasable: reasons.length === 0, reasons };
}

/**
 * Marketing substantiation rule (PRD §13, §20.11): a public performance
 * claim is supportable only by attorney-validated evidence. With zero
 * validated questions, zero claims are supportable — enforced here and
 * consumed by tests so drift is caught in CI.
 */
export function supportablePublicClaims(report: SuiteRunReport): string[] {
  if (report.attorneyValidatedCount === 0) return [];
  // Substantiated claims are added ONLY alongside their validated evidence
  // and Jeff's approval (§20.11). None exist yet.
  return [];
}
