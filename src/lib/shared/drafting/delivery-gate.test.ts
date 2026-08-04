import { describe, expect, it } from "vitest";
import {
  blockerCodes,
  describeDeliveryBlockers,
  evaluateDeliveryGate,
  type DeliveryGateInput,
} from "./delivery-gate";
import { DRAFT_PASS_STATES } from "./pass-state";
import type { ReconciliationReport } from "./reconcile";

const RECONCILED: ReconciliationReport = {
  reconciled: true,
  findings: [],
  registryCount: 3,
  inDescriptionCount: 3,
  inDrawingsCount: 3,
  checkedAt: "2026-08-04T00:00:00.000Z",
  version: "reconcile-608.02-1.0.0",
};

const UNRECONCILED: ReconciliationReport = {
  ...RECONCILED,
  reconciled: false,
  findings: [
    {
      kind: "in_drawings_not_in_description",
      numeral: "16A",
      partLabel: "upper bearing",
      detail: "A drawing shows 16A but the description never mentions it.",
    },
  ],
};

function deliverable(overrides: Partial<DeliveryGateInput> = {}): DeliveryGateInput {
  return {
    state: "READY_FOR_REVIEW",
    interruptedStage: null,
    statusDetail: "",
    passOneVersionId: "v1",
    passTwoVersionId: "v2",
    figureSetId: "fs-1",
    readyFigureCount: 3,
    unresolvedFigureCount: 0,
    reconciliation: RECONCILED,
    acceptedByUserId: "user-1",
    acceptedAt: "2026-08-04T01:00:00.000Z",
    ...overrides,
  };
}

describe("the gate opens only on a complete, accepted, reconciled set", () => {
  it("allows delivery when every condition holds", () => {
    const result = evaluateDeliveryGate(deliverable());
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.acceptedByUserId).toBe("user-1");
    }
  });

  it("is CLOSED in every state except READY_FOR_REVIEW, even if accepted", () => {
    for (const state of DRAFT_PASS_STATES) {
      if (state === "READY_FOR_REVIEW") continue;
      const result = evaluateDeliveryGate(deliverable({ state }));
      expect(result.allowed, `${state} must not deliver`).toBe(false);
    }
  });
});

describe("it never emits a Pass-1-only package silently", () => {
  it("refuses while Pass 1 is still running, and says why", () => {
    const result = evaluateDeliveryGate(
      deliverable({ state: "PASS_1_DRAFTING", passTwoVersionId: null }),
    );
    expect(result.allowed).toBe(false);
    expect(blockerCodes(result)).toContain("pass_1_only");
    if (!result.allowed) {
      expect(result.blockers[0].message).toContain("has not been checked against any drawing");
      expect(result.blockers[0].needs).toBeTruthy();
    }
  });

  it("refuses when the figures have not been built", () => {
    const result = evaluateDeliveryGate(deliverable({ state: "FIGURES_PENDING" }));
    expect(blockerCodes(result)).toContain("figures_not_built");
  });

  it("refuses when the figures exist but Pass 2 has not run", () => {
    const result = evaluateDeliveryGate(deliverable({ state: "FIGURES_READY" }));
    expect(blockerCodes(result)).toContain("pass_2_not_run");
  });

  it("refuses a 'ready' set with no Pass-2 version — the exact silent-Pass-1 case", () => {
    const result = evaluateDeliveryGate(deliverable({ passTwoVersionId: null }));
    expect(blockerCodes(result)).toContain("no_pass_2_version");
    if (!result.allowed) {
      expect(describeDeliveryBlockers(result.blockers)).toContain("Pass-1-only package");
    }
  });
});

describe("it refuses on unresolved numerals", () => {
  it("blocks when the two-way reconciliation failed", () => {
    const result = evaluateDeliveryGate(deliverable({ reconciliation: UNRECONCILED }));
    expect(blockerCodes(result)).toContain("unreconciled_numerals");
    if (!result.allowed) {
      const text = describeDeliveryBlockers(result.blockers);
      expect(text).toContain("do not agree");
      // Flag, never fix.
      expect(text).toContain("rather than changing your draft");
    }
  });

  it("blocks when the reconciliation was never run at all", () => {
    const result = evaluateDeliveryGate(deliverable({ reconciliation: null }));
    expect(blockerCodes(result)).toContain("unreconciled_numerals");
  });

  it("blocks when figures are still unresolved", () => {
    const result = evaluateDeliveryGate(deliverable({ unresolvedFigureCount: 2 }));
    expect(blockerCodes(result)).toContain("figures_incomplete");
    if (!result.allowed) {
      expect(describeDeliveryBlockers(result.blockers)).toContain("2 figure(s)");
    }
  });

  it("blocks a 'ready' set that somehow has no figures", () => {
    const result = evaluateDeliveryGate(
      deliverable({ figureSetId: null, readyFigureCount: 0 }),
    );
    expect(blockerCodes(result)).toContain("figures_not_built");
  });
});

describe("it refuses on a pause, and says what it needs", () => {
  it("reports the budget pause reason verbatim", () => {
    const result = evaluateDeliveryGate(
      deliverable({
        state: "PAUSED_BUDGET",
        statusDetail: "Figure budget cap of $3.00 reached after 4 images.",
      }),
    );
    expect(blockerCodes(result)).toContain("budget_paused");
    if (!result.allowed) {
      expect(result.blockers[0].message).toBe(
        "Figure budget cap of $3.00 reached after 4 images.",
      );
      expect(result.blockers[0].needs).toContain("Raise the budget cap");
    }
  });

  it("reports the needs-input question verbatim", () => {
    const result = evaluateDeliveryGate(
      deliverable({
        state: "NEEDS_INPUT",
        statusDetail: "Which side of the housing does the intake sit on?",
      }),
    );
    expect(blockerCodes(result)).toContain("needs_user_input");
    if (!result.allowed) {
      expect(result.blockers[0].message).toContain("intake sit on");
    }
  });

  it("falls back to an honest default when no detail was recorded", () => {
    const result = evaluateDeliveryGate(
      deliverable({ state: "PAUSED_BUDGET", statusDetail: "   " }),
    );
    if (!result.allowed) {
      expect(result.blockers[0].message).toContain("spend cap");
    }
  });
});

describe("human acceptance", () => {
  it("blocks a fully complete, reconciled set that nobody accepted", () => {
    const result = evaluateDeliveryGate(
      deliverable({ acceptedByUserId: null, acceptedAt: null }),
    );
    expect(result.allowed).toBe(false);
    expect(blockerCodes(result)).toContain("not_accepted_by_human");
    if (!result.allowed) {
      expect(describeDeliveryBlockers(result.blockers)).toContain(
        "cannot accept on your behalf",
      );
    }
  });

  it("blocks a half-recorded acceptance", () => {
    expect(evaluateDeliveryGate(deliverable({ acceptedAt: null })).allowed).toBe(false);
    expect(evaluateDeliveryGate(deliverable({ acceptedByUserId: null })).allowed).toBe(false);
  });

  it("names the substantive problem before the acceptance problem", () => {
    const result = evaluateDeliveryGate(
      deliverable({
        reconciliation: UNRECONCILED,
        acceptedByUserId: null,
        acceptedAt: null,
      }),
    );
    if (!result.allowed) {
      expect(result.blockers[0].code).toBe("unreconciled_numerals");
      expect(result.blockers.at(-1)!.code).toBe("not_accepted_by_human");
    }
  });
});

describe("every refusal is actionable", () => {
  it("gives a non-empty message AND a non-empty need for every blocker", () => {
    const cases: DeliveryGateInput[] = [
      deliverable({ state: "PASS_1_DRAFTING" }),
      deliverable({ state: "FIGURES_PENDING" }),
      deliverable({ state: "FIGURES_READY" }),
      deliverable({ state: "PASS_2_REVISING" }),
      deliverable({ state: "NEEDS_INPUT" }),
      deliverable({ state: "PAUSED_BUDGET" }),
      deliverable({ state: "FAILED" }),
      deliverable({ reconciliation: UNRECONCILED }),
      deliverable({ passTwoVersionId: null }),
      deliverable({ unresolvedFigureCount: 1 }),
      deliverable({ acceptedByUserId: null, acceptedAt: null }),
    ];
    for (const input of cases) {
      const result = evaluateDeliveryGate(input);
      expect(result.allowed, JSON.stringify(input.state)).toBe(false);
      if (result.allowed) continue;
      for (const blocker of result.blockers) {
        expect(blocker.message.trim().length, blocker.code).toBeGreaterThan(10);
        expect(blocker.needs.trim().length, blocker.code).toBeGreaterThan(10);
        // "Not ready" is not an answer.
        expect(blocker.message.trim().toLowerCase()).not.toBe("not ready");
      }
    }
  });
});
