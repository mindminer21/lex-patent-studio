import { describe, expect, it } from "vitest";
import {
  billingPassFor,
  canTransitionDraftPass,
  DRAFT_PASS_PIPELINE,
  DRAFT_PASS_STATE_LABELS,
  DRAFT_PASS_STATES,
  draftPassProgress,
  InvalidDraftPassTransitionError,
  isInterruptedState,
  isResumableStage,
  isTerminalDraftPassState,
  nextDraftPassStage,
  RESUMABLE_STAGES,
  transitionDraftPass,
} from "./pass-state";

/**
 * The state machine is the mechanism that makes "figures before Pass 2, and
 * nothing delivered before Pass 2" structural rather than procedural. These
 * tests are mostly about what it REFUSES.
 */

describe("the happy path", () => {
  it("walks Pass 1 → figures → Pass 2 → ready", () => {
    let state = transitionDraftPass("PASS_1_DRAFTING", "FIGURES_PENDING");
    state = transitionDraftPass(state, "FIGURES_READY");
    state = transitionDraftPass(state, "PASS_2_REVISING");
    state = transitionDraftPass(state, "READY_FOR_REVIEW");
    expect(state).toBe("READY_FOR_REVIEW");
  });

  it("orders the pipeline exactly as the directive specifies", () => {
    expect([...DRAFT_PASS_PIPELINE]).toEqual([
      "PASS_1_DRAFTING",
      "FIGURES_PENDING",
      "FIGURES_READY",
      "PASS_2_REVISING",
      "READY_FOR_REVIEW",
    ]);
  });

  it("advances one stage at a time", () => {
    expect(nextDraftPassStage("PASS_1_DRAFTING")).toBe("FIGURES_PENDING");
    expect(nextDraftPassStage("FIGURES_READY")).toBe("PASS_2_REVISING");
    expect(nextDraftPassStage("READY_FOR_REVIEW")).toBeNull();
    expect(nextDraftPassStage("NEEDS_INPUT")).toBeNull();
  });
});

describe("what the machine refuses", () => {
  it("CANNOT skip the figures stage — Pass 2 has nothing to check against", () => {
    expect(canTransitionDraftPass("PASS_1_DRAFTING", "PASS_2_REVISING")).toBe(false);
    expect(() => transitionDraftPass("PASS_1_DRAFTING", "PASS_2_REVISING")).toThrow(
      InvalidDraftPassTransitionError,
    );
  });

  it("CANNOT reach ready from Pass 1 — a Pass-1-only package has no path", () => {
    expect(canTransitionDraftPass("PASS_1_DRAFTING", "READY_FOR_REVIEW")).toBe(false);
    expect(canTransitionDraftPass("FIGURES_PENDING", "READY_FOR_REVIEW")).toBe(false);
    expect(canTransitionDraftPass("FIGURES_READY", "READY_FOR_REVIEW")).toBe(false);
  });

  it("CANNOT leave READY_FOR_REVIEW — re-drafting starts a new set", () => {
    for (const state of DRAFT_PASS_STATES) {
      expect(canTransitionDraftPass("READY_FOR_REVIEW", state)).toBe(false);
    }
  });

  it("CANNOT go backwards down the pipeline", () => {
    expect(canTransitionDraftPass("FIGURES_READY", "FIGURES_PENDING")).toBe(false);
    expect(canTransitionDraftPass("PASS_2_REVISING", "FIGURES_READY")).toBe(false);
    expect(canTransitionDraftPass("FIGURES_PENDING", "PASS_1_DRAFTING")).toBe(false);
  });

  it("only leaves FAILED by restarting the whole set", () => {
    expect(canTransitionDraftPass("FAILED", "PASS_1_DRAFTING")).toBe(true);
    expect(canTransitionDraftPass("FAILED", "PASS_2_REVISING")).toBe(false);
    expect(canTransitionDraftPass("FAILED", "READY_FOR_REVIEW")).toBe(false);
  });
});

describe("interruptions resume where they paused", () => {
  it("treats NEEDS_INPUT and PAUSED_BUDGET as interruptions, not stages", () => {
    expect(isInterruptedState("NEEDS_INPUT")).toBe(true);
    expect(isInterruptedState("PAUSED_BUDGET")).toBe(true);
    expect(isInterruptedState("PASS_2_REVISING")).toBe(false);
    for (const stage of RESUMABLE_STAGES) {
      expect(isResumableStage(stage)).toBe(true);
    }
    expect(isResumableStage("READY_FOR_REVIEW")).toBe(false);
  });

  it("resumes a Pass-2 budget pause back into Pass 2", () => {
    const state = transitionDraftPass("PAUSED_BUDGET", "PASS_2_REVISING", {
      resumeStage: "PASS_2_REVISING",
    });
    expect(state).toBe("PASS_2_REVISING");
  });

  it("REFUSES to resume a Pass-2 pause into Pass 1 — that would re-charge", () => {
    expect(() =>
      transitionDraftPass("PAUSED_BUDGET", "PASS_1_DRAFTING", {
        resumeStage: "PASS_2_REVISING",
      }),
    ).toThrow(InvalidDraftPassTransitionError);
  });

  it("REFUSES to resume without saying which stage was interrupted", () => {
    expect(() => transitionDraftPass("NEEDS_INPUT", "PASS_2_REVISING")).toThrow(
      InvalidDraftPassTransitionError,
    );
    expect(() =>
      transitionDraftPass("NEEDS_INPUT", "PASS_2_REVISING", { resumeStage: null }),
    ).toThrow(InvalidDraftPassTransitionError);
  });

  it("lets an interruption become the other interruption, or fail", () => {
    expect(canTransitionDraftPass("NEEDS_INPUT", "PAUSED_BUDGET")).toBe(true);
    expect(canTransitionDraftPass("PAUSED_BUDGET", "NEEDS_INPUT")).toBe(true);
    expect(canTransitionDraftPass("NEEDS_INPUT", "FAILED")).toBe(true);
  });

  it("never lets an interruption jump straight to ready", () => {
    expect(canTransitionDraftPass("NEEDS_INPUT", "READY_FOR_REVIEW")).toBe(false);
    expect(canTransitionDraftPass("PAUSED_BUDGET", "READY_FOR_REVIEW")).toBe(false);
  });
});

describe("bookkeeping", () => {
  it("marks ready and failed terminal", () => {
    expect(isTerminalDraftPassState("READY_FOR_REVIEW")).toBe(true);
    expect(isTerminalDraftPassState("FAILED")).toBe(true);
    expect(isTerminalDraftPassState("PAUSED_BUDGET")).toBe(false);
  });

  it("reports progress that never regresses along the pipeline", () => {
    let previous = -1;
    for (const stage of DRAFT_PASS_PIPELINE) {
      const progress = draftPassProgress(stage);
      expect(progress).toBeGreaterThan(previous);
      previous = progress;
    }
    expect(draftPassProgress("READY_FOR_REVIEW")).toBe(1);
    expect(draftPassProgress("FAILED")).toBe(0);
  });

  it("holds an interruption at the progress of the stage it paused", () => {
    expect(draftPassProgress("PAUSED_BUDGET", "PASS_2_REVISING")).toBe(
      draftPassProgress("PASS_2_REVISING"),
    );
  });

  it("names the billing pass for exactly the two spending stages", () => {
    expect(billingPassFor("PASS_1_DRAFTING")).toBe(1);
    expect(billingPassFor("PASS_2_REVISING")).toBe(2);
    for (const state of DRAFT_PASS_STATES) {
      if (state === "PASS_1_DRAFTING" || state === "PASS_2_REVISING") continue;
      expect(billingPassFor(state), state).toBeNull();
    }
  });

  it("labels every state", () => {
    for (const state of DRAFT_PASS_STATES) {
      expect(DRAFT_PASS_STATE_LABELS[state], state).toBeTruthy();
    }
  });
});
