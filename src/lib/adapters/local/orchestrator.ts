import { createHash } from "node:crypto";
import {
  checkAntecedentBasis,
  checkClaimDependencies,
  summarizeFindings,
  type CheckFinding,
} from "@/lib/domain/checks";
import { isDraftableProvenance } from "@/lib/domain/provenance";
import type { Role } from "@/lib/domain/roles";
import {
  nextRunStage,
  RUN_PIPELINE,
  transitionRun,
  isTerminalRunState,
  type RunState,
} from "@/lib/domain/run-state";
import type {
  ReviewItem,
  RunRequest,
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

  const isClaimWorkflow =
    run.workflowKey === "claim_tree_draft" || run.workflowKey === "dependent_claim_draft";

  if (isClaimWorkflow || run.workflowKey === "oa_analysis" || run.workflowKey === "oa_response_draft") {
    // Run the REAL deterministic checkers over the matter's claim set.
    const claimInputs = claims.map((c) => ({ number: c.claimNumber, text: c.text }));
    const dep = checkClaimDependencies(claimInputs);
    const ab = checkAntecedentBasis(claimInputs);
    const depSummary = summarizeFindings(dep.findings);
    const abSummary = summarizeFindings(ab.findings);
    checkErrorCount = depSummary.errors + abSummary.errors;

    sections.push({
      heading: "Deterministic check results",
      body: `Claim-dependency check (${dep.checker}@${dep.checkerVersion}): ${dep.passed ? "PASS" : "FAIL"} — ${depSummary.errors} error(s), ${depSummary.warnings} warning(s). Antecedent-basis check (${ab.checker}@${ab.checkerVersion}): ${ab.passed ? "PASS" : "FAIL"} — ${abSummary.errors} error(s), ${abSummary.warnings} warning(s). Failures annotate the draft and cannot be dismissed without a recorded reason.`,
      flags: [...findingFlags(dep.findings), ...findingFlags(ab.findings)],
    });
    unresolvedFlags.push(
      ...[...dep.findings, ...ab.findings]
        .filter((f) => f.severity === "error")
        .map((f) => `[${f.code}] claim ${f.claimNumber}: ${f.message}`),
    );
  }

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

  sections.push({
    heading: `${run.deliverableType} (simulated draft)`,
    body: `[SIMULATED] Deterministic placeholder for "${run.deliverableType}" produced by the ${run.workflowKey} workflow. In production this section carries the model-drafted work product with per-proposition citations into the run's evidence set; every quotation passes the verifier before display as verified.`,
    flags: [],
  });

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
    verificationState: run.qualityControls.quoteVerification ? "verified" : "unverified",
    modelId: run.modelId,
    corpusRelease: run.corpusRelease,
    version: 1,
    versionHash,
    sections,
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
    criticReportSummary: run.qualityControls.secondModelReview
      ? "SIMULATED second-model critique: no unsupported legal propositions detected in placeholder content. (Local mode — no critic model was called.)"
      : undefined,
    deterministicCheckFailures: checkErrorCount,
    unresolvedFlags,
    createdAt: atIso,
    updatedAt: atIso,
  };
  store.reviewItems.push(reviewItem);
}
