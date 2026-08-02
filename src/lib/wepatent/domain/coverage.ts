/**
 * Enablement coverage model v1 (Intake Studio PRD §6.5, FR-INT-8).
 *
 * A DETERMINISTIC checklist derived from 35 U.S.C. §112(a) support needs,
 * computed per solution from structural signals in the record. This module
 * is pure code — model output can never set or change a coverage value
 * (invariant: "coverage meter is deterministic code, never model output").
 *
 * The meter measures COVERAGE OF THE RECORD. It is never a legal
 * sufficiency opinion, and every surface that renders it must carry that
 * caveat (the UI and export renderer do).
 */

export const COVERAGE_DIMENSIONS = [
  "problem_articulated",
  "concept_stated",
  "structure_captured",
  "operation_captured",
  "alternatives_captured",
  "parameters_captured",
  "how_to_use_captured",
] as const;
export type CoverageDimension = (typeof COVERAGE_DIMENSIONS)[number];

/**
 * `satisfied` — deterministic evidence exists in the record.
 * `gap` — no evidence yet; the M2 adaptive interview will target it.
 */
export type CoverageStatus = "satisfied" | "gap";

export const COVERAGE_DIMENSION_LABELS: Record<CoverageDimension, string> = {
  problem_articulated: "Problem articulated",
  concept_stated: "Concept (WHAT) stated",
  structure_captured: "Embodiment structure captured",
  operation_captured: "Operation described",
  alternatives_captured: "Alternatives captured",
  parameters_captured: "Parameters / ranges captured",
  how_to_use_captured: "How-to-use captured",
};

export type CoverageEvidence = {
  status: CoverageStatus;
  /** Human-readable deterministic evidence description; null when a gap. */
  evidence: string | null;
};

export type SolutionCoverage = {
  solutionId: string;
  dimensions: Record<CoverageDimension, CoverageEvidence>;
  satisfiedCount: number;
  totalCount: number;
};

export type CoverageInput = {
  solution: { id: string; statement: string };
  /** Problem pair ids linked to this solution via ps_links. */
  linkedProblemIds: readonly string[];
  /** Components associated with this solution (any state). */
  associatedComponentNames: readonly string[];
  /** All fact statements on the invention record, by category. */
  facts: ReadonlyArray<{ category: string; statement: string }>;
  /** Invention-level business context (how-to-use signal). */
  businessContext: string;
};

/** Deterministic keyword heuristics (v1) — documented, versioned, testable. */
const OPERATION_PATTERN =
  /\b(operat\w*|step(s)?\b|process\b|method\b|works by|sequence|when activated|flow\b|executes?|performs?)\b/i;
const ALTERNATIVES_PATTERN =
  /\b(alternat\w*|instead of|substitut\w*|optionally|another (way|approach|embodiment)|variant(s)?|in other embodiments?)\b/i;
const PARAMETERS_PATTERN =
  /\b\d+(\.\d+)?\s?(%|mm\b|cm\b|nm\b|µm\b|um\b|m\b|kg\b|g\b|mg\b|s\b|ms\b|min\b|°c|°f|degrees|psi|kpa|pa\b|volt(s)?|v\b|amp(s)?|ma\b|hz\b|khz\b|mhz\b|rpm|watt(s)?|w\b|ppm|mol|litre|liter|ml\b)|range of \d|between \d+ and \d+/i;
const HOW_TO_USE_PATTERN = /\b(used? (to|for|by)|user(s)? (can|will|apply)|in use\b|to use\b|application(s)? include)\b/i;

export const COVERAGE_MODEL_VERSION = "coverage-v1.2026-08-02";

/** Compute the deterministic checklist for one solution. */
export function computeSolutionCoverage(input: CoverageInput): SolutionCoverage {
  const statement = input.solution.statement.trim();
  const technicalFacts = input.facts.filter((fact) => fact.category === "technical");
  const allFactText = input.facts.map((fact) => fact.statement).join("\n");
  const solutionAndFacts = `${statement}\n${allFactText}`;

  const dimensions: Record<CoverageDimension, CoverageEvidence> = {
    problem_articulated:
      input.linkedProblemIds.length > 0
        ? {
            status: "satisfied",
            evidence: `${input.linkedProblemIds.length} linked problem(s)`,
          }
        : { status: "gap", evidence: null },
    concept_stated:
      statement.length >= 20
        ? { status: "satisfied", evidence: "solution statement recorded" }
        : { status: "gap", evidence: null },
    structure_captured:
      input.associatedComponentNames.length > 0
        ? {
            status: "satisfied",
            evidence: `component(s): ${input.associatedComponentNames.slice(0, 5).join(", ")}`,
          }
        : { status: "gap", evidence: null },
    operation_captured:
      technicalFacts.some((fact) => OPERATION_PATTERN.test(fact.statement)) ||
      OPERATION_PATTERN.test(statement)
        ? { status: "satisfied", evidence: "operation language found in the record" }
        : { status: "gap", evidence: null },
    alternatives_captured: ALTERNATIVES_PATTERN.test(solutionAndFacts)
      ? { status: "satisfied", evidence: "alternative/variant language found in the record" }
      : { status: "gap", evidence: null },
    parameters_captured: PARAMETERS_PATTERN.test(solutionAndFacts)
      ? { status: "satisfied", evidence: "quantitative parameter language found in the record" }
      : { status: "gap", evidence: null },
    how_to_use_captured:
      HOW_TO_USE_PATTERN.test(solutionAndFacts) ||
      input.businessContext.trim().length >= 20
        ? { status: "satisfied", evidence: "how-to-use context recorded" }
        : { status: "gap", evidence: null },
  };

  const satisfiedCount = COVERAGE_DIMENSIONS.filter(
    (dimension) => dimensions[dimension].status === "satisfied",
  ).length;

  return {
    solutionId: input.solution.id,
    dimensions,
    satisfiedCount,
    totalCount: COVERAGE_DIMENSIONS.length,
  };
}

/** Aggregate meter for the ledger panel: satisfied / total across solutions. */
export function aggregateCoverage(solutions: readonly SolutionCoverage[]): {
  satisfied: number;
  total: number;
  percent: number;
} {
  const satisfied = solutions.reduce((sum, s) => sum + s.satisfiedCount, 0);
  const total = solutions.reduce((sum, s) => sum + s.totalCount, 0);
  return {
    satisfied,
    total,
    percent: total === 0 ? 0 : Math.round((satisfied / total) * 100),
  };
}
