import { describe, expect, it } from "vitest";
import {
  canMutateFacts,
  canTransitionFact,
  FACT_PROVENANCE_STATES,
  isUnresolved,
  transitionFact,
} from "@/lib/wepatent/domain/facts";

describe("fact provenance rules (PRD FR-3, §5.9)", () => {
  it("model actors can never mutate facts", () => {
    expect(canMutateFacts("model")).toBe(false);
    for (const from of FACT_PROVENANCE_STATES) {
      for (const to of FACT_PROVENANCE_STATES) {
        expect(canTransitionFact("model", from, to), `${from} → ${to}`).toBe(false);
      }
    }
  });

  it("only counsel actors can mark a fact counsel_reviewed", () => {
    expect(canTransitionFact("counsel", "user_asserted", "counsel_reviewed")).toBe(true);
    expect(canTransitionFact("user", "user_asserted", "counsel_reviewed")).toBe(false);
    expect(canTransitionFact("system", "user_asserted", "counsel_reviewed")).toBe(false);
    expect(canTransitionFact("model", "user_asserted", "counsel_reviewed")).toBe(false);
  });

  it("users can flag facts for confirmation or dispute and re-assert", () => {
    expect(transitionFact("user", "user_asserted", "needs_confirmation").ok).toBe(true);
    expect(transitionFact("user", "source_supported", "disputed").ok).toBe(true);
    expect(transitionFact("user", "disputed", "user_asserted").ok).toBe(true);
  });

  it("a user edit demotes counsel_reviewed back to user_asserted", () => {
    const result = transitionFact("user", "counsel_reviewed", "user_asserted");
    expect(result).toEqual({ ok: true, next: "user_asserted" });
  });

  it("system can only apply deterministic pipeline results", () => {
    expect(canTransitionFact("system", "user_asserted", "source_supported")).toBe(true);
    expect(canTransitionFact("system", "disputed", "source_supported")).toBe(false);
    expect(canTransitionFact("system", "user_asserted", "disputed")).toBe(false);
  });

  it("identifies unresolved states", () => {
    expect(isUnresolved("needs_confirmation")).toBe(true);
    expect(isUnresolved("disputed")).toBe(true);
    expect(isUnresolved("user_asserted")).toBe(false);
    expect(isUnresolved("source_supported")).toBe(false);
    expect(isUnresolved("counsel_reviewed")).toBe(false);
  });
});
