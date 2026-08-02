import { createHash } from "node:crypto";
import type {
  AuditEvent,
  ClaimRecord,
  DeadlineObservation,
  Matter,
  MatterFact,
  MatterSource,
  ReviewDecisionRecord,
  ReviewItem,
  TeamMember,
  WorkflowRun,
  WorkProductDocument,
} from "@/lib/domain/schemas";
import type { Session } from "@/lib/adapters/types";
import { CORPUS_RELEASE } from "@/lib/knowledge";
import {
  PLAYBOOK_CHAIN_GENESIS,
  playbookContentSha256,
  playbookEntryHash,
  type PlaybookEntry,
  type StyleProfile,
} from "@/lib/domain/styles";

/**
 * SYNTHETIC demo tenant for local mode.
 *
 * Every name, invention, fact, patent number, office action, and date below
 * is FICTITIOUS and generated for demonstration. No real client, matter,
 * inventor, or Schell IP content appears here (PRD Invariant 12; hard
 * constraint: synthetic data only).
 */

export const ORG_ID = "org_demo_meridian";
export { CORPUS_RELEASE };

export const DEMO_SESSION: Session = {
  userId: "user_demo_reyes",
  displayName: "D. Reyes (synthetic practitioner)",
  email: "d.reyes@demo.invalid",
  organizationId: ORG_ID,
  organizationName: "Meridian IP Group — synthetic demo tenant",
  role: "practitioner_admin",
  synthetic: true,
};

export const DEMO_WALLET_BALANCE_USD = 74.2;

const T0 = "2026-07-06T14:00:00.000Z";
const T1 = "2026-07-21T16:30:00.000Z";
const T2 = "2026-07-30T09:15:00.000Z";

export function versionHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

export const SEED_MATTERS: Matter[] = [
  {
    id: "matter_thermal",
    organizationId: ORG_ID,
    matterNumber: "LEX-2026-0007",
    title: "Modular phase-change thermal battery for residential heat storage",
    jurisdiction: "US",
    technologyArea: "Mechanical / energy storage",
    lifecycle: "active",
    conflictTags: ["Aurora Fabrication Labs (fictitious client)"],
    synthetic: true,
    createdAt: T0,
    updatedAt: T2,
  },
  {
    id: "matter_optical",
    organizationId: ORG_ID,
    matterNumber: "LEX-2026-0003",
    title: "Self-aligning optical connector with kinematic magnet seating",
    jurisdiction: "US",
    technologyArea: "Optics / photonics packaging",
    lifecycle: "active",
    conflictTags: ["Northfield Photonics (fictitious client)"],
    synthetic: true,
    createdAt: "2026-05-11T10:00:00.000Z",
    updatedAt: T2,
  },
];

export const SEED_FACTS: MatterFact[] = [
  {
    id: "fact_t_problem",
    organizationId: ORG_ID,
    matterId: "matter_thermal",
    category: "problem",
    text: "Residential heat-pump systems shed excess midday solar generation because water tanks saturate thermally near 60 °C, wasting capturable energy.",
    provenance: "counsel_reviewed",
    sourceIds: ["src_t_disclosure"],
    contributedBy: "user_demo_reyes",
    version: 2,
    createdAt: T0,
    updatedAt: T1,
  },
  {
    id: "fact_t_solution",
    organizationId: ORG_ID,
    matterId: "matter_thermal",
    category: "solution",
    text: "Stackable cassette modules of encapsulated phase-change salt (melting point 58 °C) inserted into a shared manifold, letting capacity scale per household without replacing the tank.",
    provenance: "counsel_reviewed",
    sourceIds: ["src_t_disclosure", "src_t_interview"],
    contributedBy: "user_demo_reyes",
    version: 3,
    createdAt: T0,
    updatedAt: T1,
  },
  {
    id: "fact_t_component_manifold",
    organizationId: ORG_ID,
    matterId: "matter_thermal",
    category: "component",
    text: "Manifold plate with self-sealing quick-connect ports; ports blind-mate when a cassette is inserted at up to 4° misalignment.",
    provenance: "source_supported",
    sourceIds: ["src_t_disclosure"],
    contributedBy: "user_demo_chen",
    version: 1,
    createdAt: T0,
    updatedAt: T0,
  },
  {
    id: "fact_t_component_sensor",
    organizationId: ORG_ID,
    matterId: "matter_thermal",
    category: "component",
    text: "Per-cassette state-of-charge sensing via acoustic time-of-flight through the phase-change medium.",
    provenance: "needs_confirmation",
    sourceIds: [],
    contributedBy: "user_demo_chen",
    version: 1,
    createdAt: T1,
    updatedAt: T1,
  },
  {
    id: "fact_t_alternative",
    organizationId: ORG_ID,
    matterId: "matter_thermal",
    category: "alternative",
    text: "Alternative embodiment: paraffin-based medium (46 °C melt) for low-temperature radiant-floor systems.",
    provenance: "user_asserted",
    sourceIds: ["src_t_interview"],
    contributedBy: "user_demo_chen",
    version: 1,
    createdAt: T1,
    updatedAt: T1,
  },
  {
    id: "fact_t_advantage",
    organizationId: ORG_ID,
    matterId: "matter_thermal",
    category: "advantage",
    text: "Prototype measured 2.6× effective storage density versus a same-volume water tank across a 45–62 °C cycle (bench data, synthetic).",
    provenance: "disputed",
    sourceIds: ["src_t_benchdata"],
    contributedBy: "user_demo_chen",
    version: 2,
    createdAt: T1,
    updatedAt: T2,
  },
  {
    id: "fact_t_date",
    organizationId: ORG_ID,
    matterId: "matter_thermal",
    category: "date",
    text: "First non-confidential demonstration planned 2026-10-02 (trade show) — potential §102 clock consideration.",
    provenance: "counsel_reviewed",
    sourceIds: ["src_t_interview"],
    contributedBy: "user_demo_reyes",
    version: 1,
    createdAt: T1,
    updatedAt: T1,
  },
  {
    id: "fact_o_problem",
    organizationId: ORG_ID,
    matterId: "matter_optical",
    category: "problem",
    text: "Field-installed fiber connectors lose alignment under thermal cycling; active alignment rigs are too costly for outside-plant repair.",
    provenance: "counsel_reviewed",
    sourceIds: ["src_o_spec"],
    contributedBy: "user_demo_reyes",
    version: 1,
    createdAt: "2026-05-11T10:20:00.000Z",
    updatedAt: "2026-05-11T10:20:00.000Z",
  },
  {
    id: "fact_o_solution",
    organizationId: ORG_ID,
    matterId: "matter_optical",
    category: "solution",
    text: "Three-point kinematic seat with opposed rare-earth magnet pairs that pull the ferrule into a repeatable ±0.4 µm lateral position without tools.",
    provenance: "counsel_reviewed",
    sourceIds: ["src_o_spec"],
    contributedBy: "user_demo_reyes",
    version: 2,
    createdAt: "2026-05-11T10:20:00.000Z",
    updatedAt: T0,
  },
];

export const SEED_SOURCES: MatterSource[] = [
  {
    id: "src_t_disclosure",
    organizationId: ORG_ID,
    matterId: "matter_thermal",
    kind: "disclosure_upload",
    title: "Invention disclosure — modular thermal battery (synthetic)",
    fileName: "aurora-disclosure-v3.pdf",
    extractionState: "extracted",
    pageCount: 14,
    synthetic: true,
    uploadedBy: "user_demo_chen",
    createdAt: T0,
  },
  {
    id: "src_t_interview",
    organizationId: ORG_ID,
    matterId: "matter_thermal",
    kind: "interview_transcript",
    title: "Inventor interview transcript 2026-07-09 (synthetic)",
    fileName: "interview-2026-07-09.txt",
    extractionState: "extracted",
    pageCount: 9,
    synthetic: true,
    uploadedBy: "user_demo_reyes",
    createdAt: T0,
  },
  {
    id: "src_t_benchdata",
    organizationId: ORG_ID,
    matterId: "matter_thermal",
    kind: "reference_document",
    title: "Bench test summary — storage density (synthetic data)",
    fileName: "bench-density-summary.xlsx",
    extractionState: "extracting",
    synthetic: true,
    uploadedBy: "user_demo_chen",
    createdAt: T1,
  },
  {
    id: "src_t_priorart_a",
    organizationId: ORG_ID,
    matterId: "matter_thermal",
    kind: "prior_art_patent",
    title: "Synthetic prior-art reference A — “Latent heat storage cartridge” (fictitious US publication)",
    extractionState: "extracted",
    pageCount: 22,
    synthetic: true,
    uploadedBy: "user_demo_reyes",
    createdAt: T1,
  },
  {
    id: "src_o_spec",
    organizationId: ORG_ID,
    matterId: "matter_optical",
    kind: "disclosure_upload",
    title: "Specification as filed (synthetic)",
    fileName: "northfield-spec-filed.pdf",
    extractionState: "extracted",
    pageCount: 31,
    synthetic: true,
    uploadedBy: "user_demo_reyes",
    createdAt: "2026-05-11T10:05:00.000Z",
  },
  {
    id: "src_o_oa",
    organizationId: ORG_ID,
    matterId: "matter_optical",
    kind: "office_action",
    title: "Non-final office action, synthetic examiner packet (mailed 2026-06-24, fictitious)",
    fileName: "oa-nonfinal-2026-06-24.pdf",
    extractionState: "extracted",
    pageCount: 18,
    synthetic: true,
    uploadedBy: "user_demo_reyes",
    createdAt: "2026-06-25T13:00:00.000Z",
  },
  {
    id: "src_o_ref_b",
    organizationId: ORG_ID,
    matterId: "matter_optical",
    kind: "prior_art_patent",
    title: "Synthetic cited reference B — “Magnetically retained ferrule coupling” (fictitious)",
    extractionState: "extracted",
    pageCount: 17,
    synthetic: true,
    uploadedBy: "user_demo_reyes",
    createdAt: "2026-06-25T13:05:00.000Z",
  },
];

export const SEED_RUNS: WorkflowRun[] = [
  {
    id: "run_t_sections",
    organizationId: ORG_ID,
    matterId: "matter_thermal",
    workflowKey: "section_draft",
    workflowVersion: "section_draft@0.3.1",
    tier: "B",
    state: "COMPLETED",
    jurisdiction: "US",
    asOfDate: "2026-07-28",
    modelId: "claude-sonnet-4-5",
    modelTier: "advanced",
    corpusRelease: CORPUS_RELEASE,
    styleProfileVersion: "neutral-professional@1",
    deliverableType: "Specification sections (background, summary)",
    qualityControls: {
      sourceRequired: true,
      secondModelReview: true,
      quoteVerification: true,
    },
    estimatedChargeLowUsd: 1.86,
    estimatedChargeHighUsd: 3.87,
    actualChargeUsd: 2.41,
    requestedBy: "user_demo_reyes",
    createdAt: T1,
    updatedAt: T2,
  },
  {
    id: "run_o_oa_analysis",
    organizationId: ORG_ID,
    matterId: "matter_optical",
    workflowKey: "oa_analysis",
    workflowVersion: "oa_analysis@0.5.0",
    tier: "B",
    state: "VERIFYING",
    jurisdiction: "US",
    asOfDate: "2026-07-30",
    modelId: "gpt-5",
    modelTier: "advanced",
    corpusRelease: CORPUS_RELEASE,
    deliverableType: "Rejection matrix + response-path options",
    qualityControls: {
      sourceRequired: true,
      secondModelReview: true,
      quoteVerification: true,
    },
    estimatedChargeLowUsd: 2.1,
    estimatedChargeHighUsd: 4.4,
    requestedBy: "user_demo_reyes",
    createdAt: T2,
    updatedAt: T2,
  },
  {
    id: "run_t_memo",
    organizationId: ORG_ID,
    matterId: "matter_thermal",
    workflowKey: "research_memo",
    workflowVersion: "research_memo@0.2.0",
    tier: "B",
    state: "COMPLETED",
    jurisdiction: "US",
    asOfDate: "2026-07-15",
    modelId: "claude-opus-4-1",
    modelTier: "frontier",
    corpusRelease: CORPUS_RELEASE,
    deliverableType: "Cited research memo",
    qualityControls: {
      sourceRequired: true,
      secondModelReview: false,
      quoteVerification: true,
    },
    estimatedChargeLowUsd: 4.5,
    estimatedChargeHighUsd: 9.4,
    actualChargeUsd: 6.02,
    requestedBy: "user_demo_reyes",
    createdAt: T1,
    updatedAt: T1,
  },
  {
    id: "run_t_ids",
    organizationId: ORG_ID,
    matterId: "matter_thermal",
    workflowKey: "ids_packet",
    workflowVersion: "ids_packet@0.1.4",
    tier: "A",
    state: "QUEUED",
    jurisdiction: "US",
    asOfDate: "2026-08-01",
    modelId: "gpt-5-mini",
    modelTier: "fast",
    corpusRelease: CORPUS_RELEASE,
    deliverableType: "IDS packet (SB/08 fields)",
    qualityControls: {
      sourceRequired: true,
      secondModelReview: false,
      quoteVerification: false,
    },
    estimatedChargeLowUsd: 0.11,
    estimatedChargeHighUsd: 0.24,
    requestedBy: "user_demo_ortiz",
    createdAt: T2,
    updatedAt: T2,
  },
];

const DOC_T_SECTIONS_BODY = `The present disclosure relates to residential thermal-energy storage, and more particularly to modular latent-heat storage cassettes coupled to a shared hydronic manifold.`;

export const SEED_DOCUMENTS: WorkProductDocument[] = [
  {
    id: "doc_t_sections",
    organizationId: ORG_ID,
    matterId: "matter_thermal",
    runId: "run_t_sections",
    title: "Specification draft — Background & Summary",
    deliverableType: "Specification sections",
    tier: "B",
    reviewState: "pending_review",
    verificationState: "verified",
    modelId: "claude-sonnet-4-5",
    corpusRelease: CORPUS_RELEASE,
    version: 3,
    versionHash: versionHash("doc_t_sections@3" + DOC_T_SECTIONS_BODY),
    sections: [
      {
        heading: "Background",
        body:
          DOC_T_SECTIONS_BODY +
          " Conventional sensible-heat water storage saturates near the delivery temperature of a residential heat pump, leaving midday photovoltaic surplus uncaptured. [Drafted from approved facts fact_t_problem, fact_t_solution.]",
        flags: [],
      },
      {
        heading: "Summary",
        body: "In one aspect, a thermal storage apparatus includes a manifold plate having a plurality of self-sealing ports and a plurality of cassette modules each containing an encapsulated phase-change composition… [Drafted from approved facts; alternative paraffin embodiment NOT included — fact_t_alternative is user_asserted, not approved.]",
        flags: [
          "Gap flag: state-of-charge sensing fact (fact_t_component_sensor) is needs_confirmation — sensing limitations omitted pending confirmation.",
        ],
      },
    ],
    citations: [
      {
        id: "cit_seed_t_sections_1",
        kind: "authority",
        corpusDocumentId: "corp_usc_112",
        citation: "35 U.S.C. § 112",
        quote:
          "The specification shall contain a written description of the invention, and of the manner and process of making and using it",
        verification: "verified",
      },
      {
        id: "cit_seed_t_sections_2",
        kind: "analysis",
        citation: "Analysis (no authority quoted)",
        verification: "unverified",
        note: "Labeled analysis — scope framing of the Summary is drafting judgment, not quoted authority.",
      },
    ],
    actualChargeUsd: 2.41,
    createdAt: T2,
    updatedAt: T2,
  },
  {
    id: "doc_o_matrix",
    organizationId: ORG_ID,
    matterId: "matter_optical",
    runId: "run_o_oa_analysis",
    title: "Office-action analysis — rejection matrix (synthetic OA)",
    deliverableType: "Rejection matrix",
    tier: "B",
    reviewState: "pending_review",
    verificationState: "unverified",
    modelId: "gpt-5",
    corpusRelease: CORPUS_RELEASE,
    version: 1,
    versionHash: versionHash("doc_o_matrix@1"),
    sections: [
      {
        heading: "Rejection summary (synthetic office action)",
        body: "Claims 1–7 rejected under 35 U.S.C. §103 over synthetic reference B in view of synthetic reference C; claims 8–9 objected to as depending from a rejected base claim. Each matrix cell links to the OA page and reference passage (pinpoint cites pending verification stage).",
        flags: ["Verification stage in progress — quotes not yet verified."],
      },
      {
        heading: "Response-path options (Tier C decision support)",
        body: "Option 1: argue kinematic-seat limitation not taught (estoppel exposure: low). Option 2: amend claim 1 to recite opposed magnet pairs with three-point seat (scope narrowing; supports §112 basis at spec ¶[0042], synthetic). Option 3: interview first. Lex presents options and evidence only — the practitioner decides.",
        flags: [],
      },
    ],
    citations: [
      {
        id: "cit_seed_o_matrix_1",
        kind: "authority",
        corpusDocumentId: "corp_usc_103",
        citation: "35 U.S.C. § 103",
        quote:
          "if the differences between the claimed invention and the prior art are such that the claimed invention as a whole would have been obvious",
        verification: "unverified",
        note: "Verification stage in progress — quote not yet checked.",
      },
    ],
    createdAt: T2,
    updatedAt: T2,
  },
  {
    id: "doc_t_memo",
    organizationId: ORG_ID,
    matterId: "matter_thermal",
    runId: "run_t_memo",
    title: "Research memo — public-demonstration bar and grace period",
    deliverableType: "Cited research memo",
    tier: "B",
    reviewState: "approved",
    verificationState: "verified",
    modelId: "claude-opus-4-1",
    corpusRelease: CORPUS_RELEASE,
    version: 2,
    versionHash: versionHash("doc_t_memo@2"),
    sections: [
      {
        heading: "Question presented",
        body: "Whether the planned 2026-10-02 trade-show demonstration (fact_t_date) starts a statutory clock affecting U.S. filing strategy, as of 2026-07-15 law.",
        flags: [],
      },
      {
        heading: "Short answer (analysis)",
        body: "Labeled analysis: a public, enabling demonstration is prior art under 35 U.S.C. §102(a)(1) unless the §102(b)(1) grace period applies to inventor-originated disclosure; filing before the demonstration removes the question. Full authority quotations and pinpoint citations appear in the verified source trail of this memo.",
        flags: [],
      },
    ],
    citations: [
      {
        id: "cit_seed_t_memo_1",
        kind: "authority",
        corpusDocumentId: "corp_usc_102",
        citation: "35 U.S.C. § 102",
        quote:
          "in public use, on sale, or otherwise available to the public before the effective filing date of the claimed invention",
        verification: "verified",
      },
      {
        id: "cit_seed_t_memo_2",
        kind: "authority",
        corpusDocumentId: "corp_usc_102",
        citation: "35 U.S.C. § 102(b)(1)",
        quote:
          "A disclosure made one year or less before the effective filing date of a claimed invention shall not be prior art",
        verification: "verified",
      },
      {
        id: "cit_seed_t_memo_3",
        kind: "analysis",
        citation: "Analysis (no authority quoted)",
        verification: "unverified",
        note: "Labeled analysis — filing-before-demonstration recommendation framing is practitioner decision support.",
      },
    ],
    actualChargeUsd: 6.02,
    createdAt: T1,
    updatedAt: T2,
  },
  {
    id: "doc_t_ids",
    organizationId: ORG_ID,
    matterId: "matter_thermal",
    runId: "run_t_ids",
    title: "IDS packet draft (SB/08 field set)",
    deliverableType: "IDS packet",
    tier: "A",
    reviewState: "pending_review",
    verificationState: "unverified",
    modelId: "gpt-5-mini",
    corpusRelease: CORPUS_RELEASE,
    version: 1,
    versionHash: versionHash("doc_t_ids@1"),
    sections: [
      {
        heading: "Citations extracted",
        body: "Two synthetic references extracted from the search report; SB/08 field validation queued.",
        flags: [],
      },
    ],
    citations: [],
    createdAt: T2,
    updatedAt: T2,
  },
];

export const SEED_REVIEW_ITEMS: ReviewItem[] = [
  {
    id: "rev_t_sections",
    organizationId: ORG_ID,
    matterId: "matter_thermal",
    runId: "run_t_sections",
    documentTitle: "Specification draft — Background & Summary",
    documentVersionHash: SEED_DOCUMENTS[0].versionHash,
    tier: "B",
    state: "pending_review",
    verificationState: "verified",
    criticReportSummary:
      "Second-model critique (gpt-5): 0 unsupported legal propositions; 1 internal-consistency note (manifold port count differs between Background and Summary); 1 gap flag on sensing fact.",
    deterministicCheckFailures: 0,
    unresolvedFlags: ["Sensing fact needs confirmation before detailed description"],
    dueDate: "2026-08-08",
    createdAt: T2,
    updatedAt: T2,
  },
  {
    id: "rev_o_matrix",
    organizationId: ORG_ID,
    matterId: "matter_optical",
    runId: "run_o_oa_analysis",
    documentTitle: "OA rejection matrix + response paths (synthetic OA)",
    documentVersionHash: SEED_DOCUMENTS[1].versionHash,
    tier: "C",
    state: "pending_review",
    verificationState: "unverified",
    criticReportSummary:
      "Critique pending — verification stage still running. Response-path selection is a Tier-C practitioner decision.",
    deterministicCheckFailures: 1,
    unresolvedFlags: [
      "Deterministic check: claim 8 dependency mismatch between OA text and pending claim set",
    ],
    dueDate: "2026-08-05",
    createdAt: T2,
    updatedAt: T2,
  },
  {
    id: "rev_t_ids",
    organizationId: ORG_ID,
    matterId: "matter_thermal",
    runId: "run_t_ids",
    documentTitle: "IDS packet draft (SB/08 field set)",
    documentVersionHash: SEED_DOCUMENTS[3].versionHash,
    tier: "A",
    state: "pending_review",
    verificationState: "unverified",
    criticReportSummary: "Tier-A operator review: SB/08 field validation results attached.",
    deterministicCheckFailures: 0,
    unresolvedFlags: [],
    dueDate: "2026-08-12",
    createdAt: T2,
    updatedAt: T2,
  },
];

/**
 * Synthetic claim sets. The thermal set is a clean baseline; the optical set
 * deliberately contains a claim-8 dependency mismatch and a missing
 * antecedent so the deterministic checkers have something real to report
 * (matching the seeded review-item flag).
 */
const claim = (
  matterId: string,
  claimNumber: number,
  text: string,
  createdAt = T1,
): ClaimRecord => ({
  id: `claim_${matterId.replace("matter_", "")}_${claimNumber}`,
  organizationId: ORG_ID,
  matterId,
  claimNumber,
  text,
  version: 1,
  createdAt,
  updatedAt: createdAt,
});

export const SEED_CLAIMS: ClaimRecord[] = [
  // Thermal matter — drafted claim tree (synthetic).
  claim(
    "matter_thermal",
    1,
    "A thermal storage apparatus comprising: a manifold plate having a plurality of self-sealing ports; and a plurality of cassette modules, each cassette module containing an encapsulated phase-change composition and being insertable into a respective one of the self-sealing ports.",
  ),
  claim(
    "matter_thermal",
    2,
    "The apparatus of claim 1, wherein the encapsulated phase-change composition comprises a salt having a melting point of about 58 °C.",
  ),
  claim(
    "matter_thermal",
    3,
    "The apparatus of claim 1, wherein each self-sealing port blind-mates with a cassette module at up to 4 degrees of misalignment.",
  ),
  claim(
    "matter_thermal",
    4,
    "The apparatus of any one of claims 1-3, further comprising a sensor configured to measure a state of charge of a cassette module by acoustic time-of-flight.",
  ),
  claim(
    "matter_thermal",
    5,
    "A method of storing thermal energy, comprising: inserting a cassette module containing an encapsulated phase-change composition into a manifold plate; and circulating a heat-transfer fluid through the manifold plate.",
  ),
  claim(
    "matter_thermal",
    6,
    "The method of claim 5, wherein the inserting is performed without tools.",
  ),
  // Optical matter — pending claims as amended (synthetic), with two seeded
  // defects the deterministic checkers must catch:
  //  - claim 8 depends on claim 10, which is not in the set (dependency mismatch)
  //  - claim 7 recites "the retention magnet" with no antecedent
  claim(
    "matter_optical",
    1,
    "An optical connector comprising: a kinematic seat having three contact points; a ferrule; and a pair of opposed magnets arranged to pull the ferrule into the kinematic seat.",
    "2026-05-11T10:30:00.000Z",
  ),
  claim(
    "matter_optical",
    2,
    "The connector of claim 1, wherein the kinematic seat defines a repeatable lateral position within 0.4 micrometers.",
    "2026-05-11T10:30:00.000Z",
  ),
  claim(
    "matter_optical",
    3,
    "The connector of claim 1, wherein the opposed magnets are rare-earth magnets.",
    "2026-05-11T10:30:00.000Z",
  ),
  claim(
    "matter_optical",
    4,
    "The connector of claim 3, wherein the rare-earth magnets are axially polarized.",
    "2026-05-11T10:30:00.000Z",
  ),
  claim(
    "matter_optical",
    5,
    "The connector of claim 1, further comprising a housing enclosing the kinematic seat.",
    "2026-05-11T10:30:00.000Z",
  ),
  claim(
    "matter_optical",
    6,
    "The connector of claim 5, wherein the housing comprises a strain-relief boot.",
    "2026-05-11T10:30:00.000Z",
  ),
  claim(
    "matter_optical",
    7,
    "The connector of claim 5, wherein the retention magnet is seated in the housing.",
    "2026-05-11T10:30:00.000Z",
  ),
  claim(
    "matter_optical",
    8,
    "The connector of claim 10, wherein the ferrule is ceramic.",
    "2026-05-11T10:30:00.000Z",
  ),
  claim(
    "matter_optical",
    9,
    "A method of aligning an optical fiber, comprising seating a ferrule against a kinematic seat using a pair of opposed magnets.",
    "2026-05-11T10:30:00.000Z",
  ),
];

export const SEED_DEADLINES: DeadlineObservation[] = [
  {
    id: "ddl_o_oa",
    organizationId: ORG_ID,
    matterId: "matter_optical",
    label:
      "Synthetic non-final OA (mailed 2026-06-24): 3-month statutory window observed → 2026-09-24",
    observedDate: "2026-09-24",
    windowKind: "OA response (3-month, extendable)",
    disclaimerRequired: true,
    createdAt: "2026-06-25T13:10:00.000Z",
  },
  {
    id: "ddl_t_show",
    organizationId: ORG_ID,
    matterId: "matter_thermal",
    label:
      "Planned public demonstration 2026-10-02 — file before public disclosure per approved strategy",
    observedDate: "2026-10-02",
    windowKind: "Pre-disclosure filing target",
    disclaimerRequired: true,
    createdAt: T1,
  },
];

export const SEED_AUDIT_EVENTS: AuditEvent[] = [
  {
    id: "aud_1",
    organizationId: ORG_ID,
    matterId: "matter_thermal",
    actorUserId: "user_demo_reyes",
    actorRole: "practitioner_admin",
    action: "facts.approve",
    subjectType: "matter_fact",
    subjectId: "fact_t_problem",
    detail: "Fact baseline approval (problem statement) — provenance → counsel_reviewed",
    createdAt: T1,
  },
  {
    id: "aud_2",
    organizationId: ORG_ID,
    matterId: "matter_thermal",
    actorUserId: "user_demo_reyes",
    actorRole: "practitioner_admin",
    action: "review.decide",
    subjectType: "review_item",
    subjectId: "doc_t_memo",
    detail: "Approved research memo v2 (hash-locked)",
    createdAt: T2,
  },
  {
    id: "aud_3",
    organizationId: ORG_ID,
    matterId: "matter_optical",
    actorUserId: "user_demo_reyes",
    actorRole: "practitioner_admin",
    action: "run.create",
    subjectType: "workflow_run",
    subjectId: "run_o_oa_analysis",
    detail: "OA analysis run started (gpt-5, corpus-2026.07.2, est. $2.10–$4.40)",
    createdAt: T2,
  },
];

export const SEED_DECISIONS: ReviewDecisionRecord[] = [
  {
    id: "dec_t_memo",
    organizationId: ORG_ID,
    reviewItemId: "rev_t_memo_archived",
    decision: "approve",
    note: "Memo verified; source trail reproduced.",
    actorUserId: "user_demo_reyes",
    actorRole: "practitioner_admin",
    documentVersionHash: SEED_DOCUMENTS[2].versionHash,
    decidedAt: T2,
  },
];

// ---------------------------------------------------------------------------
// Style profiles + playbook (PRD §5.4). The neutral professional profile is
// the platform default; the firm profile is a synthetic tenant customization.
// Playbook entries form a valid hash chain computed with the domain
// functions so chain verification is real, not asserted.
// ---------------------------------------------------------------------------

export const SEED_STYLE_PROFILES: StyleProfile[] = [
  {
    id: "style_neutral",
    organizationId: ORG_ID,
    name: "neutral-professional",
    kind: "application_drafting",
    rules: [
      "Prefer 'configured to' over means-plus-function phrasing unless §112(f) treatment is intended.",
      "Introduce every claim element in the specification before first claim use.",
      "One embodiment per paragraph in the detailed description; alternatives follow the primary embodiment.",
      "State advantages as technical effects tied to structure, never as marketing claims.",
    ],
    version: 1,
    platformDefault: true,
    createdBy: "platform",
    createdAt: T0,
    updatedAt: T0,
  },
  {
    id: "style_meridian_search",
    organizationId: ORG_ID,
    name: "meridian-search-report",
    kind: "search_report",
    rules: [
      "Lead with the claim-element table; narrative discussion follows the table.",
      "Every reference characterization links a pinpoint citation to the reference text.",
      "Close with a 'gaps in the record' section listing unsearched classifications.",
    ],
    version: 1,
    platformDefault: false,
    createdBy: "user_demo_reyes",
    createdAt: T1,
    updatedAt: T1,
  },
];

const seedPlaybookEntry = (
  id: string,
  prevEntryHash: string,
  title: string,
  category: PlaybookEntry["category"],
  body: string,
  publishedAt: string,
): PlaybookEntry => {
  const base = {
    id,
    organizationId: ORG_ID,
    title,
    category,
    body,
    publishedBy: "user_demo_reyes",
    publishedByRole: "practitioner_admin" as const,
    publishedAt,
    prevEntryHash,
  };
  const contentSha256 = playbookContentSha256(base);
  const entryHash = playbookEntryHash({ ...base, contentSha256 });
  return { ...base, contentSha256, entryHash };
};

const pb1 = seedPlaybookEntry(
  "pb_seed_1",
  PLAYBOOK_CHAIN_GENESIS,
  "Predictable-results rebuttal frame (synthetic)",
  "approved_argument",
  "When the examiner combines references under a predictable-results rationale, require an articulated reason the skilled artisan would select THESE elements — attack the selection, not the combination mechanics. Synthetic demonstration content.",
  T1,
);
const pb2 = seedPlaybookEntry(
  "pb_seed_2",
  pb1.entryHash,
  "Cassette-interface claim skeleton (synthetic)",
  "claim_structure",
  "Independent claim recites the interface geometry; dependent tier 1 adds the sealing mechanism; dependent tier 2 adds sensing. Keeps the fallback ladder aligned with the planned-retreat hierarchy. Synthetic demonstration content.",
  T2,
);

export const SEED_PLAYBOOK_ENTRIES: PlaybookEntry[] = [pb1, pb2];

// ---------------------------------------------------------------------------
// Team roster (FR-2). Synthetic seats covering the professional-lane roles;
// invitations/email are approval-gated and not simulated.
// ---------------------------------------------------------------------------

export const SEED_TEAM: TeamMember[] = [
  {
    userId: "user_demo_reyes",
    organizationId: ORG_ID,
    displayName: "D. Reyes (synthetic practitioner)",
    email: "d.reyes@demo.invalid",
    role: "practitioner_admin",
    mfaEnrolled: true,
    joinedAt: T0,
  },
  {
    userId: "user_demo_okafor",
    organizationId: ORG_ID,
    displayName: "A. Okafor (synthetic practitioner)",
    email: "a.okafor@demo.invalid",
    role: "practitioner",
    mfaEnrolled: true,
    joinedAt: T0,
  },
  {
    userId: "user_demo_ortiz",
    organizationId: ORG_ID,
    displayName: "M. Ortiz (synthetic agent/paralegal)",
    email: "m.ortiz@demo.invalid",
    role: "agent_operator",
    mfaEnrolled: false,
    joinedAt: T1,
  },
  {
    userId: "user_demo_chen",
    organizationId: ORG_ID,
    displayName: "L. Chen (synthetic R&D contributor)",
    email: "l.chen@demo.invalid",
    role: "contributor",
    mfaEnrolled: false,
    joinedAt: T1,
  },
  {
    userId: "user_demo_voss",
    organizationId: ORG_ID,
    displayName: "K. Voss (synthetic viewer seat)",
    email: "k.voss@demo.invalid",
    role: "viewer",
    mfaEnrolled: false,
    joinedAt: T2,
  },
];
