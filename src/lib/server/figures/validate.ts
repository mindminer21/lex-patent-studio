/**
 * The validator run — Layer 3's entry point.
 *
 * IMPORTANT FRAMING (spec §8, and the copy in the product must match):
 * this reports MECHANICAL FORMALITY CHECKS against published formal drawing
 * requirements. It is not a legal opinion and not a guarantee that the USPTO
 * will accept the drawings. Rules that a machine cannot decide are reported
 * as `needs_human_review` with the reason — never silently passed.
 */
import { FIGURE_RULES, RULES_VERSION, type RuleOutcome, type ValidationContext } from "./rules";

export type ValidationReport = {
  rulesVersion: string;
  outcomes: RuleOutcome[];
  counts: Record<"pass" | "fail" | "not_applicable" | "needs_human_review", number>;
  /** Set-level status. `failed` if anything failed; otherwise review-aware. */
  status: "passed" | "passed_with_review" | "failed";
  /** Plain-language summary for the product surface. */
  summary: string;
};

export function validateFigureSet(ctx: ValidationContext): ValidationReport {
  const outcomes: RuleOutcome[] = [];
  for (const rule of FIGURE_RULES) {
    if (!rule.check) {
      outcomes.push({
        ruleId: rule.id,
        status: "needs_human_review",
        detail:
          rule.humanReviewReason ??
          "this requirement cannot be decided mechanically and needs a person to confirm it",
        figureNumber: null,
        sheetNumber: null,
      });
      continue;
    }
    try {
      outcomes.push(...rule.check(ctx));
    } catch (error) {
      // A checker that throws is a bug in us, not a compliant drawing.
      // Report it honestly rather than letting the figure through.
      outcomes.push({
        ruleId: rule.id,
        status: "needs_human_review",
        detail: `this check could not complete (${error instanceof Error ? error.message : "unknown error"}); a person must review this requirement`,
        figureNumber: null,
        sheetNumber: null,
      });
    }
  }

  const counts = {
    pass: 0,
    fail: 0,
    not_applicable: 0,
    needs_human_review: 0,
  };
  for (const outcome of outcomes) counts[outcome.status] += 1;

  const status: ValidationReport["status"] =
    counts.fail > 0 ? "failed" : counts.needs_human_review > 0 ? "passed_with_review" : "passed";

  const summary =
    status === "failed"
      ? `${counts.fail} formal requirement${counts.fail === 1 ? "" : "s"} not met. These are mechanical formality checks, not a legal opinion or a guarantee of USPTO acceptance.`
      : status === "passed_with_review"
        ? `Mechanical checks passed. ${counts.needs_human_review} requirement${counts.needs_human_review === 1 ? "" : "s"} cannot be verified by machine and need a person to confirm. These are mechanical formality checks, not a legal opinion or a guarantee of USPTO acceptance.`
        : "All mechanical formality checks passed. These are mechanical checks against published formal requirements, not a legal opinion or a guarantee of USPTO acceptance.";

  return { rulesVersion: RULES_VERSION, outcomes, counts, status, summary };
}

/** Violations only — what the UI surfaces first. */
export function violations(report: ValidationReport): RuleOutcome[] {
  return report.outcomes.filter((outcome) => outcome.status === "fail");
}

export { RULES_VERSION };
