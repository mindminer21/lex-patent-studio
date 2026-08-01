import { describe, expect, it } from "vitest";
import {
  canTransitionFact,
  FACT_PROVENANCE_STATES,
  isDraftableProvenance,
  transitionFact,
} from "@/lib/domain/provenance";

describe("fact provenance states (§5.1)", () => {
  it("non-human actors can never set counsel_reviewed", () => {
    for (const from of FACT_PROVENANCE_STATES) {
      expect(canTransitionFact(from, "counsel_reviewed", "model")).toBe(false);
      expect(canTransitionFact(from, "counsel_reviewed", "system")).toBe(false);
    }
  });

  it("a human practitioner can mark facts counsel_reviewed from working states", () => {
    expect(canTransitionFact("user_asserted", "counsel_reviewed", "human")).toBe(true);
    expect(canTransitionFact("source_supported", "counsel_reviewed", "human")).toBe(true);
    expect(canTransitionFact("disputed", "counsel_reviewed", "human")).toBe(true);
  });

  it("model/system may propose source_supported and needs_confirmation only", () => {
    expect(canTransitionFact("user_asserted", "source_supported", "model")).toBe(true);
    expect(canTransitionFact("user_asserted", "needs_confirmation", "model")).toBe(true);
    expect(canTransitionFact("user_asserted", "disputed", "model")).toBe(false);
  });

  it("counsel_reviewed can only be reopened by a human", () => {
    expect(canTransitionFact("counsel_reviewed", "disputed", "human")).toBe(true);
    expect(canTransitionFact("counsel_reviewed", "disputed", "model")).toBe(false);
    expect(canTransitionFact("counsel_reviewed", "needs_confirmation", "system")).toBe(true);
  });

  it("transitionFact throws on illegal transitions", () => {
    expect(() => transitionFact("disputed", "source_supported", "human")).toThrow();
    expect(() => transitionFact("user_asserted", "counsel_reviewed", "model")).toThrow();
  });

  it("only counsel_reviewed facts are draftable (approved fact baseline)", () => {
    expect(isDraftableProvenance("counsel_reviewed")).toBe(true);
    for (const s of [
      "user_asserted",
      "source_supported",
      "needs_confirmation",
      "disputed",
    ] as const) {
      expect(isDraftableProvenance(s)).toBe(false);
    }
  });
});
