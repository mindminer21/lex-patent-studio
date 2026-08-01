import { describe, expect, it } from "vitest";
import {
  effectiveTier,
  validateTierAssignment,
  WORKFLOW_KEYS,
  WORKFLOW_TIER_FLOOR,
} from "@/lib/domain/tiers";

describe("work-tier policy (§5.3, Invariant 15)", () => {
  it("defaults to the platform floor with no override", () => {
    expect(effectiveTier("ids_packet")).toBe("A");
    expect(effectiveTier("section_draft")).toBe("B");
    expect(effectiveTier("response_path_options")).toBe("C");
  });

  it("honors promotion to a stricter tier", () => {
    expect(effectiveTier("ids_packet", "B")).toBe("B");
    expect(effectiveTier("ids_packet", "C")).toBe("C");
    expect(effectiveTier("section_draft", "C")).toBe("C");
  });

  it("clamps attempted demotion back to the platform floor", () => {
    expect(effectiveTier("section_draft", "A")).toBe("B");
    expect(effectiveTier("response_path_options", "A")).toBe("C");
    expect(effectiveTier("response_path_options", "B")).toBe("C");
  });

  it("validateTierAssignment rejects any demotion below the floor", () => {
    const rejected = validateTierAssignment("oa_response_draft", "A");
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.error).toMatch(/demotion/);

    expect(validateTierAssignment("oa_response_draft", "B").ok).toBe(true);
    expect(validateTierAssignment("oa_response_draft", "C").ok).toBe(true);
  });

  it("every workflow key has a platform floor", () => {
    for (const key of WORKFLOW_KEYS) {
      expect(["A", "B", "C"]).toContain(WORKFLOW_TIER_FLOOR[key]);
    }
  });

  it("Tier-C strategy workflows can never be demoted for any override value", () => {
    for (const override of ["A", "B", "C"] as const) {
      expect(effectiveTier("claim_scope_strategy", override)).toBe("C");
      expect(effectiveTier("filing_strategy_options", override)).toBe("C");
    }
  });
});
