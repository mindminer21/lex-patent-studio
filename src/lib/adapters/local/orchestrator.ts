import { createHash } from "node:crypto";
import {
  checkAntecedentBasis,
  checkClaimDependencies,
  checkNumeralConsistency,
  checkSb08,
  checkSectionCompleteness,
  summarizeFindings,
  type CheckFinding,
  type CompletenessProfileKey,
  type Sb08Row,
} from "@/lib/domain/checks";
import { isDraftableProvenance } from "@/lib/domain/provenance";
import { pickCriticModel } from "@/lib/domain/pricing";
import type { Role } from "@/lib/domain/roles";
import {
  searchCorpus,
  verifyCitationSet,
  QUOTE_VERIFIER,
  QUOTE_VERIFIER_VERSION,
  getRegistryEntry,
  type CorpusCollection,
} from "@/lib/knowledge";
import type { WorkflowKey } from "@/lib/domain/tiers";
import {
  nextRunStage,
  RUN_PIPELINE,
  transitionRun,
  isTerminalRunState,
  type RunState,
} from "@/lib/domain/run-state";
import type {
  ReviewItem,
  RunStageCheckpoint,
  WalletReservation,
  WorkflowRun,
  WorkProductDocument,
} from "@/lib/domain/schemas";
import { appendAudit, newId, type LocalStore, type RunPlan } from "./store";

/**
 * SIMULATED run orchestrator (local mode) — walks the FR-7 state machine
 *
 *   QUEUED → INGESTING → RETRIEVING → GENERATING → VERIFYING → RENDERING
 *          → COMPLETED | FAILED | CANCELLED
 *
 * with per-stage checkpoints, deterministic simulated timing, deterministic
 * synthetic outputs (clearly labeled SIMULATED), and reservation → settlement
 * against the wallet. No provider is called; no charge is real.
 *
 * Advancement is LAZY and deterministic: the pipeline position is a pure
 * function of (plan, now). Reading a run advances it to where the clock says
 * it should be, materializing stage checkpoints with exact timestamps —
 * which makes the orchestrator fully unit-testable without timers.
 */

/** Simulated per-stage durations (ms). */
export const STAGE_DURATIONS_MS: Record<string, number> = {
  QUEUED: 1_500,
  INGESTING: 2_500,
  RETRIEVING: 3_500,
  GENERATING: 6_000,
  VERIFYING: 3_500,
  RENDERING: 2_500,
};

/** Billing rule: only a successful GENERATING stage settles a charge. */
const BILLABLE_STAGE: RunState = "GENERATING";

export interface StartPlanInput {
  run: WorkflowRun;
  heldUsd: number;
  expectedUsd: number;
  failAtStage?: RunState;
  tamperQuote?: boolean;
  now?: number;
}

/** Reserve the wallet hold and register the simulated pipeline plan. */
export function startRunPlan(store: LocalStore, input: StartPlanInput): RunPlan {
  const now = input.now ?? Date.now();
  const startedAt = new Date(now).toISOString();

  const plan: RunPlan = {
    runId: input.run.id,
    startedAt,
    stageDurationsMs: { ...STAGE_DURATIONS_MS },
    failAtStage: input.failAtStage,
    tamperQuote: input.tamperQuote,
    heldUsd: input.expectedUsd > input.heldUsd ? input.expectedUsd : input.heldUsd,
    expectedUsd: input.expectedUsd,
  };
  store.runPlans.push(plan);

  // Reservation BEFORE run (FR-9): hold the high end of the estimate.
  store.walletBalanceUsd = round2(store.walletBalanceUsd - plan.heldUsd);
  const reservation: WalletReservation = {
    id: newId("resv"),
    organizationId: input.run.organizationId,
    runId: input.run.id,
    heldUsd: plan.heldUsd,
    state: "held",
    createdAt: startedAt,
    updatedAt: startedAt,
  };
  store.reservations.push(reservation);

  store.runStages.push({
    id: newId("stg"),
    organizationId: input.run.organizationId,
    runId: input.run.id,
    stage: "QUEUED",
    enteredAt: startedAt,
    billable: false,
    detail: "Run accepted; wallet reservation held. SIMULATED pipeline (local mode).",
  });
  return plan;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function getPlan(store: LocalStore, runId: string): RunPlan | undefined {
  return store.runPlans.find((p) => p.runId === runId);
}

function getReservation(store: LocalStore, runId: string): WalletReservation | undefined {
  return store.reservations.find((r) => r.runId === runId);
}

function stageWindow(
  plan: RunPlan,
  stage: RunState,
): { startMs: number; endMs: number } {
  let cursor = 0;
  for (const s of RUN_PIPELINE) {
    const dur = plan.stageDurationsMs[s] ?? STAGE_DURATIONS_MS[s] ?? 2_000;
    if (s === stage) return { startMs: cursor, endMs: cursor + dur };
    cursor += dur;
  }
  return { startMs: cursor, endMs: cursor };
}

function isoAt(plan: RunPlan, offsetMs: number): string {
  return new Date(Date.parse(plan.startedAt) + offsetMs).toISOString();
}

function openStage(
  store: LocalStore,
  run: WorkflowRun,
  stage: RunState,
  enteredAtIso: string,
): RunStageCheckpoint {
  const checkpoint: RunStageCheckpoint = {
    id: newId("stg"),
    organizationId: run.organizationId,
    runId: run.id,
    stage,
    enteredAt: enteredAtIso,
    billable: stage === BILLABLE_STAGE,
    billableOutcome: stage === BILLABLE_STAGE ? "committed" : undefined,
    detail:
      stage === BILLABLE_STAGE
        ? "SIMULATED generation call committed (checkpoint recorded before the billable call; a retry consults this outcome and never re-issues blindly)."
        : `SIMULATED ${stage.toLowerCase()} stage.`,
  };
  store.runStages.push(checkpoint);
  return checkpoint;
}

function currentStageCheckpoint(
  store: LocalStore,
  runId: string,
  stage: RunState,
): RunStageCheckpoint | undefined {
  return [...store.runStages]
    .reverse()
    .find((s) => s.runId === runId && s.stage === stage);
}

function settle(
  store: LocalStore,
  run: WorkflowRun,
  outcome: "completed" | "failed" | "cancelled",
  atIso: string,
): void {
  const plan = getPlan(store, run.id);
  const reservation = getReservation(store, run.id);
  if (!plan || !reservation || reservation.state !== "held") return;

  const generating = currentStageCheckpoint(store, run.id, BILLABLE_STAGE);
  const generationSucceeded = generating?.billableOutcome === "succeeded";

  if (outcome === "completed" || generationSucceeded) {
    // The billable call happened: settle actual, return the remainder.
    const actual = Math.min(plan.expectedUsd, reservation.heldUsd);
    reservation.state = "settled";
    reservation.settledUsd = actual;
    store.walletBalanceUsd = round2(store.walletBalanceUsd + reservation.heldUsd - actual);
    run.actualChargeUsd = actual;
  } else {
    // No successful billable call: release the full hold, charge nothing.
    reservation.state = "released";
    store.walletBalanceUsd = round2(store.walletBalanceUsd + reservation.heldUsd);
  }
  reservation.updatedAt = atIso;
}

/**
 * Advance one run to where the simulated clock says it should be.
 * Deterministic: same (store-state, now) → same result.
 */
export function advanceRun(store: LocalStore, runId: string, now = Date.now()): void {
  const run = store.runs.find((r) => r.id === runId);
  const plan = run && getPlan(store, runId);
  if (!run || !plan || isTerminalRunState(run.state)) return;

  const elapsed = now - Date.parse(plan.startedAt);

  // Walk stage boundaries one legal transition at a time.
  for (;;) {
    const window = stageWindow(plan, run.state);
    if (elapsed < window.endMs) break; // still inside the current stage

    const boundaryIso = isoAt(plan, window.endMs);
    const checkpoint = currentStageCheckpoint(store, run.id, run.state);
    if (checkpoint && !checkpoint.completedAt) {
      checkpoint.completedAt = boundaryIso;
      if (checkpoint.billable) {
        checkpoint.billableOutcome =
          plan.failAtStage === run.state ? "failed" : "succeeded";
      }
    }

    if (plan.failAtStage === run.state) {
      run.state = transitionRun(run.state, "FAILED");
      run.updatedAt = boundaryIso;
      settle(store, run, "failed", boundaryIso);
      appendAudit(store, {
        organizationId: run.organizationId,
        matterId: run.matterId,
        actorUserId: "system:orchestrator",
        action: "run.failed",
        subjectType: "workflow_run",
        subjectId: run.id,
        detail: `SIMULATED failure injected at ${plan.failAtStage}. Reservation ${run.actualChargeUsd != null ? "settled" : "released"}.`,
      });
      return;
    }

    const next = nextRunStage(run.state);
    if (!next) return;
    run.state = transitionRun(run.state, next);
    run.updatedAt = boundaryIso;

    if (next === "COMPLETED") {
      settle(store, run, "completed", boundaryIso);
      finalizeRunOutputs(store, run, boundaryIso);
      appendAudit(store, {
        organizationId: run.organizationId,
        matterId: run.matterId,
        actorUserId: "system:orchestrator",
        action: "run.completed",
        subjectType: "workflow_run",
        subjectId: run.id,
        detail: `SIMULATED run completed; charge settled at $${(run.actualChargeUsd ?? 0).toFixed(2)} (reservation remainder returned). Output entered the Tier-${run.tier} review queue as DRAFT — NOT REVIEWED.`,
      });
      return;
    }
    openStage(store, run, next, boundaryIso);
  }
}

/** Advance every non-terminal planned run (used by list endpoints/UI). */
export function advanceAllRuns(store: LocalStore, now = Date.now()): void {
  for (const plan of store.runPlans) advanceRun(store, plan.runId, now);
}

/**
 * Cancel a run (POST /api/runs/:id/cancel). Human-initiated only; the
 * orchestrator never cancels on model output. Settlement rule: a successful
 * billable call settles; otherwise the hold is fully released.
 */
export function cancelRun(
  store: LocalStore,
  organizationId: string,
  runId: string,
  actor: { userId: string; role: Role },
  now = Date.now(),
): { ok: true; run: WorkflowRun } | { ok: false; error: string } {
  advanceRun(store, runId, now);
  const run = store.runs.find(
    (r) => r.organizationId === organizationId && r.id === runId,
  );
  if (!run) return { ok: false, error: "Run not found." };
  if (isTerminalRunState(run.state)) {
    return { ok: false, error: `Run is already ${run.state}.` };
  }

  const atIso = new Date(now).toISOString();
  const checkpoint = currentStageCheckpoint(store, runId, run.state);
  if (checkpoint && !checkpoint.completedAt) {
    checkpoint.completedAt = atIso;
    checkpoint.detail = `${checkpoint.detail ?? ""} Cancelled by user before stage completion.`.trim();
    if (checkpoint.billable && checkpoint.billableOutcome === "committed") {
      // FR-7: never leave a billable call with unknown outcome. In the
      // simulation a cancelled in-flight generation resolves to "failed"
      // (not charged); production would reconcile with the provider first.
      checkpoint.billableOutcome = "failed";
    }
  }

  run.state = transitionRun(run.state, "CANCELLED");
  run.updatedAt = atIso;
  settle(store, run, "cancelled", atIso);

  appendAudit(store, {
    organizationId,
    matterId: run.matterId,
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: "run.cancel",
    subjectType: "workflow_run",
    subjectId: run.id,
    detail: `Run cancelled by user. ${run.actualChargeUsd != null ? `Settled $${run.actualChargeUsd.toFixed(2)} for the completed generation stage.` : "Reservation fully released; no charge."}`,
  });
  return { ok: true, run };
}

// ---------------------------------------------------------------------------
// Deterministic synthetic outputs
// ---------------------------------------------------------------------------

const SIMULATED_BANNER =
  "SIMULATED OUTPUT — generated by the local-mode orchestrator without any model call. Synthetic demonstration content only.";

function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function findingFlags(findings: CheckFinding[]): string[] {
  return findings.map(
    (f) =>
      `${f.severity === "error" ? "Check failed" : "Check warning"} [${f.code}] claim ${f.claimNumber}: ${f.message}`,
  );
}

/**
 * Retrieval query per workflow (local mode): drives the REAL corpus search
 * so the evidence set, citations, and verifier results are genuine outputs
 * of the FR-5 retrieval protocol, not hard-coded strings.
 */
const WORKFLOW_RETRIEVAL: Partial<
  Record<WorkflowKey, { query: string; collection?: CorpusCollection }>
> = {
  section_draft: {
    query: "written description enable specification claims invention",
    collection: "drafting",
  },
  claim_tree_draft: {
    query: "particularly pointing out distinctly claiming reasonable certainty",
  },
  dependent_claim_draft: {
    query: "particularly pointing out distinctly claiming subject matter",
  },
  oa_analysis: {
    query: "obvious effective filing date prima facie rationales predictable results",
    collection: "prosecution",
  },
  oa_response_draft: {
    query: "obvious rational underpinning conclusory prima facie",
    collection: "prosecution",
  },
  research_memo: {
    query: "public use printed publication grace period disclosure inventor",
  },
  ids_packet: {
    query: "information disclosure statement three months material patentability",
    collection: "prosecution",
  },
  search_report: {
    query: "kinematic mount magnets seats repeatable prior art",
  },
  response_path_options: {
    query: "obvious combination familiar elements predictable results",
  },
};

const DEFAULT_RETRIEVAL_QUERY =
  "specification claims obviousness disclosure";

/**
 * Build the run's evidence set by executing the retrieval protocol, then
 * derive citations whose quotations are VERBATIM excerpts of retrieved
 * section text (so the verifier has something real to verify).
 */
function buildEvidenceCitations(
  run: WorkflowRun,
  tamperQuote: boolean,
): WorkProductDocument["citations"] {
  const spec = WORKFLOW_RETRIEVAL[run.workflowKey];
  const search = searchCorpus({
    query: spec?.query ?? DEFAULT_RETRIEVAL_QUERY,
    jurisdiction: "US",
    asOfDate: run.asOfDate,
    collection: spec?.collection,
    limit: 4,
  });

  const citations: WorkProductDocument["citations"] = [];
  search.hits.forEach((hit, i) => {
    const doc = getRegistryEntry(hit.documentId);
    const section = doc?.sections.find((s) => s.id === hit.sectionId);
    if (!doc || !section) return;
    // Verbatim excerpt: slice at a word boundary, ≥ verifier minimum length.
    let quote = section.text.slice(0, 160);
    const lastSpace = quote.lastIndexOf(" ");
    if (lastSpace > 40) quote = quote.slice(0, lastSpace);
    if (tamperQuote && i === 0) {
      // Deterministic verifier-failure injection (local mode only).
      quote = quote.replace(/\b(\w+)\b/, "TAMPERED-$1");
    }
    citations.push({
      id: `cit_${run.id}_${i + 1}`,
      kind: "authority",
      corpusDocumentId: hit.documentId,
      citation: hit.citation,
      quote,
      verification: "unverified",
      note: hit.authorityNote ?? hit.supersessionNote,
    });
  });
  return citations;
}

interface CheckResultLike {
  checker: string;
  checkerVersion: string;
  passed: boolean;
  findings: CheckFinding[];
}

type DocSection = WorkProductDocument["sections"][number];
type FactLike = { id: string; category: string; text: string };
type ClaimLike = { claimNumber: number; text: string };

const S = (heading: string, body: string, flags: string[] = []): DocSection => ({
  heading,
  body,
  flags,
});

const factsFor = (facts: FactLike[], categories: string[]): string =>
  facts
    .filter((f) => categories.includes(f.category))
    .map((f) => `${f.text} [${f.id}]`)
    .join(" ") || "No approved facts in this category — flagged as a gap, not filled.";

/**
 * Deliverable body per workflow. Bodies draw ONLY on approved facts; the
 * section-completeness checker runs over exactly these sections.
 */
function buildDeliverableSections(
  run: WorkflowRun,
  approved: FactLike[],
  claims: ClaimLike[],
): DocSection[] {
  const sim = "[SIMULATED — local mode, no model call]";
  switch (run.workflowKey) {
    case "section_draft":
      return [
        S("Background", `${sim} ${factsFor(approved, ["problem"])}`),
        S("Summary", `${sim} ${factsFor(approved, ["solution", "advantage"])}`),
        S(
          "Detailed description",
          `${sim} ${factsFor(approved, ["component", "step", "alternative"])}`,
        ),
        S(
          "Abstract",
          `${sim} Condensed statement of the approved solution facts for filing-format purposes (150-word limit enforced at export).`,
        ),
      ];
    case "research_memo":
      return [
        S(
          "Question presented",
          `${sim} Question derived from the approved date/problem facts: ${factsFor(approved, ["date", "problem"])}`,
        ),
        S(
          "Short answer (analysis)",
          `${sim} Labeled analysis grounded in the verified evidence set below; where the record is insufficient the memo says so instead of guessing.`,
        ),
        S(
          "Source trail",
          `${sim} Full authority list with verification states appears in "Authority relied upon (evidence set)" — every quotation passed or failed the verifier explicitly.`,
        ),
      ];
    case "oa_response_draft":
      return [
        S(
          "Amendments to the claims",
          `${sim} Claim 1 (currently amended): markup follows MPEP conventions — underline additions, [[double-bracket]] deletions. Amendment text carries no advocacy; it is mechanically separate from the remarks section.`,
        ),
        S(
          "Remarks",
          `${sim} Response positions keyed to the rejection matrix; each contention cites the evidence set and estoppel-sensitive statements are flagged for practitioner judgment.`,
        ),
      ];
    case "oa_analysis":
      return [
        S(
          "Rejection matrix (simulated)",
          `${sim} Claim × statute × reference grid over the matter's ${claims.length} pending claim(s); every cell links to OA page and reference passage in production.`,
        ),
        S(
          "Response-path options (Tier C decision support)",
          `${sim} Options with tradeoff and estoppel flags only — the practitioner decides; Lex never styles a recommendation as the decision.`,
        ),
      ];
    case "ids_packet":
      return [
        S(
          "Citations extracted (SB/08 rows)",
          `${sim} Rows derived from the matter's prior-art and reference sources; SB/08 field validation results above list every missing or malformed field.`,
        ),
      ];
    default:
      return [
        S(
          `${run.deliverableType} (simulated body)`,
          `${sim} Deterministic placeholder body for "${run.deliverableType}" via the ${run.workflowKey} workflow, drawn from approved facts only.`,
        ),
      ];
  }
}

/**
 * Derive SB/08 rows from the matter's sources. Missing bibliographic fields
 * produce REAL findings — an IDS prepared from unextracted references must
 * flag its gaps rather than autofill them.
 */
function buildSb08Rows(store: LocalStore, run: WorkflowRun): Sb08Row[] {
  const sources = store.sources.filter(
    (s) => s.organizationId === run.organizationId && s.matterId === run.matterId,
  );
  const rows: Sb08Row[] = [];
  let rowNumber = 0;
  for (const source of sources) {
    if (source.kind === "prior_art_patent") {
      rowNumber += 1;
      const numberMatch = source.title.match(/US\s?([\d,]{7,10})/i);
      const dateMatch = source.title.match(/\b(\d{4}-\d{2}-\d{2})\b/);
      rows.push({
        row: rowNumber,
        kind: "us_patent",
        citeNumber: numberMatch?.[1],
        date: dateMatch?.[1],
        name: undefined, // patentee extraction pending (real gap → real finding)
      });
    } else if (source.kind === "reference_document" || source.kind === "search_result") {
      rowNumber += 1;
      rows.push({ row: rowNumber, kind: "npl", description: source.title });
    }
  }
  return rows;
}

/**
 * Build the deterministic synthetic work product for a completed run and
 * register it plus its review-queue item. Model/system actors NEVER set
 * review state: the item enters pending_review and stays there until an
 * authenticated human decides (Invariant 16).
 */
function finalizeRunOutputs(store: LocalStore, run: WorkflowRun, atIso: string): void {
  const facts = store.facts.filter(
    (f) => f.organizationId === run.organizationId && f.matterId === run.matterId,
  );
  const approved = facts.filter((f) => isDraftableProvenance(f.provenance));
  const unapprovedCount = facts.length - approved.length;
  const claims = store.claims
    .filter((c) => c.organizationId === run.organizationId && c.matterId === run.matterId)
    .sort((a, b) => a.claimNumber - b.claimNumber);

  const sections: WorkProductDocument["sections"] = [
    {
      heading: "About this output",
      body: `${SIMULATED_BANNER} Workflow ${run.workflowVersion}, model ${run.modelId} (simulated), corpus ${run.corpusRelease}, jurisdiction ${run.jurisdiction} as of ${run.asOfDate}.`,
      flags: [],
    },
  ];

  let checkErrorCount = 0;
  const unresolvedFlags: string[] = [];
  const checkResults: CheckResultLike[] = [];

  const isClaimWorkflow =
    run.workflowKey === "claim_tree_draft" || run.workflowKey === "dependent_claim_draft";

  // Deliverable body sections BEFORE the checker stage so the section-
  // completeness checker runs over what the draft actually contains.
  const deliverableSections = buildDeliverableSections(run, approved, claims);
  const claimInputs = claims.map((c) => ({ number: c.claimNumber, text: c.text }));

  if (isClaimWorkflow || run.workflowKey === "oa_analysis" || run.workflowKey === "oa_response_draft") {
    // Run the REAL deterministic checkers over the matter's claim set.
    checkResults.push(checkClaimDependencies(claimInputs));
    checkResults.push(checkAntecedentBasis(claimInputs));
  }

  // SB/08 field validation over rows derived from the matter's sources.
  if (run.workflowKey === "ids_packet") {
    checkResults.push(checkSb08(buildSb08Rows(store, run), run.asOfDate));
  }

  // Section completeness per deliverable profile.
  const completenessProfile: CompletenessProfileKey | undefined =
    run.workflowKey === "section_draft"
      ? "utility_specification"
      : run.workflowKey === "research_memo"
        ? "research_memo"
        : run.workflowKey === "oa_response_draft"
          ? "oa_response"
          : undefined;
  if (completenessProfile) {
    checkResults.push(
      checkSectionCompleteness(deliverableSections, completenessProfile),
    );
  }

  // Reference-numeral / figure-callout consistency for drafting workflows.
  if (run.workflowKey === "section_draft" || isClaimWorkflow) {
    checkResults.push(checkNumeralConsistency(deliverableSections, claimInputs));
  }

  if (checkResults.length > 0) {
    const parts: string[] = [];
    const flags: string[] = [];
    for (const result of checkResults) {
      const summary = summarizeFindings(result.findings);
      checkErrorCount += summary.errors;
      parts.push(
        `${result.checker}@${result.checkerVersion}: ${result.passed ? "PASS" : "FAIL"} — ${summary.errors} error(s), ${summary.warnings} warning(s).`,
      );
      flags.push(...findingFlags(result.findings));
      unresolvedFlags.push(
        ...result.findings
          .filter((f) => f.severity === "error")
          .map((f) => `[${f.code}] ${f.message}`),
      );
    }
    sections.push({
      heading: "Deterministic check results",
      body: `${parts.join(" ")} Failures annotate the draft and cannot be dismissed without a recorded reason.`,
      flags,
    });
  }

  sections.push(...deliverableSections);

  if (approved.length > 0) {
    sections.push({
      heading: "Drafting basis (approved facts only)",
      body: `Drawn exclusively from the ${approved.length} counsel-reviewed fact(s): ${approved
        .map((f) => `${f.id} (${f.category})`)
        .join("; ")}. ${unapprovedCount} fact(s) in other provenance states were EXCLUDED and flagged as gaps rather than filled with plausible fiction.`,
      flags:
        unapprovedCount > 0
          ? [
              `Gap flag: ${unapprovedCount} fact(s) not yet counsel-reviewed were excluded from this draft.`,
            ]
          : [],
    });
  } else {
    sections.push({
      heading: "Drafting basis",
      body: "No counsel-reviewed facts exist in this matter; the simulated draft is a structural skeleton only and flags every substantive gap.",
      flags: ["Gap flag: zero approved facts — a practitioner must approve a fact baseline."],
    });
  }

  // -------------------------------------------------------------------
  // Evidence set: REAL retrieval (FR-5) + REAL quote verification (Inv. 14).
  // -------------------------------------------------------------------
  const plan = getPlan(store, run.id);
  const citations = buildEvidenceCitations(run, plan?.tamperQuote === true);

  let verificationState: WorkProductDocument["verificationState"] = "unverified";
  if (run.qualityControls.quoteVerification) {
    const authorityCitations = citations.filter(
      (c) => c.kind === "authority" && c.corpusDocumentId,
    );
    const verification = verifyCitationSet(
      authorityCitations.map((c) => ({
        corpusDocumentId: c.corpusDocumentId!,
        quote: c.quote,
      })),
    );
    verification.results.forEach((result, i) => {
      const citation = authorityCitations[i];
      if (!citation) return;
      citation.verification = result.state;
      if (result.state === "failed" && result.reason) {
        citation.note = result.reason;
      }
    });
    verificationState = verification.allVerified ? "verified" : "failed";
    if (!verification.allVerified) {
      // Invariant 14: a verifier failure BLOCKS "verified" and flags the doc.
      unresolvedFlags.push(
        ...verification.failures.map(
          (f) => `Verifier failure [${f.corpusDocumentId}]: ${f.reason}`,
        ),
      );
    }
  }

  // Invariant 13 demonstration: the labeled-analysis entry carries no quote
  // and is never presented as authority.
  citations.push({
    id: `cit_${run.id}_analysis`,
    kind: "analysis",
    citation: "Analysis (no authority quoted)",
    verification: "unverified",
    note: "Labeled analysis — reasoning not grounded in a quotation; a practitioner must independently evaluate it.",
  });

  sections.push({
    heading: "Authority relied upon (evidence set)",
    body:
      citations
        .filter((c) => c.kind === "authority")
        .map(
          (c) =>
            `${c.citation} [${c.verification}${c.verification === "failed" ? " — blocks verified status" : ""}]`,
        )
        .join("; ") || "No retrievable authority in the evidence set.",
    flags:
      verificationState === "failed"
        ? [
            `Quote verifier (${QUOTE_VERIFIER}@${QUOTE_VERIFIER_VERSION}) FAILED at least one quotation — "verified" status is blocked (Invariant 14).`,
          ]
        : [],
  });

  sections.push({
    heading: `${run.deliverableType} (simulated draft)`,
    body: `[SIMULATED] Deterministic placeholder for "${run.deliverableType}" produced by the ${run.workflowKey} workflow. Every legal proposition above is either cited into the run's evidence set or explicitly labeled analysis; quotations were checked by ${QUOTE_VERIFIER}@${QUOTE_VERIFIER_VERSION} against corpus release ${run.corpusRelease}.`,
    flags: [],
  });

  // FR-6: second-model critique — the critic model must differ from the
  // drafting model. Deterministic routing via the model catalog.
  const criticModel = run.qualityControls.secondModelReview
    ? pickCriticModel(run.modelId)
    : undefined;

  const contentFingerprint = sections.map((s) => `${s.heading}\n${s.body}`).join("\n\n");
  const versionHash = sha256Hex(`${run.id}@1:${contentFingerprint}`).slice(0, 16);

  const document: WorkProductDocument = {
    id: newId("doc"),
    organizationId: run.organizationId,
    matterId: run.matterId,
    runId: run.id,
    title: `${run.deliverableType} — ${run.workflowKey} (SIMULATED)`,
    deliverableType: run.deliverableType,
    tier: run.tier,
    reviewState: "pending_review",
    verificationState,
    modelId: run.modelId,
    criticModelId: criticModel?.id,
    corpusRelease: run.corpusRelease,
    version: 1,
    versionHash,
    sections,
    citations,
    actualChargeUsd: run.actualChargeUsd,
    createdAt: atIso,
    updatedAt: atIso,
  };
  store.documents.push(document);

  const reviewItem: ReviewItem = {
    id: newId("rev"),
    organizationId: run.organizationId,
    matterId: run.matterId,
    runId: run.id,
    documentTitle: document.title,
    documentVersionHash: versionHash,
    tier: run.tier,
    state: "pending_review",
    verificationState: document.verificationState,
    criticModelId: criticModel?.id,
    criticReportSummary: criticModel
      ? `SIMULATED second-model critique by ${criticModel.displayName} (${criticModel.id}) — independent of drafting model ${run.modelId} per FR-6. No unsupported legal propositions detected in placeholder content. (Local mode — no provider was called.)`
      : undefined,
    deterministicCheckFailures: checkErrorCount,
    unresolvedFlags,
    createdAt: atIso,
    updatedAt: atIso,
  };
  store.reviewItems.push(reviewItem);
}
