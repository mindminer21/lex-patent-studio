/**
 * THE DRAFT ORCHESTRATION STATE MACHINE (Jeff's directive, 2026-08-04).
 *
 * "Build a first copy of the patent draft with an illustrations brief
 *  (including reference numbers), then build the patent figures, and then
 *  come back to create a second version of the patent application draft
 *  fully enabling and checking against the patent figures before sending
 *  anything to the client. This needs to be the flow in both wepatent and
 *  the lex patent studio apps."
 *
 *   PASS_1_DRAFTING → FIGURES_PENDING → FIGURES_READY
 *                   → PASS_2_REVISING → READY_FOR_REVIEW
 *
 * plus the three honest branches: NEEDS_INPUT, PAUSED_BUDGET, FAILED.
 *
 * PRODUCT-AGNOSTIC ON PURPOSE. This module knows nothing about inventions,
 * matters, tiers, or documents. wepatent and Lex both drive the same machine
 * and differ only in the `DraftProductConfig` they pass to the orchestrator
 * (see `./product-config.ts`). "Do not fork the logic" is enforced by there
 * being exactly one transition table, here.
 *
 * WHY A RESUME TARGET EXISTS
 * --------------------------
 * NEEDS_INPUT and PAUSED_BUDGET are not stages, they are INTERRUPTIONS of a
 * stage. A set that pauses for budget during Pass 2 must come back to Pass 2,
 * not restart at Pass 1 and re-charge the customer for work already paid
 * for. So the interruption states carry the stage they interrupted, and the
 * only legal resume is back to that stage.
 */

export const DRAFT_PASS_STATES = [
  "PASS_1_DRAFTING",
  "FIGURES_PENDING",
  "FIGURES_READY",
  "PASS_2_REVISING",
  "READY_FOR_REVIEW",
  "NEEDS_INPUT",
  "PAUSED_BUDGET",
  "FAILED",
] as const;
export type DraftPassState = (typeof DRAFT_PASS_STATES)[number];

/** The ordered happy path. Interruption and terminal states are not in it. */
export const DRAFT_PASS_PIPELINE = [
  "PASS_1_DRAFTING",
  "FIGURES_PENDING",
  "FIGURES_READY",
  "PASS_2_REVISING",
  "READY_FOR_REVIEW",
] as const;
export type DraftPipelineState = (typeof DRAFT_PASS_PIPELINE)[number];

/** States a run can be interrupted INTO, and resumed OUT of. */
export const INTERRUPTED_STATES = ["NEEDS_INPUT", "PAUSED_BUDGET"] as const;
export type InterruptedState = (typeof INTERRUPTED_STATES)[number];

/**
 * Stages that actually perform work and can therefore be interrupted.
 * READY_FOR_REVIEW is not one: once a set is ready there is nothing left to
 * pause or ask about.
 */
export const RESUMABLE_STAGES = [
  "PASS_1_DRAFTING",
  "FIGURES_PENDING",
  "FIGURES_READY",
  "PASS_2_REVISING",
] as const;
export type ResumableStage = (typeof RESUMABLE_STAGES)[number];

export function isResumableStage(state: DraftPassState): state is ResumableStage {
  return (RESUMABLE_STAGES as readonly string[]).includes(state);
}

export function isInterruptedState(state: DraftPassState): state is InterruptedState {
  return (INTERRUPTED_STATES as readonly string[]).includes(state);
}

/**
 * READY_FOR_REVIEW and FAILED are terminal FOR THE MACHINE.
 *
 * READY_FOR_REVIEW is not the end of the product story — a human still has
 * to accept before anything is delivered (see `./delivery-gate.ts`) — but no
 * further automatic transition happens from it. FAILED can only leave via an
 * explicit human retry, which restarts at Pass 1.
 */
export const TERMINAL_DRAFT_PASS_STATES: ReadonlySet<DraftPassState> = new Set([
  "READY_FOR_REVIEW",
  "FAILED",
]);

export function isTerminalDraftPassState(state: DraftPassState): boolean {
  return TERMINAL_DRAFT_PASS_STATES.has(state);
}

/**
 * The single transition table. Both products read it; neither extends it.
 *
 * Note what is DELIBERATELY ABSENT:
 * - No edge from PASS_1_DRAFTING to PASS_2_REVISING. Pass 2 cannot run
 *   without figures; skipping the figures stage is the exact failure mode
 *   the directive exists to prevent.
 * - No edge from FIGURES_PENDING to READY_FOR_REVIEW. A Pass-1-only package
 *   can never become "ready" by any path.
 * - No edge out of READY_FOR_REVIEW. Re-drafting starts a new set.
 */
const TRANSITIONS: Record<DraftPassState, ReadonlySet<DraftPassState>> = {
  PASS_1_DRAFTING: new Set(["FIGURES_PENDING", "NEEDS_INPUT", "PAUSED_BUDGET", "FAILED"]),
  FIGURES_PENDING: new Set(["FIGURES_READY", "NEEDS_INPUT", "PAUSED_BUDGET", "FAILED"]),
  FIGURES_READY: new Set(["PASS_2_REVISING", "NEEDS_INPUT", "PAUSED_BUDGET", "FAILED"]),
  PASS_2_REVISING: new Set(["READY_FOR_REVIEW", "NEEDS_INPUT", "PAUSED_BUDGET", "FAILED"]),
  READY_FOR_REVIEW: new Set(),
  // An interruption resumes into the stage it interrupted, or gives up.
  NEEDS_INPUT: new Set([...RESUMABLE_STAGES, "PAUSED_BUDGET", "FAILED"]),
  PAUSED_BUDGET: new Set([...RESUMABLE_STAGES, "NEEDS_INPUT", "FAILED"]),
  // Retry after failure starts the whole set again, deliberately.
  FAILED: new Set(["PASS_1_DRAFTING"]),
};

export function canTransitionDraftPass(from: DraftPassState, to: DraftPassState): boolean {
  return TRANSITIONS[from]?.has(to) ?? false;
}

export class InvalidDraftPassTransitionError extends Error {
  constructor(
    public readonly from: DraftPassState,
    public readonly to: DraftPassState,
  ) {
    super(`Invalid draft-pass transition: ${from} → ${to}`);
    this.name = "InvalidDraftPassTransitionError";
  }
}

/**
 * Transition guard.
 *
 * `resumeStage` is required when leaving an interruption state: resuming is
 * only legal back into the stage that was interrupted. Resuming NEEDS_INPUT
 * raised during Pass 2 into Pass 1 would silently re-charge the customer for
 * Pass 1, so it is refused rather than allowed-and-audited.
 */
export function transitionDraftPass(
  from: DraftPassState,
  to: DraftPassState,
  options?: { resumeStage?: ResumableStage | null },
): DraftPassState {
  if (!canTransitionDraftPass(from, to)) {
    throw new InvalidDraftPassTransitionError(from, to);
  }
  if (isInterruptedState(from) && isResumableStage(to)) {
    const expected = options?.resumeStage ?? null;
    if (expected === null) {
      throw new InvalidDraftPassTransitionError(from, to);
    }
    if (expected !== to) {
      throw new InvalidDraftPassTransitionError(from, to);
    }
  }
  return to;
}

/** The next happy-path stage, or null at the end / off the path. */
export function nextDraftPassStage(state: DraftPassState): DraftPassState | null {
  const idx = (DRAFT_PASS_PIPELINE as readonly string[]).indexOf(state);
  if (idx === -1) return null;
  return idx + 1 < DRAFT_PASS_PIPELINE.length ? DRAFT_PASS_PIPELINE[idx + 1] : null;
}

/** 0..1 progress for UI stage meters. Interruptions hold their stage's value. */
export function draftPassProgress(
  state: DraftPassState,
  interruptedStage?: ResumableStage | null,
): number {
  if (state === "READY_FOR_REVIEW") return 1;
  if (state === "FAILED") return 0;
  const effective = isInterruptedState(state) ? (interruptedStage ?? "PASS_1_DRAFTING") : state;
  const idx = (DRAFT_PASS_PIPELINE as readonly string[]).indexOf(effective);
  return idx === -1 ? 0 : idx / (DRAFT_PASS_PIPELINE.length - 1);
}

export const DRAFT_PASS_STATE_LABELS: Record<DraftPassState, string> = {
  PASS_1_DRAFTING: "Pass 1 — drafting and illustrations brief",
  FIGURES_PENDING: "Building the figures from the illustrations brief",
  FIGURES_READY: "Figures composed and validated",
  PASS_2_REVISING: "Pass 2 — enablement revision against the figures",
  READY_FOR_REVIEW: "Ready for review",
  NEEDS_INPUT: "Needs your input",
  PAUSED_BUDGET: "Paused — budget cap reached",
  FAILED: "Failed",
};

/**
 * Which pass, if any, is spending money in this state. Used by the metering
 * layer so the estimate shown matches the pass about to run.
 */
export function billingPassFor(state: DraftPassState): 1 | 2 | null {
  if (state === "PASS_1_DRAFTING") return 1;
  if (state === "PASS_2_REVISING") return 2;
  return null;
}
