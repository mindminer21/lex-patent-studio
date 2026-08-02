/**
 * Evaluation harness types (PRD §14). The internal 400-question benchmark
 * architecture becomes the product's release-gate system:
 *
 *  - Benchmark questions are versioned platform artifacts with rubric
 *    dimensions and source keys into the corpus registry.
 *  - Machine-seeded questions are labeled PENDING until a qualified
 *    practitioner validates question, source keys, and rubric. Public
 *    quality claims may cite attorney-validated results ONLY.
 *  - The smoke subset runs in CI (vitest) against the local knowledge
 *    system; the full suite gates production releases.
 */

export const BENCHMARK_DOMAINS = [
  "prosecution",
  "drafting",
  "ptab",
  "litigation",
  "pct_epo",
  "design",
] as const;
export type BenchmarkDomain = (typeof BENCHMARK_DOMAINS)[number];

export const RUBRIC_DIMENSIONS = [
  "retrieval_correctness",
  "supersession_handling",
  "quotation_fidelity",
  "refusal_to_guess",
  "cross_matter_leakage",
  "claim_scope_preservation",
  "deadline_identification",
] as const;
export type RubricDimension = (typeof RUBRIC_DIMENSIONS)[number];

export type ValidationStatus = "machine_seeded_pending" | "attorney_validated";

export interface BenchmarkQuestion {
  id: string;
  suiteVersion: string;
  domain: BenchmarkDomain;
  dimension: RubricDimension;
  question: string;
  jurisdiction: "US";
  asOfDate: string;
  /** Corpus registry keys the correct answer must ground in. */
  expectedSourceKeys: string[];
  /** Registry keys that MUST NOT appear (supersession / license gating). */
  forbiddenSourceKeys?: string[];
  /** The correct behavior is an explicit refusal (insufficient record). */
  expectRefusal?: boolean;
  /** Verbatim quote that must verify against the first expected source. */
  verbatimQuote?: string;
  /** Tampered quote that must FAIL verification. */
  tamperedQuote?: string;
  validation: {
    status: ValidationStatus;
    validatedBy?: string;
    validatedAt?: string;
  };
}

export interface QuestionResult {
  questionId: string;
  dimension: RubricDimension;
  passed: boolean;
  detail: string;
}

export interface SuiteRunReport {
  suiteVersion: string;
  corpusRelease: string;
  ranAt: string;
  total: number;
  passed: number;
  failed: number;
  byDimension: Record<string, { total: number; passed: number }>;
  results: QuestionResult[];
  /** §14: cross-matter leakage must be ZERO for any release. */
  crossMatterLeakageZero: boolean;
  /** Attorney-validated share — public claims may cite only that subset. */
  attorneyValidatedCount: number;
}
