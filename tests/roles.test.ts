import { describe, expect, it } from "vitest";
import { ACTIONS, can, isCounselRole, isOrdinaryUserRole, ROLES } from "@/lib/wepatent/domain/roles";

describe("role policy (FR-2)", () => {
  it("defines exactly seven roles", () => {
    expect(ROLES).toHaveLength(7);
  });

  it("viewers are read-only", () => {
    expect(can("viewer", "invention.view")).toBe(true);
    expect(can("viewer", "invention.create")).toBe(false);
    expect(can("viewer", "invention.edit")).toBe(false);
    expect(can("viewer", "draft.generate")).toBe(false);
    expect(can("viewer", "counsel_request.create")).toBe(false);
  });

  it("ordinary organization roles never hold counsel-lane permissions", () => {
    for (const role of ["owner", "admin", "member", "viewer"] as const) {
      expect(can(role, "counsel.conflict.review")).toBe(false);
      expect(can(role, "counsel.request.decide")).toBe(false);
      expect(can(role, "counsel.engagement.manage")).toBe(false);
      expect(can(role, "counsel.matter.convert")).toBe(false);
    }
  });

  it("counsel roles never hold organization-side permissions", () => {
    for (const role of ["counsel_intake", "counsel_attorney"] as const) {
      expect(can(role, "invention.create")).toBe(false);
      expect(can(role, "invention.view")).toBe(false);
      expect(can(role, "billing.manage")).toBe(false);
      expect(can(role, "draft.generate")).toBe(false);
    }
  });

  it("platform_support has no standing permissions (break-glass disabled)", () => {
    for (const action of ACTIONS) {
      expect(can("platform_support", action)).toBe(false);
    }
  });

  it("only counsel_attorney can decide requests and convert matters", () => {
    expect(can("counsel_attorney", "counsel.request.decide")).toBe(true);
    expect(can("counsel_attorney", "counsel.matter.convert")).toBe(true);
    expect(can("counsel_intake", "counsel.request.decide")).toBe(false);
    expect(can("counsel_intake", "counsel.matter.convert")).toBe(false);
  });

  it("classifies role groups", () => {
    expect(isOrdinaryUserRole("member")).toBe(true);
    expect(isOrdinaryUserRole("counsel_attorney")).toBe(false);
    expect(isCounselRole("counsel_intake")).toBe(true);
    expect(isCounselRole("owner")).toBe(false);
  });
});
