import { describe, expect, it } from "vitest";
import {
  applyReviewDecision,
  canTransitionReview,
  exportWatermark,
} from "@/lib/domain/review";

describe("review/approval state machine (§9.6, Invariant 16)", () => {
  const human = {
    type: "human" as const,
    userId: "user_1",
    role: "practitioner" as const,
    authenticated: true,
  };

  it("a model actor can NEVER set review state, regardless of claimed role", () => {
    for (const decision of ["approve", "request_changes", "reject"] as const) {
      const result = applyReviewDecision({
        current: "pending_review",
        decision,
        tier: "B",
        actor: { type: "model", userId: "model", role: "owner", authenticated: true },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/human/i);
    }
  });

  it("a system actor can never set review state", () => {
    const result = applyReviewDecision({
      current: "pending_review",
      decision: "approve",
      tier: "A",
      actor: { type: "system", userId: "cron", role: "owner", authenticated: true },
    });
    expect(result.ok).toBe(false);
  });

  it("unauthenticated humans are refused", () => {
    const result = applyReviewDecision({
      current: "pending_review",
      decision: "approve",
      tier: "B",
      actor: { ...human, authenticated: false },
    });
    expect(result.ok).toBe(false);
  });

  it("role policy is enforced per tier: operator may decide Tier A only", () => {
    const operator = { ...human, role: "agent_operator" as const };
    expect(
      applyReviewDecision({
        current: "pending_review",
        decision: "approve",
        tier: "A",
        actor: operator,
      }).ok,
    ).toBe(true);
    expect(
      applyReviewDecision({
        current: "pending_review",
        decision: "approve",
        tier: "B",
        actor: operator,
      }).ok,
    ).toBe(false);
  });

  it("contributor and viewer can never decide any tier", () => {
    for (const role of ["contributor", "viewer"] as const) {
      for (const tier of ["A", "B", "C"] as const) {
        expect(
          applyReviewDecision({
            current: "pending_review",
            decision: "approve",
            tier,
            actor: { ...human, role },
          }).ok,
        ).toBe(false);
      }
    }
  });

  it("valid human decisions map to the correct next state", () => {
    const approve = applyReviewDecision({
      current: "pending_review",
      decision: "approve",
      tier: "B",
      actor: human,
    });
    expect(approve).toEqual({ ok: true, nextState: "approved" });

    const changes = applyReviewDecision({
      current: "pending_review",
      decision: "request_changes",
      tier: "B",
      actor: human,
    });
    expect(changes).toEqual({ ok: true, nextState: "changes_requested" });

    const reject = applyReviewDecision({
      current: "pending_review",
      decision: "reject",
      tier: "C",
      actor: human,
    });
    expect(reject).toEqual({ ok: true, nextState: "rejected" });
  });

  it("rejected is terminal; changes_requested only re-enters review", () => {
    expect(canTransitionReview("rejected", "approved")).toBe(false);
    expect(canTransitionReview("rejected", "pending_review")).toBe(false);
    expect(canTransitionReview("changes_requested", "approved")).toBe(false);
    expect(canTransitionReview("changes_requested", "pending_review")).toBe(true);
  });

  it("double-approval is not a legal transition", () => {
    const result = applyReviewDecision({
      current: "approved",
      decision: "approve",
      tier: "B",
      actor: human,
    });
    expect(result.ok).toBe(false);
  });

  it("everything except approved carries the DRAFT — NOT REVIEWED watermark", () => {
    expect(exportWatermark("pending_review")).toBe("DRAFT — NOT REVIEWED");
    expect(exportWatermark("changes_requested")).toBe("DRAFT — NOT REVIEWED");
    expect(exportWatermark("rejected")).toBe("DRAFT — NOT REVIEWED");
    expect(exportWatermark("approved")).toBeNull();
  });
});
