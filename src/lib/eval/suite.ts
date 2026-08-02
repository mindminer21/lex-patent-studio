import type { BenchmarkQuestion } from "./types";

/**
 * Smoke benchmark subset (PRD §14) — versioned platform artifact.
 *
 * Every question here is SYNTHETIC and machine-seeded: validation.status is
 * "machine_seeded_pending" until a qualified practitioner validates the
 * question, source keys, and rubric (approval gate §20.12 per workflow).
 * NO public quality claim may cite these results until then.
 */

export const SMOKE_SUITE_VERSION = "smoke-0.1.0";

const PENDING = { status: "machine_seeded_pending" as const };

export const SMOKE_SUITE: BenchmarkQuestion[] = [
  {
    id: "smk_retrieval_103",
    suiteVersion: SMOKE_SUITE_VERSION,
    domain: "prosecution",
    dimension: "retrieval_correctness",
    question:
      "When are differences over the prior art obvious to a person having ordinary skill before the effective filing date?",
    jurisdiction: "US",
    asOfDate: "2026-08-01",
    expectedSourceKeys: ["corp_usc_103"],
    validation: PENDING,
  },
  {
    id: "smk_retrieval_112",
    suiteVersion: SMOKE_SUITE_VERSION,
    domain: "drafting",
    dimension: "retrieval_correctness",
    question: "What must the specification contain to enable and describe the invention?",
    jurisdiction: "US",
    asOfDate: "2026-08-01",
    expectedSourceKeys: ["corp_usc_112"],
    validation: PENDING,
  },
  {
    id: "smk_retrieval_ids_timing",
    suiteVersion: SMOKE_SUITE_VERSION,
    domain: "prosecution",
    dimension: "retrieval_correctness",
    question: "Within what period must an information disclosure statement be filed to be considered?",
    jurisdiction: "US",
    asOfDate: "2026-08-01",
    expectedSourceKeys: ["corp_cfr_197"],
    validation: PENDING,
  },
  {
    id: "smk_supersession_current",
    suiteVersion: SMOKE_SUITE_VERSION,
    domain: "prosecution",
    dimension: "supersession_handling",
    question: "prima facie obviousness rationales",
    jurisdiction: "US",
    asOfDate: "2026-08-01",
    expectedSourceKeys: ["corp_mpep_2143"],
    forbiddenSourceKeys: ["corp_mpep_2143_e8"],
    validation: PENDING,
  },
  {
    id: "smk_supersession_pointintime",
    suiteVersion: SMOKE_SUITE_VERSION,
    domain: "prosecution",
    dimension: "supersession_handling",
    question: "prima facie obviousness rationales",
    jurisdiction: "US",
    asOfDate: "2013-01-15",
    expectedSourceKeys: ["corp_mpep_2143_e8"],
    forbiddenSourceKeys: ["corp_mpep_2143"],
    validation: PENDING,
  },
  {
    id: "smk_license_gate",
    suiteVersion: SMOKE_SUITE_VERSION,
    domain: "drafting",
    dimension: "retrieval_correctness",
    question: "content withheld license-cleared treatise",
    jurisdiction: "US",
    asOfDate: "2026-08-01",
    expectedSourceKeys: [],
    forbiddenSourceKeys: ["corp_treatise_ch4", "corp_cle_seminar"],
    validation: PENDING,
  },
  {
    id: "smk_quote_fidelity_pass",
    suiteVersion: SMOKE_SUITE_VERSION,
    domain: "drafting",
    dimension: "quotation_fidelity",
    question: "Verbatim §112(b) quotation must verify.",
    jurisdiction: "US",
    asOfDate: "2026-08-01",
    expectedSourceKeys: ["corp_usc_112"],
    verbatimQuote:
      "particularly pointing out and distinctly claiming the subject matter",
    validation: PENDING,
  },
  {
    id: "smk_quote_fidelity_tamper",
    suiteVersion: SMOKE_SUITE_VERSION,
    domain: "drafting",
    dimension: "quotation_fidelity",
    question: "A tampered quotation must fail verification.",
    jurisdiction: "US",
    asOfDate: "2026-08-01",
    expectedSourceKeys: ["corp_usc_112"],
    tamperedQuote:
      "particularly pointing out and BROADLY claiming the subject matter",
    validation: PENDING,
  },
  {
    id: "smk_refusal",
    suiteVersion: SMOKE_SUITE_VERSION,
    domain: "litigation",
    dimension: "refusal_to_guess",
    question: "zymurgy quantum basketweaving jurisprudence doctrine",
    jurisdiction: "US",
    asOfDate: "2026-08-01",
    expectedSourceKeys: [],
    expectRefusal: true,
    validation: PENDING,
  },
  {
    id: "smk_claim_scope",
    suiteVersion: SMOKE_SUITE_VERSION,
    domain: "drafting",
    dimension: "claim_scope_preservation",
    question:
      "Deterministic checkers must flag a dependency on a missing claim and an unsupported numeral.",
    jurisdiction: "US",
    asOfDate: "2026-08-01",
    expectedSourceKeys: [],
    validation: PENDING,
  },
  {
    id: "smk_cross_matter",
    suiteVersion: SMOKE_SUITE_VERSION,
    domain: "prosecution",
    dimension: "cross_matter_leakage",
    question:
      "Chat threads, facts, and documents of one matter/tenant must be invisible from another.",
    jurisdiction: "US",
    asOfDate: "2026-08-01",
    expectedSourceKeys: [],
    validation: PENDING,
  },
];
