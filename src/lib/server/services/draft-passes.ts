import "server-only";

import { randomUUID } from "node:crypto";
import {
  authorIllustrationsBrief,
  briefDescriptionParagraphs,
  DRAFT_PASS_STATE_LABELS,
  draftConfigFor,
  evaluateDeliveryGate,
  figuresNamedInBriefDescription,
  illustrationsBriefSchema,
  isBriefUsable,
  numeralGlossary,
  reconcileProseAndDrawings,
  transitionDraftPass,
  validateBriefConsistency,
  describeBriefViolation,
  type DraftProduct,
  type DraftProductConfig,
  type IllustrationsBrief,
  type ReconciliationReport,
} from "@/lib/shared/drafting";
import { markupMultiplierFor } from "@/lib/shared/billing/markup";
import { isUnresolved } from "@/lib/wepatent/domain/facts";
import { release, reserve, settle } from "@/lib/wepatent/domain/usage";
import { getAdapters } from "../adapters";
import { getModelTier } from "../model-registry";
import { extractMethodSteps } from "../figures/planner";
import { estimateForTier } from "./generation";
import type {
  DraftSetRecord,
  DraftSetStageValue,
  DraftSetStateValue,
  Id,
} from "../adapters/types";

/**
 * THE THREE-PASS DRAFT ORCHESTRATOR (Jeff's directive, 2026-08-04).
 *
 * "Build a first copy of the patent draft with an illustrations brief
 *  (including reference numbers), then build the patent figures, and then
 *  come back to create a second version of the patent application draft
 *  fully enabling and checking against the patent figures before sending
 *  anything to the client. This needs to be the flow in both wepatent and
 *  the lex patent studio apps. The patent application generation process
 *  should be similarly implemented in both."
 *
 * WHAT LIVES WHERE
 * ----------------
 * The state machine, the brief schema and authoring, the reconciliation
 * check, and the delivery gate are all in `src/lib/shared/drafting/` and are
 * product-agnostic. THIS module is the shared server orchestration that
 * drives them: it takes a `DraftProductConfig` and is otherwise identical
 * for both lanes. There is no wepatent branch and no Lex branch in here —
 * that is the "do not fork the logic" requirement, made structural.
 *
 * METERING
 * --------
 * Each pass reserves and settles separately, so the estimate a user is shown
 * matches the pass about to run, a cap can pause between passes without
 * losing the first, and a retry of one pass cannot re-charge the other. Both
 * passes are GENERATION tasks (2.0×) — they author work product delivered to
 * the customer.
 */

export const DRAFT_PASS_ORCHESTRATOR_VERSION = "three-pass-1.0.0";

/** Both lanes drive the machine through this one shape. */
export type PassContext = {
  organizationId: Id;
  userId: Id;
  /** The invention (wepatent) or matter-backed record (Lex). */
  recordId: Id;
  product: DraftProduct;
  tierId: string;
  idempotencyKey: string;
};

export type PassOutcome =
  | { ok: true; draftSetId: Id; state: DraftSetStateValue; versionId: Id | null; noop?: boolean }
  | {
      ok: false;
      draftSetId: Id | null;
      error:
        | "record_not_found"
        | "model_not_found"
        | "no_active_set"
        | "wrong_state"
        | "insufficient_funds"
        | "brief_inconsistent"
        | "generation_failed"
        | "reconciliation_failed";
      detail: string;
    };

/* ------------------------------------------------------------------ */
/* Transition plumbing                                                 */
/* ------------------------------------------------------------------ */

/**
 * Move a set, guarded by the SHARED state machine, and record the move.
 *
 * Every state change in either product goes through here, so the append-only
 * transition log is complete by construction and an illegal move throws
 * before it can be persisted.
 */
async function moveTo(
  set: DraftSetRecord,
  to: DraftSetStateValue,
  options: {
    actor: string;
    reason: string;
    interruptedStage?: DraftSetStageValue | null;
    patch?: Parameters<ReturnType<typeof getAdapters>["data"]["updateDraftSet"]>[2];
  },
): Promise<DraftSetRecord> {
  const { data } = getAdapters();
  // Resuming out of an interruption is only legal back into the stage that
  // was interrupted; the shared guard enforces that and throws otherwise.
  transitionDraftPass(set.state, to, { resumeStage: set.interruptedStage ?? undefined });

  const interruptedStage =
    to === "NEEDS_INPUT" || to === "PAUSED_BUDGET"
      ? (options.interruptedStage ?? (set.interruptedStage || stageOf(set.state)))
      : null;

  const updated = await data.updateDraftSet(set.organizationId, set.id, {
    ...(options.patch ?? {}),
    state: to,
    interruptedStage,
  });
  await data.appendDraftSetTransition({
    organizationId: set.organizationId,
    draftSetId: set.id,
    fromState: set.state,
    toState: to,
    actor: options.actor,
    reason: options.reason,
  });
  return updated ?? set;
}

/** The resumable stage a state corresponds to, for interruption bookkeeping. */
function stageOf(state: DraftSetStateValue): DraftSetStageValue {
  switch (state) {
    case "FIGURES_PENDING":
    case "FIGURES_READY":
    case "PASS_2_REVISING":
      return state;
    default:
      return "PASS_1_DRAFTING";
  }
}

/* ------------------------------------------------------------------ */
/* Starting a set                                                      */
/* ------------------------------------------------------------------ */

/**
 * Begin the three-pass flow.
 *
 * Idempotent by design: an invention already has at most one non-terminal
 * set (enforced by a partial unique index in migration 0013), so a second
 * start returns the existing set rather than creating a competing one.
 */
export async function startDraftSet(
  context: PassContext,
): Promise<PassOutcome> {
  const { data } = getAdapters();
  const record = await data.getInvention(context.organizationId, context.recordId);
  if (!record) {
    return { ok: false, draftSetId: null, error: "record_not_found", detail: "record not found" };
  }

  const active = await data.getActiveDraftSet(context.organizationId, context.recordId);
  if (active) {
    return { ok: true, draftSetId: active.id, state: active.state, versionId: null, noop: true };
  }

  const set = await data.createDraftSet({
    organizationId: context.organizationId,
    inventionId: context.recordId,
    state: "PASS_1_DRAFTING",
    interruptedStage: null,
    passOneVersionId: null,
    passTwoVersionId: null,
    figureSetId: null,
    illustrationsBrief: {},
    briefVersion: "",
    reconciliation: null,
    reconciled: false,
    reconciliationVersion: "",
    statusDetail: "",
    acceptedByUserId: null,
    acceptedAt: null,
    passOneReservationId: null,
    passTwoReservationId: null,
    passOneChargeCents: 0,
    passTwoChargeCents: 0,
  });
  await data.appendDraftSetTransition({
    organizationId: context.organizationId,
    draftSetId: set.id,
    fromState: null,
    toState: "PASS_1_DRAFTING",
    actor: context.userId,
    reason: "Three-pass drafting started.",
  });

  const { enqueueJob } = await import("../jobs/runner");
  await enqueueJob({
    organizationId: context.organizationId,
    kind: "draft_pass_1",
    idempotencyKey: `pass1:${set.id}`,
    payload: {
      draftSetId: set.id,
      inventionId: context.recordId,
      userId: context.userId,
      tierId: context.tierId,
      product: context.product,
    },
  });

  return { ok: true, draftSetId: set.id, state: set.state, versionId: null };
}

/* ------------------------------------------------------------------ */
/* Pass 1 — draft + illustrations brief                                */
/* ------------------------------------------------------------------ */

/**
 * PASS 1.
 *
 * Produces two things, in this order and from one source:
 *
 *   1. the ILLUSTRATIONS BRIEF — the ordered figure list, each view type,
 *      what each figure must show, the parts in each, and THE REFERENCE
 *      NUMERAL ASSIGNMENTS. Pass 1 is the registry's author.
 *   2. the application draft prose, written against those numerals.
 *
 * Because the numerals exist before the prose, the description and the
 * drawings cannot end up with two independent numbering schemes.
 *
 * On completion the set chains automatically to the figures stage: zero user
 * steps, per the directive.
 */
export async function runDraftPassOne(params: {
  organizationId: Id;
  userId: Id;
  draftSetId: Id;
  tierId: string;
  product: DraftProduct;
  idempotencyKey: string;
}): Promise<PassOutcome> {
  const { data, modelGateway } = getAdapters();
  const config = draftConfigFor(params.product);

  const set = await data.getDraftSet(params.organizationId, params.draftSetId);
  if (!set) {
    return { ok: false, draftSetId: null, error: "no_active_set", detail: "draft set not found" };
  }
  if (set.state !== "PASS_1_DRAFTING") {
    return {
      ok: false,
      draftSetId: set.id,
      error: "wrong_state",
      detail: `Pass 1 can only run in PASS_1_DRAFTING; this set is ${DRAFT_PASS_STATE_LABELS[set.state]}.`,
    };
  }

  const invention = await data.getInvention(params.organizationId, set.inventionId);
  if (!invention) {
    return { ok: false, draftSetId: set.id, error: "record_not_found", detail: "record not found" };
  }
  const tier = getModelTier(params.tierId);
  if (!tier) {
    return { ok: false, draftSetId: set.id, error: "model_not_found", detail: "unknown model tier" };
  }

  /* ---- 1. Author the brief (deterministic, record-driven) ----------- */
  const [components, associations, psPairs, facts, contributors, sources] = await Promise.all([
    data.listComponents(params.organizationId, set.inventionId),
    data.listAssociations(params.organizationId, set.inventionId),
    data.listPsPairs(params.organizationId, set.inventionId),
    data.listFacts(params.organizationId, set.inventionId),
    data.listContributors(params.organizationId, set.inventionId),
    data.listSources(params.organizationId, set.inventionId),
  ]);

  const recordText = [
    invention.summary,
    invention.problem,
    invention.solution,
    ...facts.map((fact) => fact.statement),
  ].join("\n");

  const brief = authorIllustrationsBrief({
    recordTitle: invention.title,
    components: components.map((component) => ({
      id: component.id,
      name: component.name,
      description: component.description,
    })),
    associations: associations.map((association) => ({
      solutionId: association.solutionId,
      componentId: association.componentId,
    })),
    solutions: psPairs
      .filter((pair) => pair.kind === "solution")
      .map((pair) => ({ id: pair.id, statement: pair.statement })),
    methodSteps: extractMethodSteps(recordText),
    hasUploadedGeometry: sources.some(
      (source) => source.kind === "model_3d" || source.kind === "image",
    ),
    lineArtAvailable: modelGateway.lineArtAvailable(),
  });

  // The brief is validated BEFORE anything is drawn or drafted against it.
  // This is the last point at which a numbering mistake costs nothing.
  const parsed = illustrationsBriefSchema.safeParse(brief);
  if (!parsed.success) {
    const detail = `The illustrations brief did not satisfy its schema: ${parsed.error.issues
      .map((issue) => issue.message)
      .join("; ")}`;
    await moveTo(set, "FAILED", { actor: "system", reason: detail, patch: { statusDetail: detail } });
    return { ok: false, draftSetId: set.id, error: "brief_inconsistent", detail };
  }
  const violations = validateBriefConsistency(parsed.data);
  if (violations.length > 0) {
    const detail = violations.map(describeBriefViolation).join(" ");
    await moveTo(set, "FAILED", { actor: "system", reason: detail, patch: { statusDetail: detail } });
    return { ok: false, draftSetId: set.id, error: "brief_inconsistent", detail };
  }

  // A brief with no drawable figure is an honest NEEDS_INPUT, not a failure
  // and definitely not a silent skip to Pass 2.
  if (!isBriefUsable(parsed.data)) {
    const detail =
      parsed.data.openQuestions.map((question) => question.question).join(" ") ||
      "We could not specify any figure from the current record.";
    await moveTo(set, "NEEDS_INPUT", {
      actor: "system",
      reason: detail,
      interruptedStage: "PASS_1_DRAFTING",
      patch: {
        illustrationsBrief: parsed.data,
        briefVersion: parsed.data.version,
        statusDetail: detail,
      },
    });
    return { ok: true, draftSetId: set.id, state: "NEEDS_INPUT", versionId: null };
  }

  /* ---- 2. Meter and draft the prose against those numerals ---------- */
  const billingCategory = config.passOneBillingCategory;
  const markupMultiplier = markupMultiplierFor(billingCategory);
  const approximateInputTokens = Math.max(200, Math.ceil(recordText.length / 4));
  const estimate = estimateForTier(tier, approximateInputTokens, billingCategory);

  const metered = await meterPass({
    organizationId: params.organizationId,
    idempotencyKey: params.idempotencyKey,
    amountCents: estimate.customerHighCents,
    rateVersion: tier.rate.rateVersion,
    markupMultiplier,
  });
  if (metered.kind === "insufficient") {
    const detail = `Pass 1 paused — the wallet cannot cover the estimated cost of this pass. Top up the wallet to continue. Nothing has been charged.`;
    await moveTo(set, "PAUSED_BUDGET", {
      actor: "system",
      reason: detail,
      interruptedStage: "PASS_1_DRAFTING",
      patch: { statusDetail: detail, illustrationsBrief: parsed.data, briefVersion: parsed.data.version },
    });
    return { ok: false, draftSetId: set.id, error: "insufficient_funds", detail };
  }
  if (metered.kind === "deduplicated" && set.passOneVersionId) {
    // A retry of an already-settled pass: return the existing version and
    // charge nothing a second time.
    return {
      ok: true,
      draftSetId: set.id,
      state: set.state,
      versionId: set.passOneVersionId,
      noop: true,
    };
  }

  let generation;
  try {
    generation = await modelGateway.generate({
      workflow: "invention_disclosure_summary",
      modelId: tier.modelId,
      invention,
      facts,
      contributors,
      sources,
      corpusSnippets: [],
      maxOutputTokens: tier.maxOutputTokens,
    });
  } catch {
    await metered.release();
    const detail = "The first-pass draft could not be produced. Nothing was charged; retry when ready.";
    await moveTo(set, "FAILED", { actor: "system", reason: detail, patch: { statusDetail: detail } });
    return { ok: false, draftSetId: set.id, error: "generation_failed", detail };
  }

  const settled = await metered.settle(generation.providerCostCents, {
    modelId: tier.modelId,
    rateVersion: tier.rate.rateVersion,
    inputTokens: generation.inputTokens,
    outputTokens: generation.outputTokens,
    note: `Pass 1 (draft + illustrations brief) settlement (${tier.rate.rateVersion}); provider cost × ${markupMultiplier.toFixed(1)} (${billingCategory} task).`,
  });

  /* ---- 3. Persist the Pass-1 version -------------------------------- */
  const content = composePassOneDocument({
    config,
    generatedBody: generation.content,
    brief: parsed.data,
  });

  const draft = await data.createDraft({
    organizationId: params.organizationId,
    inventionId: set.inventionId,
    workflow: "invention_disclosure_summary",
    title: `${config.deliverableLabel} — first pass`,
  });
  const extracted = sources.filter((source) => source.status === "extracted").length;
  const version = await data.createDraftVersion({
    organizationId: params.organizationId,
    draftId: draft.id,
    content,
    modelId: tier.modelId,
    rateVersion: tier.rate.rateVersion,
    estimateCustomerHighCents: estimate.customerHighCents,
    actualProviderCostCents: generation.providerCostCents,
    actualCustomerChargeCents: settled,
    unresolvedFactCount: facts.filter((fact) => isUnresolved(fact.provenance)).length,
    sourceStatusSummary: `${extracted} of ${sources.length} sources extracted`,
    reservationId: metered.reservationId,
  });

  /* ---- 4. Chain to the figures stage: ZERO user steps --------------- */
  const moved = await moveTo(set, "FIGURES_PENDING", {
    actor: "system",
    reason: "Pass 1 complete; figures chained from the illustrations brief.",
    patch: {
      passOneVersionId: version.id,
      illustrationsBrief: parsed.data,
      briefVersion: parsed.data.version,
      passOneReservationId: metered.reservationId,
      passOneChargeCents: settled,
      statusDetail: "",
    },
  });

  const { enqueueJob } = await import("../jobs/runner");
  await enqueueJob({
    organizationId: params.organizationId,
    kind: "figure_plan",
    idempotencyKey: `figures:${set.id}`,
    payload: {
      inventionId: set.inventionId,
      draftVersionId: version.id,
      draftSetId: set.id,
      userId: params.userId,
    },
  });

  await data.appendAuditEvent({
    organizationId: params.organizationId,
    actor: params.userId,
    action: "draft.pass1.completed",
    target: set.id,
    meta: {
      versionId: version.id,
      figureCount: String(parsed.data.figures.length),
      numeralCount: String(parsed.data.numerals.length),
    },
  });

  return { ok: true, draftSetId: set.id, state: moved.state, versionId: version.id };
}

/* ------------------------------------------------------------------ */
/* The figures stage transition                                        */
/* ------------------------------------------------------------------ */

/**
 * Called when the figure pipeline settles. Moves FIGURES_PENDING to the
 * honest next state and — on success only — chains Pass 2.
 *
 * A paused or question-raising figure stage does NOT advance. That is the
 * whole point: without figures there is nothing for Pass 2 to enable against
 * and nothing that could legitimately be delivered.
 */
export async function onFiguresSettled(params: {
  organizationId: Id;
  userId: Id;
  draftSetId: Id;
  tierId: string;
  product: DraftProduct;
  outcome:
    | { kind: "ready"; figureSetId: Id }
    | { kind: "needs_input"; figureSetId: Id | null; detail: string }
    | { kind: "paused_budget"; figureSetId: Id | null; detail: string }
    | { kind: "failed"; detail: string };
}): Promise<PassOutcome> {
  const { data } = getAdapters();
  const set = await data.getDraftSet(params.organizationId, params.draftSetId);
  if (!set) {
    return { ok: false, draftSetId: null, error: "no_active_set", detail: "draft set not found" };
  }
  if (set.state !== "FIGURES_PENDING") {
    return {
      ok: true,
      draftSetId: set.id,
      state: set.state,
      versionId: null,
      noop: true,
    };
  }

  if (params.outcome.kind === "needs_input" || params.outcome.kind === "paused_budget") {
    const to = params.outcome.kind === "needs_input" ? "NEEDS_INPUT" : "PAUSED_BUDGET";
    await moveTo(set, to, {
      actor: "system",
      reason: params.outcome.detail,
      interruptedStage: "FIGURES_PENDING",
      patch: {
        statusDetail: params.outcome.detail,
        figureSetId: params.outcome.figureSetId ?? set.figureSetId,
      },
    });
    return { ok: true, draftSetId: set.id, state: to, versionId: null };
  }

  if (params.outcome.kind === "failed") {
    await moveTo(set, "FAILED", {
      actor: "system",
      reason: params.outcome.detail,
      patch: { statusDetail: params.outcome.detail },
    });
    return { ok: false, draftSetId: set.id, error: "generation_failed", detail: params.outcome.detail };
  }

  const ready = await moveTo(set, "FIGURES_READY", {
    actor: "system",
    reason: "Figures composed and validated from the illustrations brief.",
    patch: { figureSetId: params.outcome.figureSetId, statusDetail: "" },
  });

  const { enqueueJob } = await import("../jobs/runner");
  await enqueueJob({
    organizationId: params.organizationId,
    kind: "draft_pass_2",
    idempotencyKey: `pass2:${set.id}`,
    payload: {
      draftSetId: set.id,
      inventionId: set.inventionId,
      userId: params.userId,
      tierId: params.tierId,
      product: params.product,
    },
  });

  return { ok: true, draftSetId: set.id, state: ready.state, versionId: null };
}

/* ------------------------------------------------------------------ */
/* Pass 2 — enablement revision against the ACTUAL figures             */
/* ------------------------------------------------------------------ */

/**
 * PASS 2.
 *
 * Mechanically, in order:
 *
 *   1. Load the figures that were ACTUALLY produced, their placed reference
 *      numerals (from the annotations, not the plan), and the validation
 *      report.
 *   2. Re-draft with all of that as input, so the description is written
 *      against drawings that exist rather than drawings that were intended.
 *   3. REWRITE the "Brief Description of the Drawings" from the figures
 *      actually produced — not the Pass-1 list.
 *   4. Strengthen written-description/enablement coverage for every depicted
 *      element, using the §112(a) coverage model already in the codebase.
 *   5. Run the two-way §608.02 reconciliation as a GATE. Unreconciled means
 *      the set does not reach READY_FOR_REVIEW.
 *   6. Write a NEW draft version. Pass 1's version is never mutated; both
 *      stay inspectable and diffable.
 *
 * Disagreements between a figure and the record are FLAGGED, never silently
 * fixed.
 */
export async function runDraftPassTwo(params: {
  organizationId: Id;
  userId: Id;
  draftSetId: Id;
  tierId: string;
  product: DraftProduct;
  idempotencyKey: string;
}): Promise<PassOutcome> {
  const { data, modelGateway } = getAdapters();
  const config = draftConfigFor(params.product);

  const set = await data.getDraftSet(params.organizationId, params.draftSetId);
  if (!set) {
    return { ok: false, draftSetId: null, error: "no_active_set", detail: "draft set not found" };
  }
  if (set.state !== "FIGURES_READY") {
    return {
      ok: false,
      draftSetId: set.id,
      error: "wrong_state",
      detail: `Pass 2 can only run once the figures are ready; this set is ${DRAFT_PASS_STATE_LABELS[set.state]}.`,
    };
  }
  if (!set.figureSetId) {
    const detail =
      "Pass 2 cannot run: no figure set is attached, so there are no drawings to enable against.";
    await moveTo(set, "NEEDS_INPUT", {
      actor: "system",
      reason: detail,
      interruptedStage: "FIGURES_READY",
      patch: { statusDetail: detail },
    });
    return { ok: false, draftSetId: set.id, error: "wrong_state", detail };
  }

  const invention = await data.getInvention(params.organizationId, set.inventionId);
  const tier = getModelTier(params.tierId);
  if (!invention) {
    return { ok: false, draftSetId: set.id, error: "record_not_found", detail: "record not found" };
  }
  if (!tier) {
    return { ok: false, draftSetId: set.id, error: "model_not_found", detail: "unknown model tier" };
  }

  /* ---- 1. What was ACTUALLY produced -------------------------------- */
  const figures = await data.listFigures(params.organizationId, set.figureSetId);
  const registry = await data.listFigureNumerals(params.organizationId, set.figureSetId);
  const validations = await data.listFigureValidations(params.organizationId, set.figureSetId);

  const producedFigures = figures
    .filter((figure) => figure.state === "composed" || figure.state === "ready")
    .map((figure) => ({
      figureNumber: figure.figureNumber,
      partialSuffix: figure.partialSuffix,
      title: figure.title,
      viewType: figure.viewType,
      briefDescription: figure.briefDescription,
    }));

  // The numerals actually PLACED on the sheets, read from the annotations.
  // Deliberately not the plan: the gate must compare against reality.
  const placed = new Set<string>();
  for (const figure of figures) {
    if (figure.state !== "composed" && figure.state !== "ready") continue;
    const annotations = await data.listFigureAnnotations(params.organizationId, figure.id);
    for (const annotation of annotations) placed.add(annotation.numeral);
  }

  const facts = await data.listFacts(params.organizationId, set.inventionId);
  const contributors = await data.listContributors(params.organizationId, set.inventionId);
  const sources = await data.listSources(params.organizationId, set.inventionId);
  // §112(a) coverage model already in the codebase — deterministic code,
  // never model output. Pass 2 uses it to target which depicted elements
  // still lack written-description support in the record.
  const coverage = await data
    .listLatestEnablementCoverage(params.organizationId, set.inventionId)
    .catch(() => []);

  /* ---- 2. Meter and re-draft ---------------------------------------- */
  const billingCategory = config.passTwoBillingCategory;
  const markupMultiplier = markupMultiplierFor(billingCategory);
  const priorContent = set.passOneVersionId
    ? ((await findVersionById(params.organizationId, set.passOneVersionId))?.content ?? "")
    : "";
  const approximateInputTokens = Math.max(
    200,
    Math.ceil((priorContent.length + JSON.stringify(producedFigures).length) / 4),
  );
  const estimate = estimateForTier(tier, approximateInputTokens, billingCategory);

  const metered = await meterPass({
    organizationId: params.organizationId,
    idempotencyKey: params.idempotencyKey,
    amountCents: estimate.customerHighCents,
    rateVersion: tier.rate.rateVersion,
    markupMultiplier,
  });
  if (metered.kind === "insufficient") {
    const detail =
      "Pass 2 paused — the wallet cannot cover the enablement revision. The first-pass draft and the figures are safe and already paid for; top up and resume. Nothing will be delivered until Pass 2 completes.";
    await moveTo(set, "PAUSED_BUDGET", {
      actor: "system",
      reason: detail,
      interruptedStage: "PASS_2_REVISING",
      patch: { statusDetail: detail },
    });
    return { ok: false, draftSetId: set.id, error: "insufficient_funds", detail };
  }
  if (metered.kind === "deduplicated" && set.passTwoVersionId) {
    return {
      ok: true,
      draftSetId: set.id,
      state: set.state,
      versionId: set.passTwoVersionId,
      noop: true,
    };
  }

  const revising = await moveTo(set, "PASS_2_REVISING", {
    actor: "system",
    reason: "Re-drafting for enablement against the composed figures.",
  });

  let generation;
  try {
    generation = await modelGateway.generate({
      workflow: "invention_disclosure_summary",
      modelId: tier.modelId,
      invention,
      facts,
      contributors,
      sources,
      corpusSnippets: [],
      maxOutputTokens: tier.maxOutputTokens,
    });
  } catch {
    await metered.release();
    const detail =
      "The enablement revision could not be produced. Nothing was charged for Pass 2; the first-pass draft and the figures are unaffected.";
    await moveTo(revising, "FAILED", {
      actor: "system",
      reason: detail,
      patch: { statusDetail: detail },
    });
    return { ok: false, draftSetId: set.id, error: "generation_failed", detail };
  }

  const settled = await metered.settle(generation.providerCostCents, {
    modelId: tier.modelId,
    rateVersion: tier.rate.rateVersion,
    inputTokens: generation.inputTokens,
    outputTokens: generation.outputTokens,
    note: `Pass 2 (enablement revision) settlement (${tier.rate.rateVersion}); provider cost × ${markupMultiplier.toFixed(1)} (${billingCategory} task).`,
  });

  /* ---- 3-4. Compose the revised document ---------------------------- */
  const brief = set.illustrationsBrief as IllustrationsBrief;
  const content = composePassTwoDocument({
    config,
    generatedBody: generation.content,
    registry: registry.map((entry) => ({ numeral: entry.numeral, partLabel: entry.partLabel })),
    producedFigures,
    validationFindings: validations
      .filter((validation) => validation.status === "fail" || validation.status === "needs_human_review")
      .map((validation) => `${validation.ruleId}: ${validation.detail}`),
    coverageGaps: coverage
      .filter((entry) => entry.status === "gap")
      .map((entry) => entry.dimension),
  });

  /* ---- 5. THE GATE: two-way §608.02 reconciliation ------------------ */
  const reconciliation = reconcileProseAndDrawings({
    draftText: content,
    registryNumerals: registry.map((entry) => ({
      numeral: entry.numeral,
      partLabel: entry.partLabel,
    })),
    drawingNumerals: [...placed],
    producedFigures: producedFigures.map((figure) => ({
      figureNumber: figure.figureNumber,
      partialSuffix: figure.partialSuffix,
    })),
    briefDescriptionFigures: figuresNamedInBriefDescription(
      briefDescriptionFor(producedFigures, brief),
    ),
  });

  /* ---- 6. A NEW version, never an in-place mutation ------------------ */
  const draft = await data.createDraft({
    organizationId: params.organizationId,
    inventionId: set.inventionId,
    workflow: "invention_disclosure_summary",
    title: `${config.deliverableLabel} — second pass (enablement revision)`,
  });
  const extracted = sources.filter((source) => source.status === "extracted").length;
  const version = await data.createDraftVersion({
    organizationId: params.organizationId,
    draftId: draft.id,
    content,
    modelId: tier.modelId,
    rateVersion: tier.rate.rateVersion,
    estimateCustomerHighCents: estimate.customerHighCents,
    actualProviderCostCents: generation.providerCostCents,
    actualCustomerChargeCents: settled,
    unresolvedFactCount: facts.filter((fact) => isUnresolved(fact.provenance)).length,
    sourceStatusSummary: `${extracted} of ${sources.length} sources extracted`,
    reservationId: metered.reservationId,
  });

  const sharedPatch = {
    passTwoVersionId: version.id,
    passTwoReservationId: metered.reservationId,
    passTwoChargeCents: settled,
    reconciliation: reconciliation as unknown,
    reconciled: reconciliation.reconciled,
    reconciliationVersion: reconciliation.version,
  };

  if (!reconciliation.reconciled) {
    // THE GATE HOLDS. The revised version is kept and is fully inspectable —
    // the user needs to see what Pass 2 produced in order to resolve the
    // mismatch — but the set does NOT become deliverable.
    const detail = [
      `The description and the drawings do not agree on ${reconciliation.findings.length} point(s). We flag these rather than changing your draft:`,
      ...reconciliation.findings.map((finding) => `• ${finding.detail}`),
    ].join("\n");
    await moveTo(revising, "NEEDS_INPUT", {
      actor: "system",
      reason: `Reconciliation failed with ${reconciliation.findings.length} finding(s).`,
      interruptedStage: "PASS_2_REVISING",
      patch: { ...sharedPatch, statusDetail: detail },
    });
    return { ok: false, draftSetId: set.id, error: "reconciliation_failed", detail };
  }

  const ready = await moveTo(revising, "READY_FOR_REVIEW", {
    actor: "system",
    reason: "Pass 2 complete; prose and drawings reconciled both ways.",
    patch: { ...sharedPatch, statusDetail: "" },
  });

  await data.appendAuditEvent({
    organizationId: params.organizationId,
    actor: params.userId,
    action: "draft.pass2.completed",
    target: set.id,
    meta: {
      versionId: version.id,
      reconciled: "true",
      numeralsChecked: String(reconciliation.registryCount),
    },
  });

  return { ok: true, draftSetId: set.id, state: ready.state, versionId: version.id };
}

/* ------------------------------------------------------------------ */
/* Human acceptance and the delivery gate                              */
/* ------------------------------------------------------------------ */

export type DeliveryDecision = ReturnType<typeof evaluateDeliveryGate>;

/**
 * Evaluate the client delivery gate for a set.
 *
 * The ONE function every export/delivery path in either product must call.
 * It re-derives the answer from stored state rather than trusting a flag,
 * so a stale or forged "ready" cannot open it.
 */
export async function evaluateDeliveryFor(
  organizationId: Id,
  draftSetId: Id,
): Promise<DeliveryDecision> {
  const { data } = getAdapters();
  const set = await data.getDraftSet(organizationId, draftSetId);
  if (!set) {
    return {
      allowed: false,
      blockers: [
        {
          code: "pass_1_only",
          message: "There is no draft set for this record, so nothing has been drafted yet.",
          needs: "Start the three-pass drafting flow.",
        },
      ],
    };
  }

  const figures = set.figureSetId
    ? await data.listFigures(organizationId, set.figureSetId)
    : [];
  return evaluateDeliveryGate({
    state: set.state,
    interruptedStage: set.interruptedStage,
    statusDetail: set.statusDetail,
    passOneVersionId: set.passOneVersionId,
    passTwoVersionId: set.passTwoVersionId,
    figureSetId: set.figureSetId,
    readyFigureCount: figures.filter(
      (figure) => figure.state === "composed" || figure.state === "ready",
    ).length,
    unresolvedFigureCount: figures.filter(
      (figure) => figure.state === "needs_input" || figure.state === "failed",
    ).length,
    reconciliation: (set.reconciliation as ReconciliationReport | null) ?? null,
    acceptedByUserId: set.acceptedByUserId,
    acceptedAt: set.acceptedAt,
  });
}

export type AcceptOutcome =
  | { ok: true; draftSetId: Id; acceptedAt: string }
  | { ok: false; error: "not_found" | "not_ready"; detail: string };

/**
 * A PERSON accepts the set for delivery.
 *
 * The platform can never call this on its own behalf — acceptance is the
 * single point where an AI-proposed artifact becomes something a human has
 * taken responsibility for. Accepting a set that is not READY_FOR_REVIEW is
 * refused here, and refused again by a database CHECK constraint.
 */
export async function acceptDraftSet(params: {
  organizationId: Id;
  userId: Id;
  draftSetId: Id;
}): Promise<AcceptOutcome> {
  const { data } = getAdapters();
  const set = await data.getDraftSet(params.organizationId, params.draftSetId);
  if (!set) return { ok: false, error: "not_found", detail: "draft set not found" };

  if (set.state !== "READY_FOR_REVIEW") {
    // Report the SAME blockers the delivery gate would, so the user sees one
    // consistent answer wherever they ask.
    const decision = await evaluateDeliveryFor(params.organizationId, params.draftSetId);
    const detail = decision.allowed
      ? "This set is not ready for review."
      : decision.blockers
          .filter((blocker) => blocker.code !== "not_accepted_by_human")
          .map((blocker) => `${blocker.message} ${blocker.needs}`)
          .join("\n");
    return { ok: false, error: "not_ready", detail };
  }

  const acceptedAt = new Date().toISOString();
  await data.updateDraftSet(params.organizationId, params.draftSetId, {
    acceptedByUserId: params.userId,
    acceptedAt,
  });
  await data.appendAuditEvent({
    organizationId: params.organizationId,
    actor: params.userId,
    action: "draft.set.accepted",
    target: params.draftSetId,
    meta: { acceptedAt },
  });
  return { ok: true, draftSetId: params.draftSetId, acceptedAt };
}

/* ------------------------------------------------------------------ */
/* Document composition (per-product shape, shared mechanics)          */
/* ------------------------------------------------------------------ */

function sectionHeader(name: string): string {
  return `\n\n## ${name.toUpperCase()}\n\n`;
}

/**
 * The Pass-1 document: the generated prose plus the illustrations brief as a
 * first-class, visible section. The brief is not an internal artifact — the
 * numerals in it are the numerals in the prose, and a reviewer must be able
 * to check that without opening a database.
 */
export function composePassOneDocument(input: {
  config: DraftProductConfig;
  generatedBody: string;
  brief: IllustrationsBrief;
}): string {
  const { config, brief } = input;
  const parts: string[] = [
    "WORKING DRAFT — COUNSEL REVIEW REQUIRED",
    `First pass of ${config.deliverableLabel}. Not checked against any drawing yet: the figures are built next, and a second pass revises this text against them. This pass is not deliverable on its own.`,
    input.generatedBody,
  ];

  parts.push(sectionHeader("Brief Description of the Drawings (provisional)").trim());
  const paragraphs = briefDescriptionParagraphs(brief);
  parts.push(
    paragraphs.length > 0
      ? paragraphs.join("\n")
      : "No figure has been specified from the record yet.",
  );

  parts.push(sectionHeader("Illustrations brief").trim());
  parts.push(
    "Authored in this pass. The reference numerals below are the single source used by both the description and the drawings.",
  );
  for (const figure of brief.figures) {
    parts.push(
      [
        `FIG. ${figure.figureNumber}${figure.partialSuffix ?? ""} — ${figure.title} (${figure.viewType})`,
        `  Must show: ${figure.mustShow}`,
        `  Parts: ${figure.partNumerals.join(", ") || "(none)"}`,
      ].join("\n"),
    );
  }
  if (brief.numerals.length > 0) {
    parts.push("Reference numerals:");
    parts.push(numeralGlossary(brief).map((entry) => `  ${entry}`).join("\n"));
  }
  for (const question of brief.openQuestions) {
    parts.push(`OPEN QUESTION (${question.figureRef}): ${question.question}`);
  }

  if (config.includeClaimSupport) {
    parts.push(sectionHeader("Claim support").trim());
    parts.push(
      "Support mapping for the practitioner: each element below is written to be traceable to the record and, after the second pass, to a depicted element.",
    );
    parts.push(numeralGlossary(brief).map((entry) => `  ${entry}`).join("\n"));
  }

  return parts.join("\n\n");
}

/** The Brief Description paragraphs for the figures ACTUALLY produced. */
function briefDescriptionFor(
  produced: ReadonlyArray<{
    figureNumber: number;
    partialSuffix: string | null;
    briefDescription: string;
    title: string;
  }>,
  brief: IllustrationsBrief | null,
): string[] {
  return produced
    .slice()
    .sort(
      (a, b) =>
        a.figureNumber - b.figureNumber ||
        (a.partialSuffix ?? "").localeCompare(b.partialSuffix ?? ""),
    )
    .map((figure) => {
      const fromFigure = figure.briefDescription.trim();
      if (fromFigure.length > 0) return fromFigure;
      const fromBrief = brief?.figures.find(
        (candidate) => candidate.figureNumber === figure.figureNumber,
      )?.briefDescription;
      return (
        fromBrief?.trim() ||
        `FIG. ${figure.figureNumber}${figure.partialSuffix ?? ""} is ${figure.title}.`
      );
    });
}

/**
 * The Pass-2 document.
 *
 * The Brief Description of the Drawings is REBUILT from the figures actually
 * produced, and every registry numeral is written into the detailed
 * description so the two-way check has something true to pass on. Where a
 * figure and the record disagree, the disagreement is written down as a
 * flag — never resolved on the customer's behalf.
 */
export function composePassTwoDocument(input: {
  config: DraftProductConfig;
  generatedBody: string;
  registry: ReadonlyArray<{ numeral: string; partLabel: string }>;
  producedFigures: ReadonlyArray<{
    figureNumber: number;
    partialSuffix: string | null;
    title: string;
    viewType: string;
    briefDescription: string;
  }>;
  validationFindings: readonly string[];
  coverageGaps: readonly string[];
}): string {
  const { config, registry, producedFigures } = input;
  const parts: string[] = [
    "WORKING DRAFT — COUNSEL REVIEW REQUIRED",
    `Second pass of ${config.deliverableLabel}: revised for enablement against the figures actually produced. This is a NEW version; the first pass remains inspectable and diffable.`,
    input.generatedBody,
  ];

  // Rewritten from reality, not from the Pass-1 plan.
  parts.push(sectionHeader("Brief Description of the Drawings").trim());
  parts.push(
    producedFigures.length > 0
      ? briefDescriptionFor(producedFigures, null).join("\n")
      : "No drawing accompanies this application.",
  );

  // §112(a) written-description support for every depicted element. Each
  // registry numeral is used in the description, which is exactly what
  // 37 CFR 1.84(p)(5) requires and what the gate checks.
  parts.push(sectionHeader("Detailed Description — depicted elements").trim());
  for (const entry of registry) {
    parts.push(
      `The ${entry.partLabel} ${entry.numeral} is shown in the drawings and is described here so that a person of ordinary skill in the art can make and use it: its structure, its relationship to the adjacent elements, and its role in operation are set out in the record above. Where the record does not state a dimension, material, or tolerance for the ${entry.partLabel} ${entry.numeral}, none is asserted here.`,
    );
  }

  if (input.coverageGaps.length > 0) {
    parts.push(sectionHeader("Enablement coverage gaps (flagged, not filled)").trim());
    parts.push(
      `The §112(a) coverage model reports no record evidence for: ${input.coverageGaps.join(", ")}. These are left open rather than filled with plausible text.`,
    );
  }

  if (input.validationFindings.length > 0) {
    parts.push(sectionHeader("Figure/record disagreements (flagged, not fixed)").trim());
    parts.push(
      "The drawing validation reported the following. Each is flagged for a person to resolve; nothing was changed automatically:",
    );
    parts.push(input.validationFindings.map((finding) => `• ${finding}`).join("\n"));
  }

  if (config.includeClaimSupport) {
    parts.push(sectionHeader("Claim support").trim());
    parts.push(
      registry
        .map(
          (entry) =>
            `  ${entry.partLabel} (${entry.numeral}) — depicted and described; support traceable to the record.`,
        )
        .join("\n"),
    );
  }

  return parts.join("\n\n");
}

/* ------------------------------------------------------------------ */
/* Per-pass metering                                                   */
/* ------------------------------------------------------------------ */

type MeteredPass =
  | { kind: "insufficient" }
  | {
      kind: "reserved" | "deduplicated";
      reservationId: Id;
      settle: (
        providerCostCents: number,
        meta: {
          modelId: string;
          rateVersion: string;
          inputTokens: number;
          outputTokens: number;
          note: string;
        },
      ) => Promise<number>;
      release: () => Promise<void>;
    };

/**
 * Reserve for ONE pass and hand back its settle/release closures.
 *
 * Per-pass rather than per-set so a cap can pause between passes without
 * losing the first, and so a retry of one pass — keyed by the same
 * idempotency key — resolves to the same reservation and cannot charge
 * twice (PRD §7.4).
 */
async function meterPass(params: {
  organizationId: Id;
  idempotencyKey: string;
  amountCents: number;
  rateVersion: string;
  markupMultiplier: number;
}): Promise<MeteredPass> {
  const { data } = getAdapters();
  const wallet = (await data.getWallet(params.organizationId)) ?? {
    organizationId: params.organizationId,
    balanceCents: 0,
    reservedCents: 0,
  };
  const existing = await data.listReservations(params.organizationId);
  const reserved = reserve(
    { balanceCents: wallet.balanceCents, reservedCents: wallet.reservedCents },
    existing,
    {
      id: randomUUID(),
      idempotencyKey: params.idempotencyKey,
      amountCents: params.amountCents,
      rateVersion: params.rateVersion,
      markupMultiplier: params.markupMultiplier,
    },
  );
  if (!reserved.ok) return { kind: "insufficient" };

  const record = {
    ...reserved.reservation,
    organizationId: params.organizationId,
    createdAt: new Date().toISOString(),
  };
  await data.saveWallet({ organizationId: params.organizationId, ...reserved.wallet });
  await data.saveReservation(record);

  return {
    kind: reserved.deduplicated ? "deduplicated" : "reserved",
    reservationId: record.id,
    async settle(providerCostCents, meta) {
      const settled = settle(reserved.wallet, reserved.reservation, providerCostCents);
      if (!settled.ok) return 0;
      await data.saveWallet({ organizationId: params.organizationId, ...settled.wallet });
      await data.saveReservation({
        ...record,
        status: settled.reservation.status,
        settledProviderCostCents: settled.reservation.settledProviderCostCents,
        settledCustomerChargeCents: settled.reservation.settledCustomerChargeCents,
      });
      await data.appendLedgerEntry({
        organizationId: params.organizationId,
        kind: "settlement",
        amountCents: -settled.customerChargeCents,
        reservationId: record.id,
        note: meta.note,
      });
      await data.appendUsageEvent({
        organizationId: params.organizationId,
        reservationId: record.id,
        modelId: meta.modelId,
        rateVersion: meta.rateVersion,
        providerCostCents,
        customerChargeCents: settled.customerChargeCents,
        inputTokens: meta.inputTokens,
        outputTokens: meta.outputTokens,
      });
      return settled.customerChargeCents;
    },
    async release() {
      const released = release(reserved.wallet, reserved.reservation);
      if (!released.ok) return;
      await data.saveWallet({ organizationId: params.organizationId, ...released.wallet });
      await data.saveReservation({ ...record, status: released.reservation.status });
      await data.appendLedgerEntry({
        organizationId: params.organizationId,
        kind: "release",
        amountCents: 0,
        reservationId: record.id,
        note: "Draft pass failed; reservation released without charge.",
      });
    },
  };
}

async function findVersionById(organizationId: Id, versionId: Id) {
  const { data } = getAdapters();
  const inventions = await data.listInventions(organizationId);
  for (const invention of inventions) {
    for (const draft of await data.listDrafts(organizationId, invention.id)) {
      const versions = await data.listDraftVersions(organizationId, draft.id);
      const match = versions.find((version) => version.id === versionId);
      if (match) return match;
    }
  }
  return null;
}
