/**
 * Deterministic checker contracts (PRD §5.1 "Quality control", FR-7).
 *
 * Checkers are PURE FUNCTIONS over claim text. They run as separate
 * orchestrator stages with machine-readable results — deterministic rules,
 * never model opinion. Failures annotate drafts and cannot be dismissed
 * silently (PRD §9.2 acceptance criteria).
 */

/** Minimal claim input contract shared by all checkers. */
export interface ClaimInput {
  /** Claim number as it appears in the claim set (1-based). */
  number: number;
  /** Full claim text including the preamble and dependency phrase. */
  text: string;
}

export type CheckSeverity = "error" | "warning";

export interface CheckFinding {
  /** Stable machine-readable code, e.g. "DEP-MISSING-TARGET". */
  code: string;
  severity: CheckSeverity;
  /** The claim the finding is anchored to. */
  claimNumber: number;
  /** Human-readable explanation for the annotation and audit log. */
  message: string;
  /** Optional term/phrase the finding concerns (antecedent basis). */
  term?: string;
  /** Optional dependency path context (e.g. the parent chain examined). */
  path?: number[];
}

export interface CheckResult {
  /** Checker identity + version recorded on the run (FR-7 reproducibility). */
  checker: string;
  checkerVersion: string;
  /** True when zero error-severity findings exist (warnings allowed). */
  passed: boolean;
  findings: CheckFinding[];
}

export function summarizeFindings(findings: CheckFinding[]): {
  errors: number;
  warnings: number;
} {
  let errors = 0;
  let warnings = 0;
  for (const f of findings) {
    if (f.severity === "error") errors += 1;
    else warnings += 1;
  }
  return { errors, warnings };
}
