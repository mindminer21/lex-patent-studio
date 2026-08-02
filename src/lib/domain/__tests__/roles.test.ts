import { describe, expect, it } from "vitest";
import {
  can,
  canDecideReview,
  canInvokeWorkflow,
  ROLES,
} from "@/lib/domain/roles";

describe("role/permission policy table (FR-2, Invariant 21)", () => {
  it("contributor (R&D seat) cannot invoke generation/claim/prosecution/research workflows at any tier", () => {
    expect(canInvokeWorkflow("contributor", "A")).toBe(false);
    expect(canInvokeWorkflow("contributor", "B")).toBe(false);
    expect(canInvokeWorkflow("contributor", "C")).toBe(false);
  });

  it("contributor can contribute facts and upload sources only", () => {
    expect(can("contributor", "facts.contribute")).toBe(true);
    expect(can("contributor", "sources.upload")).toBe(true);
    expect(can("contributor", "facts.approve")).toBe(false);
    expect(can("contributor", "export.draft")).toBe(false);
    expect(can("contributor", "review.decide.tierA")).toBe(false);
  });

  it("agent_operator can run Tier A/B work but never decide Tier B/C reviews", () => {
    expect(canInvokeWorkflow("agent_operator", "A")).toBe(true);
    expect(canInvokeWorkflow("agent_operator", "B")).toBe(true);
    expect(canInvokeWorkflow("agent_operator", "C")).toBe(false);
    expect(canDecideReview("agent_operator", "A")).toBe(true);
    expect(canDecideReview("agent_operator", "B")).toBe(false);
    expect(canDecideReview("agent_operator", "C")).toBe(false);
    expect(can("agent_operator", "export.approved")).toBe(false);
  });

  it("practitioner can decide reviews at every tier and export approved work", () => {
    for (const tier of ["A", "B", "C"] as const) {
      expect(canDecideReview("practitioner", tier)).toBe(true);
      expect(canInvokeWorkflow("practitioner", tier)).toBe(true);
    }
    expect(can("practitioner", "export.approved")).toBe(true);
    expect(can("practitioner", "team.manage")).toBe(false);
  });

  it("owner and practitioner_admin additionally manage team and billing", () => {
    for (const role of ["owner", "practitioner_admin"] as const) {
      expect(can(role, "team.manage")).toBe(true);
      expect(can(role, "billing.manage")).toBe(true);
      expect(canDecideReview(role, "C")).toBe(true);
    }
  });

  it("viewer is read-only", () => {
    expect(can("viewer", "matter.view")).toBe(true);
    expect(can("viewer", "facts.contribute")).toBe(false);
    expect(canInvokeWorkflow("viewer", "A")).toBe(false);
  });

  it("counsel and support roles have no professional-lane workflow or review rights", () => {
    for (const role of [
      "counsel_intake",
      "counsel_attorney",
      "platform_support",
    ] as const) {
      for (const tier of ["A", "B", "C"] as const) {
        expect(canInvokeWorkflow(role, tier)).toBe(false);
        expect(canDecideReview(role, tier)).toBe(false);
      }
    }
    expect(can("counsel_attorney", "counsel.matter.manage")).toBe(true);
    expect(can("platform_support", "support.readonly")).toBe(true);
  });

  it("deny-by-default: unknown actions are refused for every role", () => {
    for (const role of ROLES) {
      // @ts-expect-error — deliberately probing an action outside the union
      expect(can(role, "workflow.invoke.tierZ")).toBe(false);
    }
  });

  it("exactly nine roles exist per FR-2", () => {
    expect(ROLES).toHaveLength(9);
  });
});
