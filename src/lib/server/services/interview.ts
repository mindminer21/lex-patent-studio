import "server-only";

import { randomUUID } from "node:crypto";
import {
  classifyAdviceSeeking,
  COUNSEL_REFERRAL_TEMPLATE,
  factCategoryForStage,
  interviewProgress,
  selectNextTarget,
  stageSkipRefs,
  deterministicQuestionText,
  type EngineInput,
  type InterviewProgress,
} from "@/lib/wepatent/domain/interview";
import { applyPsAction } from "@/lib/wepatent/domain/ps-ledger";
import { release, reserve, settle, type UsageEstimate } from "@/lib/wepatent/domain/usage";
import { env } from "@/lib/wepatent/env";
import { getAdapters } from "../adapters";
import { enqueueJob, processJob } from "../jobs/runner";
import { getModelTier, type ModelTier } from "../model-registry";
import { estimateForTier } from "./generation";
import { getLedger, recomputeCoverage } from "./ps-ledger";
import type {
  Id,
  InterviewSessionRecord,
  InterviewTurnRecord,
  TurnExtractionOutput,
} from "../adapters/types";

/**
 * Adaptive invention interview service (Intake Studio PRD §6, FR-INT-6/7).
 *
 * Structural guarantees (all enforced here or in the domain engine, never
 * left to model discretion):
 * - Stage sequence, target selection, no-repeat, and stage gating are
 *   deterministic code (`domain/interview.ts`). The model only words the
 *   question for the engine-chosen target.
 * - Every model-touching step (question drafting — Advanced tier; per-turn
 *   extraction — Fast tier) runs estimate → reservation → run → settlement
 *   on the FR-6 layer, and its settled charge accrues to the session's
 *   running spend. When spend reaches the session cap, model calls HALT
 *   with an explicit raise-the-cap resume path (FR-INT-10).
 * - Extraction output is proposals only: new items land `ai_proposed`;
 *   edits to user_confirmed/user_edited items become proposed-edit events
 *   for human review — never silent mutation (invariant 13, AC 4).
 * - Advice-seeking turns receive the FIXED counsel-referral template from
 *   the deterministic classifier — no model is called for them (§6.4).
 * - Answers and attachments are untrusted evidence (invariant 16).
 */

const DRAFT_TIER = "advanced"; // question drafting (feature PRD §10)
const EXTRACTION_TIER = "standard"; // Fast tier post-answer extraction

export type InterviewWarning =
  | "extraction_insufficient_funds"
  | "extraction_failed"
  | "drafting_insufficient_funds"
  | "drafting_failed";

export type InterviewView = {
  session: InterviewSessionRecord;
  turns: InterviewTurnRecord[];
  pendingTurn: InterviewTurnRecord | null;
  progress: InterviewProgress;
  capReached: boolean;
  /** Proposed edits awaiting the user (from post-answer extraction). */
  proposedEdits: Array<{ eventId: Id; pairId: Id; proposedStatement: string }>;
  perTurnEstimate: { lowCents: number; highCents: number };
  walletAvailableCents: number;
};

export type StartResult =
  | { ok: true; view: InterviewView; warnings: InterviewWarning[] }
  | { ok: false; error: "invention_not_found" | "no_tier" };

export type SubmitResult =
  | {
      ok: true;
      view: InterviewView;
      warnings: InterviewWarning[];
      /** Set (to the fixed template) when the turn was advice-seeking. */
      counselReferral: string | null;
    }
  | {
      ok: false;
      error:
        | "session_not_found"
        | "session_not_active"
        | "no_pending_question"
        | "invalid_input"
        | "cap_reached";
    };

function defaultCapCents(): number {
  return env.INTERVIEW_SESSION_SPEND_CAP_CENTS;
}

/** Combined per-turn estimate (drafting + extraction) for the UI (FR-INT-10). */
export function perTurnEstimate(): { lowCents: number; highCents: number } | null {
  const draftTier = getModelTier(DRAFT_TIER);
  const extractTier = getModelTier(EXTRACTION_TIER);
  if (!draftTier || !extractTier) return null;
  const draft = estimateForTier(draftTier, 900);
  const extract = estimateForTier(extractTier, 1_200);
  return {
    lowCents: draft.customerLowCents + extract.customerLowCents,
    highCents: draft.customerHighCents + extract.customerHighCents,
  };
}

/* ------------------------------ view builder ----------------------------- */

async function buildView(
  organizationId: Id,
  session: InterviewSessionRecord,
): Promise<InterviewView> {
  const { data } = getAdapters();
  const [turns, ledger, events, wallet] = await Promise.all([
    data.listInterviewTurns(organizationId, session.id),
    getLedger(organizationId, session.inventionId),
    data.listPsEvents(organizationId, session.inventionId),
    data.getWallet(organizationId),
  ]);
  const pendingTurn = [...turns].reverse().find((turn) => turn.answerKind === null) ?? null;
  const pairById = new Map(ledger.pairs.map((pair) => [pair.id, pair]));
  // M3: explicit dismissals hide a proposal without touching the pair.
  const dismissedEventIds = new Set<string>();
  for (const event of events) {
    if (event.kind !== "proposal_dismissed") continue;
    try {
      const parsed = JSON.parse(event.detail) as { eventId?: string };
      if (parsed.eventId) dismissedEventIds.add(parsed.eventId);
    } catch {
      /* ignore malformed dismissals */
    }
  }
  const proposedEdits: InterviewView["proposedEdits"] = [];
  for (const event of events) {
    if (event.kind !== "proposed" || !event.detail.startsWith("{")) continue;
    if (dismissedEventIds.has(event.id)) continue;
    try {
      const parsed = JSON.parse(event.detail) as {
        type?: string;
        pairId?: string;
        proposedStatement?: string;
      };
      if (parsed.type !== "proposed_edit" || !parsed.pairId || !parsed.proposedStatement) {
        continue;
      }
      const pair = pairById.get(parsed.pairId);
      // A proposal is live until the user acts: it disappears once the
      // pair is gone, already says the proposed text, or was edited /
      // re-confirmed by the user AFTER the proposal was made.
      if (!pair) continue;
      if (pair.statement.trim() === parsed.proposedStatement.trim()) continue;
      const supersededByUser = events.some(
        (later) =>
          later.pairId === parsed.pairId &&
          (later.kind === "edited" || later.kind === "confirmed") &&
          later.createdAt > event.createdAt,
      );
      if (supersededByUser) continue;
      proposedEdits.push({
        eventId: event.id,
        pairId: parsed.pairId,
        proposedStatement: parsed.proposedStatement,
      });
    } catch {
      /* non-JSON details are ordinary events */
    }
  }
  return {
    session,
    turns,
    pendingTurn,
    progress: interviewProgress(session.stage, {
      satisfied: ledger.coverage.aggregate.satisfied,
      total: ledger.coverage.aggregate.total,
    }),
    capReached: session.spentCents >= session.sessionSpendCapCents,
    proposedEdits,
    perTurnEstimate: perTurnEstimate() ?? { lowCents: 0, highCents: 0 },
    walletAvailableCents: wallet ? wallet.balanceCents - wallet.reservedCents : 0,
  };
}

/* --------------------------- engine input glue --------------------------- */

async function buildEngineInput(
  organizationId: Id,
  session: InterviewSessionRecord,
): Promise<EngineInput> {
  const { data } = getAdapters();
  const [turns, ledger, events, facts, invention] = await Promise.all([
    data.listInterviewTurns(organizationId, session.id),
    getLedger(organizationId, session.inventionId),
    data.listPsEvents(organizationId, session.inventionId),
    data.listFacts(organizationId, session.inventionId),
    data.getInvention(organizationId, session.inventionId),
  ]);
  const answeredTargetRefs = turns
    .filter((turn) => turn.answerKind === "answer" && turn.targetRef)
    .map((turn) => turn.targetRef as string);
  const skippedTargetRefs = turns
    .filter(
      (turn) => (turn.answerKind === "skip" || turn.answerKind === "unknown") && turn.targetRef,
    )
    .map((turn) => turn.targetRef as string);
  const coverage = ledger.coverage.perSolution.flatMap((solution) =>
    (Object.keys(solution.dimensions) as Array<keyof typeof solution.dimensions>).map(
      (dimension) => ({
        solutionId: solution.solutionId,
        dimension,
        status: solution.dimensions[dimension].status,
      }),
    ),
  );
  return {
    stage: session.stage,
    answeredTargetRefs,
    skippedTargetRefs,
    known: {
      problem: invention?.problem ?? "",
      solution: invention?.solution ?? "",
      businessContext: invention?.businessContext ?? "",
      factStatements: facts.map((fact) => fact.statement),
    },
    coverage,
    solutions: ledger.pairs
      .filter((pair) => pair.kind === "solution")
      .map((pair) => ({ id: pair.id, statement: pair.statement, state: pair.state })),
    rejectedStatements: events
      .filter((event) => event.kind === "ai_proposal_rejected")
      .map((event) => event.detail)
      .slice(-10),
  };
}

/* ------------------------- metered model helpers ------------------------- */

type MeteredOutcome<T> =
  | { ok: true; result: T; chargeCents: number; reservationId: Id; deduplicated: false }
  | { ok: true; result: null; chargeCents: 0; reservationId: Id; deduplicated: true }
  | { ok: false; error: "insufficient_funds" | "model_failed" };

async function runMetered<T extends { providerCostCents: number; inputTokens: number; outputTokens: number }>(
  organizationId: Id,
  tier: ModelTier,
  estimate: UsageEstimate,
  idempotencyKey: string,
  note: string,
  call: () => Promise<T>,
  alreadyApplied: (reservationId: Id) => Promise<boolean>,
): Promise<MeteredOutcome<T>> {
  const { data } = getAdapters();
  const wallet = (await data.getWallet(organizationId)) ?? {
    organizationId,
    balanceCents: 0,
    reservedCents: 0,
  };
  const existing = await data.listReservations(organizationId);
  const reserved = reserve(
    { balanceCents: wallet.balanceCents, reservedCents: wallet.reservedCents },
    existing,
    {
      id: randomUUID(),
      idempotencyKey,
      amountCents: estimate.customerHighCents,
      rateVersion: tier.rate.rateVersion,
    },
  );
  if (!reserved.ok) return { ok: false, error: "insufficient_funds" };
  if (reserved.deduplicated && (await alreadyApplied(reserved.reservation.id))) {
    // Retry of a run whose effects are already recorded: never re-charge.
    return {
      ok: true,
      result: null,
      chargeCents: 0,
      reservationId: reserved.reservation.id,
      deduplicated: true,
    };
  }

  await data.saveWallet({ organizationId, ...reserved.wallet });
  const reservationRecord = {
    ...reserved.reservation,
    organizationId,
    createdAt: new Date().toISOString(),
  };
  await data.saveReservation(reservationRecord);

  let result: T;
  try {
    result = await call();
  } catch {
    const released = release(reserved.wallet, reserved.reservation);
    if (released.ok) {
      await data.saveWallet({ organizationId, ...released.wallet });
      await data.saveReservation({ ...reservationRecord, status: released.reservation.status });
      await data.appendLedgerEntry({
        organizationId,
        kind: "release",
        amountCents: 0,
        reservationId: reservationRecord.id,
        note: `${note} failed; reservation released without charge.`,
      });
    }
    return { ok: false, error: "model_failed" };
  }

  const settled = settle(reserved.wallet, reserved.reservation, result.providerCostCents);
  if (!settled.ok) return { ok: false, error: "model_failed" };
  await data.saveWallet({ organizationId, ...settled.wallet });
  await data.saveReservation({
    ...reservationRecord,
    status: settled.reservation.status,
    settledProviderCostCents: settled.reservation.settledProviderCostCents,
    settledCustomerChargeCents: settled.reservation.settledCustomerChargeCents,
  });
  await data.appendLedgerEntry({
    organizationId,
    kind: "settlement",
    amountCents: -settled.customerChargeCents,
    reservationId: reservationRecord.id,
    note: `${note} settlement (${tier.rate.rateVersion}); provider cost × 1.50.`,
  });
  await data.appendUsageEvent({
    organizationId,
    reservationId: reservationRecord.id,
    modelId: tier.modelId,
    rateVersion: tier.rate.rateVersion,
    providerCostCents: result.providerCostCents,
    customerChargeCents: settled.customerChargeCents,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  });
  return {
    ok: true,
    result,
    chargeCents: settled.customerChargeCents,
    reservationId: reservationRecord.id,
    deduplicated: false,
  };
}

async function addSessionSpend(
  organizationId: Id,
  sessionId: Id,
  chargeCents: number,
): Promise<InterviewSessionRecord | null> {
  if (chargeCents <= 0) {
    const { data } = getAdapters();
    return data.getInterviewSession(organizationId, sessionId);
  }
  const { data } = getAdapters();
  const session = await data.getInterviewSession(organizationId, sessionId);
  if (!session) return null;
  return data.updateInterviewSession(organizationId, sessionId, {
    spentCents: session.spentCents + chargeCents,
  });
}

/* --------------------------- question drafting --------------------------- */

/**
 * Draft (or deterministically materialize) the next question turn for the
 * session. Stage/target come from the deterministic engine; the model only
 * words the question. Halts without a model call when the session cap is
 * reached (FR-INT-10).
 */
async function ensurePendingQuestion(
  organizationId: Id,
  sessionId: Id,
): Promise<{ warnings: InterviewWarning[] }> {
  const { data, modelGateway } = getAdapters();
  const warnings: InterviewWarning[] = [];
  let session = await data.getInterviewSession(organizationId, sessionId);
  if (!session || session.status !== "active") return { warnings };

  const turns = await data.listInterviewTurns(organizationId, sessionId);
  if (turns.some((turn) => turn.answerKind === null)) return { warnings }; // already pending

  const engineInput = await buildEngineInput(organizationId, session);
  const selection = selectNextTarget(engineInput);
  if (selection.done) {
    await data.updateInterviewSession(organizationId, sessionId, { status: "completed" });
    return { warnings };
  }
  if (selection.stage !== session.stage) {
    session =
      (await data.updateInterviewSession(organizationId, sessionId, {
        stage: selection.stage,
      })) ?? session;
  }

  // Session spend cap: model calls halt here; raising the cap resumes.
  if (session.spentCents >= session.sessionSpendCapCents) return { warnings };

  const tier = getModelTier(DRAFT_TIER);
  if (!tier) {
    warnings.push("drafting_failed");
    return { warnings };
  }

  const target = selection.target;
  const turnIndex = turns.length;
  const solutionStatement =
    target.kind === "coverage_gap"
      ? (engineInput.solutions.find((solution) => solution.id === target.solutionId)?.statement ??
        null)
      : null;
  const knownSummary = [
    engineInput.known.problem && `Problem (intake): ${engineInput.known.problem}`,
    engineInput.known.solution && `Solution (intake): ${engineInput.known.solution}`,
    ...engineInput.known.factStatements.slice(-8).map((statement) => `Fact: ${statement}`),
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 4_000);

  const estimate = estimateForTier(tier, Math.max(300, Math.ceil(knownSummary.length / 4) + 300));
  const outcome = await runMetered(
    organizationId,
    tier,
    estimate,
    `turn-draft:${sessionId}:${turnIndex}`,
    "Interview question drafting",
    () =>
      modelGateway.draftInterviewQuestion({
        modelId: tier.modelId,
        stage: selection.stage,
        targetRef: target.ref,
        targetPurpose:
          target.kind === "stage_topic"
            ? target.topic.purpose
            : `close the enablement-coverage gap "${target.dimension}" for the referenced solution`,
        followupPurposes: target.kind === "stage_topic" ? target.topic.followupPurposes : [],
        solutionStatement,
        knownSummary,
        avoidStatements: [...engineInput.rejectedStatements],
        maxOutputTokens: 600,
      }),
    async () => {
      const current = await data.listInterviewTurns(organizationId, sessionId);
      return current.some((turn) => turn.turnIndex === turnIndex);
    },
  );

  let questionText: string;
  let followups: string[];
  if (outcome.ok && outcome.result) {
    questionText = outcome.result.questionText.slice(0, 2_000);
    followups = outcome.result.followups.map((item) => item.slice(0, 500));
    await addSessionSpend(organizationId, sessionId, outcome.chargeCents);
  } else if (outcome.ok && outcome.deduplicated) {
    return { warnings }; // retry: the turn already exists
  } else {
    // Drafting could not run (funds/provider). Fall back to the
    // deterministic template so the interview can continue at zero cost —
    // the engine owns the target either way.
    warnings.push(
      !outcome.ok && outcome.error === "insufficient_funds"
        ? "drafting_insufficient_funds"
        : "drafting_failed",
    );
    const drafted = deterministicQuestionText(target);
    questionText = drafted.questionText;
    followups = drafted.followups;
  }

  await data.createInterviewTurn({
    organizationId,
    sessionId,
    turnIndex,
    stage: selection.stage,
    question: questionText,
    followups,
    targetRef: target.ref,
    answerText: null,
    answerKind: null,
    skipped: false,
    attachmentSourceIds: [],
    extractionJobId: null,
  });
  return { warnings };
}

/* ------------------------------ public API ------------------------------- */

/** Start a new session or resume the user's existing one (§6.1 resume). */
export async function startInterviewSession(params: {
  organizationId: Id;
  userId: Id;
  inventionId: Id;
}): Promise<StartResult> {
  const { data } = getAdapters();
  const invention = await data.getInvention(params.organizationId, params.inventionId);
  if (!invention) return { ok: false, error: "invention_not_found" };
  if (!getModelTier(DRAFT_TIER) || !getModelTier(EXTRACTION_TIER)) {
    return { ok: false, error: "no_tier" };
  }

  const sessions = await data.listInterviewSessions(params.organizationId, params.inventionId);
  let session = sessions.find(
    (candidate) => candidate.userId === params.userId && candidate.status !== "completed",
  );
  if (session && session.status === "paused") {
    session =
      (await data.updateInterviewSession(params.organizationId, session.id, {
        status: "active",
      })) ?? session;
  }
  if (!session) {
    session = await data.createInterviewSession({
      organizationId: params.organizationId,
      inventionId: params.inventionId,
      userId: params.userId,
      stage: "context_field",
      status: "active",
      sessionSpendCapCents: defaultCapCents(),
      spentCents: 0,
    });
    await data.appendAuditEvent({
      organizationId: params.organizationId,
      actor: params.userId,
      action: "interview.session_started",
      target: session.id,
      meta: { inventionId: params.inventionId, capCents: session.sessionSpendCapCents },
    });
  }

  const { warnings } = await ensurePendingQuestion(params.organizationId, session.id);
  const fresh = await data.getInterviewSession(params.organizationId, session.id);
  return { ok: true, view: await buildView(params.organizationId, fresh ?? session), warnings };
}

export async function getInterviewView(
  organizationId: Id,
  sessionId: Id,
): Promise<InterviewView | null> {
  const { data } = getAdapters();
  const session = await data.getInterviewSession(organizationId, sessionId);
  if (!session) return null;
  return buildView(organizationId, session);
}

/**
 * Submit the pending turn: a text answer (optionally with attachments), a
 * skip, or "I don't know". Advice-seeking answers get the FIXED referral
 * template with no model call; skips/unknowns are recorded as enablement
 * signals; answers run the metered Fast-tier extraction pass and the
 * ledger updates with proposals only.
 */
export async function submitInterviewTurn(params: {
  organizationId: Id;
  userId: Id;
  sessionId: Id;
  kind: "answer" | "skip" | "unknown";
  answerText?: string;
  attachmentSourceIds?: string[];
}): Promise<SubmitResult> {
  const { data, modelGateway } = getAdapters();
  const session = await data.getInterviewSession(params.organizationId, params.sessionId);
  if (!session) return { ok: false, error: "session_not_found" };
  if (session.status !== "active") return { ok: false, error: "session_not_active" };

  const turns = await data.listInterviewTurns(params.organizationId, params.sessionId);
  const pending = [...turns].reverse().find((turn) => turn.answerKind === null);
  if (!pending) return { ok: false, error: "no_pending_question" };

  const warnings: InterviewWarning[] = [];
  const answerText = (params.answerText ?? "").trim();

  if (params.kind === "answer") {
    if (answerText.length < 2 || answerText.length > 8_000) {
      return { ok: false, error: "invalid_input" };
    }

    // UPL rail (§6.4): deterministic classifier; the response is ALWAYS the
    // fixed template; no model call, no charge; the same fact question is
    // re-presented so the interview continues.
    const classification = classifyAdviceSeeking(answerText);
    if (classification.adviceSeeking) {
      await data.updateInterviewTurn(params.organizationId, pending.id, {
        answerText,
        answerKind: "advice_referral",
      });
      await data.appendAuditEvent({
        organizationId: params.organizationId,
        actor: params.userId,
        action: "interview.advice_referral",
        target: pending.id,
        meta: { rule: classification.matchedRule },
      });
      await data.createInterviewTurn({
        organizationId: params.organizationId,
        sessionId: params.sessionId,
        turnIndex: turns.length,
        stage: pending.stage,
        question: pending.question,
        followups: pending.followups,
        targetRef: pending.targetRef,
        answerText: null,
        answerKind: null,
        skipped: false,
        attachmentSourceIds: [],
        extractionJobId: null,
      });
      const fresh = await data.getInterviewSession(params.organizationId, params.sessionId);
      return {
        ok: true,
        view: await buildView(params.organizationId, fresh ?? session),
        warnings,
        counselReferral: COUNSEL_REFERRAL_TEMPLATE,
      };
    }

    // Session spend cap halts BEFORE anything is consumed (FR-INT-10):
    // the pending question stays pending; raising the cap resumes.
    if (session.spentCents >= session.sessionSpendCapCents) {
      return { ok: false, error: "cap_reached" };
    }

    // Attachments (§6.1): validated against this record, then routed
    // through the existing FR-4 + FR-INT-3 pipeline. Their interpreted
    // outputs join the record and count toward coverage.
    const attachmentIds: string[] = [];
    for (const sourceId of (params.attachmentSourceIds ?? []).slice(0, 5)) {
      const source = await data.getSource(params.organizationId, sourceId);
      if (!source || source.inventionId !== session.inventionId) continue;
      attachmentIds.push(source.id);
      // Drain any queued scan/extraction for this source so interpretation
      // can run; each processJob call is a no-op unless the job is queued.
      const scanJob = await data.findJobByKey(
        params.organizationId,
        "source_scan",
        `scan:${sourceId}`,
      );
      if (scanJob) await processJob(params.organizationId, scanJob.id);
      const extractJob = await data.findJobByKey(
        params.organizationId,
        "source_extraction",
        `extract:${sourceId}`,
      );
      if (extractJob) await processJob(params.organizationId, extractJob.id);
      await enqueueJob({
        organizationId: params.organizationId,
        kind: "source_interpretation",
        idempotencyKey: `interpret:${sourceId}`,
        payload: { sourceId, userId: params.userId, inventionId: session.inventionId },
      });
    }

    await data.updateInterviewTurn(params.organizationId, pending.id, {
      answerText,
      answerKind: "answer",
      attachmentSourceIds: attachmentIds,
    });

    // Deterministic fact-of-record with an origin ref to this turn
    // (feature PRD §8). The USER said this; the model never writes facts.
    if (answerText.length >= 3) {
      await data.createFact({
        organizationId: params.organizationId,
        inventionId: session.inventionId,
        category: factCategoryForStage(pending.stage),
        statement: answerText.slice(0, 8_000),
        provenance: "user_asserted",
        createdBy: "user",
        originRef: `turn:${pending.id}`,
      });
    }

    // ---- Live extraction (FR-INT-7): Fast tier, proposals only ----------
    const tier = getModelTier(EXTRACTION_TIER);
    if (tier) {
      const ledger = await getLedger(params.organizationId, session.inventionId);
      const estimate = estimateForTier(
        tier,
        Math.max(300, Math.ceil((answerText.length + 600) / 4)),
      );
      const extractionKey = `turn-extract:${pending.id}`;
      const outcome = await runMetered(
        params.organizationId,
        tier,
        estimate,
        extractionKey,
        "Interview turn extraction",
        () =>
          modelGateway.extractInterviewAnswer({
            modelId: tier.modelId,
            stage: pending.stage,
            question: pending.question,
            answerText,
            existingPairs: ledger.pairs.map((pair) => ({
              id: pair.id,
              kind: pair.kind,
              statement: pair.statement,
              state: pair.state,
            })),
            componentNames: ledger.components.map((component) => component.name),
            maxOutputTokens: 900,
          }),
        async (reservationId) => {
          const events = await data.listPsEvents(params.organizationId, session.inventionId);
          return events.some(
            (event) =>
              event.kind === "proposed" &&
              event.detail === `extraction turn:${pending.id} reservation:${reservationId}`,
          );
        },
      );
      if (outcome.ok && outcome.result) {
        await applyExtractionProposals({
          organizationId: params.organizationId,
          inventionId: session.inventionId,
          turnId: pending.id,
          reservationId: outcome.reservationId,
          modelId: tier.modelId,
          output: outcome.result.output,
        });
        await addSessionSpend(params.organizationId, params.sessionId, outcome.chargeCents);
      } else if (!outcome.ok) {
        warnings.push(
          outcome.error === "insufficient_funds"
            ? "extraction_insufficient_funds"
            : "extraction_failed",
        );
      }
    }
    await recomputeCoverage(params.organizationId, session.inventionId);
  } else {
    // Skip / "I don't know" (§6.1): recorded, and logged as an enablement
    // signal — unknowns are signals, not failures. No model call, no cost.
    await data.updateInterviewTurn(params.organizationId, pending.id, {
      answerText: answerText.length > 0 ? answerText : null,
      answerKind: params.kind,
      skipped: true,
    });
    await data.createFact({
      organizationId: params.organizationId,
      inventionId: session.inventionId,
      category: "technical",
      statement:
        params.kind === "unknown"
          ? "Enablement signal: the inventor answered “I don't know” to an interview question."
          : "Enablement signal: an interview question was skipped without an answer.",
      provenance: "needs_confirmation",
      createdBy: "user",
      originRef: `turn:${pending.id}`,
    });
  }

  const draftWarnings = await ensurePendingQuestion(params.organizationId, params.sessionId);
  warnings.push(...draftWarnings.warnings);
  const fresh = await data.getInterviewSession(params.organizationId, params.sessionId);
  return {
    ok: true,
    view: await buildView(params.organizationId, fresh ?? session),
    warnings,
    counselReferral: null,
  };
}

/** Explicit stage skip (§6.2): marks every remaining stage target skipped. */
export async function skipInterviewStage(params: {
  organizationId: Id;
  userId: Id;
  sessionId: Id;
}): Promise<SubmitResult> {
  const { data } = getAdapters();
  const session = await data.getInterviewSession(params.organizationId, params.sessionId);
  if (!session) return { ok: false, error: "session_not_found" };
  if (session.status !== "active") return { ok: false, error: "session_not_active" };

  const engineInput = await buildEngineInput(params.organizationId, session);
  const refs = stageSkipRefs(session.stage, engineInput);
  const turns = await data.listInterviewTurns(params.organizationId, params.sessionId);
  const pending = [...turns].reverse().find((turn) => turn.answerKind === null);
  let nextIndex = turns.length;
  for (const ref of refs) {
    if (pending && pending.targetRef === ref) {
      await data.updateInterviewTurn(params.organizationId, pending.id, {
        answerKind: "skip",
        skipped: true,
      });
      continue;
    }
    // Materialize a zero-cost skip record for each remaining target so the
    // no-repeat accounting persists (deterministic template text; no model).
    const target = reconstructForSkip(ref, engineInput);
    await data.createInterviewTurn({
      organizationId: params.organizationId,
      sessionId: params.sessionId,
      turnIndex: nextIndex,
      stage: session.stage,
      question: target,
      followups: [],
      targetRef: ref,
      answerText: null,
      answerKind: "skip",
      skipped: true,
      attachmentSourceIds: [],
      extractionJobId: null,
    });
    nextIndex += 1;
  }
  await data.appendAuditEvent({
    organizationId: params.organizationId,
    actor: params.userId,
    action: "interview.stage_skipped",
    target: params.sessionId,
    meta: { stage: session.stage, skippedTargets: refs.length },
  });

  const { warnings } = await ensurePendingQuestion(params.organizationId, params.sessionId);
  const fresh = await data.getInterviewSession(params.organizationId, params.sessionId);
  return {
    ok: true,
    view: await buildView(params.organizationId, fresh ?? session),
    warnings,
    counselReferral: null,
  };
}

function reconstructForSkip(ref: string, input: EngineInput): string {
  // Deterministic label for skip records (never shown as a live question).
  void input;
  return `(stage skipped) target ${ref}`;
}

export async function pauseInterviewSession(params: {
  organizationId: Id;
  userId: Id;
  sessionId: Id;
}): Promise<{ ok: boolean }> {
  const { data } = getAdapters();
  const session = await data.getInterviewSession(params.organizationId, params.sessionId);
  if (!session || session.status !== "active") return { ok: false };
  await data.updateInterviewSession(params.organizationId, params.sessionId, {
    status: "paused",
  });
  await data.appendAuditEvent({
    organizationId: params.organizationId,
    actor: params.userId,
    action: "interview.session_paused",
    target: params.sessionId,
    meta: {},
  });
  return { ok: true };
}

/**
 * Raise (or lower) the session spend cap — the explicit resume path after
 * a cap halt (FR-INT-10). Drafting resumes immediately if headroom exists.
 */
export async function setSessionSpendCap(params: {
  organizationId: Id;
  userId: Id;
  sessionId: Id;
  capCents: number;
}): Promise<{ ok: boolean; view?: InterviewView; warnings?: InterviewWarning[] }> {
  if (!Number.isInteger(params.capCents) || params.capCents < 0 || params.capCents > 100_000) {
    return { ok: false };
  }
  const { data } = getAdapters();
  const session = await data.getInterviewSession(params.organizationId, params.sessionId);
  if (!session) return { ok: false };
  await data.updateInterviewSession(params.organizationId, params.sessionId, {
    sessionSpendCapCents: params.capCents,
  });
  await data.appendAuditEvent({
    organizationId: params.organizationId,
    actor: params.userId,
    action: "interview.cap_changed",
    target: params.sessionId,
    meta: { capCents: params.capCents },
  });
  const { warnings } = await ensurePendingQuestion(params.organizationId, params.sessionId);
  const fresh = await data.getInterviewSession(params.organizationId, params.sessionId);
  return {
    ok: true,
    view: await buildView(params.organizationId, fresh ?? session),
    warnings,
  };
}

/**
 * Dismiss a proposed edit WITHOUT applying it (M3 affordance, feature PRD
 * §5.4 review model). Appends an event to the append-only log — the
 * original proposal event is never mutated, and the pair is untouched.
 */
export async function dismissProposedEdit(params: {
  organizationId: Id;
  userId: Id;
  inventionId: Id;
  eventId: Id;
}): Promise<{ ok: boolean }> {
  const { data } = getAdapters();
  const events = await data.listPsEvents(params.organizationId, params.inventionId);
  const event = events.find((candidate) => candidate.id === params.eventId);
  if (!event || event.kind !== "proposed" || !event.detail.startsWith("{")) {
    return { ok: false };
  }
  try {
    const parsed = JSON.parse(event.detail) as { type?: string; pairId?: string };
    if (parsed.type !== "proposed_edit") return { ok: false };
    await data.appendPsEvent({
      organizationId: params.organizationId,
      inventionId: params.inventionId,
      pairId: parsed.pairId ?? null,
      kind: "proposal_dismissed",
      actor: `user:${params.userId}`,
      detail: JSON.stringify({ type: "proposed_edit_dismissed", eventId: event.id }),
    });
    await data.appendAuditEvent({
      organizationId: params.organizationId,
      actor: params.userId,
      action: "interview.proposed_edit_dismissed",
      target: event.id,
      meta: { pairId: parsed.pairId ?? null },
    });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/* ---------------------- extraction proposal writing ---------------------- */

/**
 * Write extraction output through the domain guard: everything the model
 * proposed lands `ai_proposed`; user_confirmed/user_edited items are never
 * touched — edits arrive as proposed-edit EVENTS for human review (AC 4).
 */
async function applyExtractionProposals(params: {
  organizationId: Id;
  inventionId: Id;
  turnId: Id;
  reservationId: Id;
  modelId: string;
  output: TurnExtractionOutput;
}): Promise<void> {
  const { data } = getAdapters();
  const guard = applyPsAction("model", "propose", null);
  if (!guard.allowed || guard.nextState !== "ai_proposed") return; // structurally unreachable

  // Idempotency marker: a retry with the same reservation skips re-writing.
  await data.appendPsEvent({
    organizationId: params.organizationId,
    inventionId: params.inventionId,
    pairId: null,
    kind: "proposed",
    actor: `model:${params.modelId}`,
    detail: `extraction turn:${params.turnId} reservation:${params.reservationId}`,
  });

  const existingPairs = await data.listPsPairs(params.organizationId, params.inventionId);
  const knownStatements = new Set(
    existingPairs.map((pair) => `${pair.kind}:${pair.statement.trim().toLowerCase()}`),
  );
  const anchor = `turn:${params.turnId}`;

  for (const kind of ["problem", "solution"] as const) {
    const items = kind === "problem" ? params.output.problems : params.output.solutions;
    for (const item of items.slice(0, 10)) {
      const statement = item.statement.trim().slice(0, 4_000);
      const key = `${kind}:${statement.toLowerCase()}`;
      if (!statement || knownStatements.has(key)) continue;
      knownStatements.add(key);
      const pair = await data.createPsPair({
        organizationId: params.organizationId,
        inventionId: params.inventionId,
        kind,
        statement,
        state: guard.nextState,
        origin: "interview",
        createdByActor: "model",
        sourceAnchors: [anchor],
      });
      await data.appendPsEvent({
        organizationId: params.organizationId,
        inventionId: params.inventionId,
        pairId: pair.id,
        kind: "proposed",
        actor: `model:${params.modelId}`,
        detail: `turn:${params.turnId}`,
      });
    }
  }

  // Proposed edits: ONLY as review objects; never a silent mutation of
  // user_confirmed / user_edited items (invariant 13, AC 4).
  const pairById = new Map(existingPairs.map((pair) => [pair.id, pair]));
  for (const edit of params.output.proposedEdits.slice(0, 10)) {
    const pair = pairById.get(edit.pairId);
    if (!pair) continue;
    if (pair.state !== "user_confirmed" && pair.state !== "user_edited") continue;
    await data.appendPsEvent({
      organizationId: params.organizationId,
      inventionId: params.inventionId,
      pairId: pair.id,
      kind: "proposed",
      actor: `model:${params.modelId}`,
      detail: JSON.stringify({
        type: "proposed_edit",
        pairId: pair.id,
        proposedStatement: edit.proposedStatement.slice(0, 4_000),
        turnId: params.turnId,
      }),
    });
  }

  // Component inventory additions (ai_proposed; dedupe by name).
  const existingComponents = await data.listComponents(
    params.organizationId,
    params.inventionId,
  );
  const known = new Set(existingComponents.map((component) => component.name.toLowerCase()));
  for (const candidate of params.output.components.slice(0, 10)) {
    const name = candidate.name.trim().slice(0, 200);
    if (!name || known.has(name.toLowerCase())) continue;
    known.add(name.toLowerCase());
    await data.createComponent({
      organizationId: params.organizationId,
      inventionId: params.inventionId,
      name,
      description: candidate.description.slice(0, 2_000),
      state: guard.nextState,
      sourceAnchors: [anchor],
    });
  }
}
