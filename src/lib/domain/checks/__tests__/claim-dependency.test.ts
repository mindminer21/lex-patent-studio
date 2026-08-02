import { describe, expect, it } from "vitest";
import {
  checkClaimDependencies,
  parseDependency,
} from "@/lib/domain/checks/claim-dependency";
import type { ClaimInput } from "@/lib/domain/checks/types";

const c = (number: number, text: string): ClaimInput => ({ number, text });

const GOOD_SET: ClaimInput[] = [
  c(1, "An apparatus comprising a manifold plate and a cassette module."),
  c(2, "The apparatus of claim 1, wherein the cassette module is removable."),
  c(3, "The apparatus of claim 2, wherein the manifold plate comprises a port."),
  c(4, "The apparatus of any one of claims 1-3, further comprising a sensor."),
  c(5, "A method comprising inserting a cassette module into a manifold plate."),
  c(6, "The method of claim 5, wherein the inserting is tool-free."),
];

describe("parseDependency", () => {
  it("returns null for an independent claim", () => {
    expect(parseDependency(GOOD_SET[0].text)).toBeNull();
  });

  it("parses a single back-reference", () => {
    expect(parseDependency("The apparatus of claim 1, wherein…")).toEqual({
      parents: [1],
      multiple: false,
      alternative: false,
    });
  });

  it("parses ranges and lists as multiple dependencies in the alternative", () => {
    expect(parseDependency("The apparatus of any one of claims 1-3, further…")).toEqual(
      { parents: [1, 2, 3], multiple: true, alternative: true },
    );
    expect(parseDependency("The device of claim 2 or 4, wherein…")).toEqual({
      parents: [2, 4],
      multiple: true,
      alternative: true,
    });
  });

  it("parses conjunctive multiple dependency as non-alternative", () => {
    const dep = parseDependency("The device of claims 1 and 2, wherein…");
    expect(dep).toMatchObject({ parents: [1, 2], multiple: true, alternative: false });
  });

  it("parses 'claims 2 to 5' as an expanded range", () => {
    const dep = parseDependency("The device according to any one of claims 2 to 5.");
    expect(dep?.parents).toEqual([2, 3, 4, 5]);
  });
});

describe("checkClaimDependencies", () => {
  it("passes a known-good claim set with zero findings", () => {
    const result = checkClaimDependencies(GOOD_SET);
    expect(result.passed).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it("flags a dependency on a claim not in the set", () => {
    const result = checkClaimDependencies([
      GOOD_SET[0],
      c(2, "The apparatus of claim 9, wherein the port is sealed."),
    ]);
    expect(result.passed).toBe(false);
    expect(result.findings).toContainEqual(
      expect.objectContaining({ code: "DEP-MISSING-TARGET", claimNumber: 2 }),
    );
  });

  it("flags self-dependency", () => {
    const result = checkClaimDependencies([
      GOOD_SET[0],
      c(2, "The apparatus of claim 2, wherein the port is sealed."),
    ]);
    expect(result.findings).toContainEqual(
      expect.objectContaining({ code: "DEP-SELF", claimNumber: 2 }),
    );
  });

  it("flags forward references", () => {
    const result = checkClaimDependencies([
      GOOD_SET[0],
      c(2, "The apparatus of claim 3, wherein the port is sealed."),
      c(3, "The apparatus of claim 1, further comprising a valve."),
    ]);
    expect(result.findings).toContainEqual(
      expect.objectContaining({ code: "DEP-FORWARD", claimNumber: 2 }),
    );
  });

  it("flags a multiple dependent claim depending on a multiple dependent claim", () => {
    const result = checkClaimDependencies([
      c(1, "An apparatus comprising a body."),
      c(2, "The apparatus of claim 1, further comprising a lid."),
      c(3, "The apparatus of any one of claims 1-2, further comprising a seal."),
      c(4, "The apparatus of any one of claims 1-3, further comprising a clamp."),
    ]);
    expect(result.findings).toContainEqual(
      expect.objectContaining({ code: "DEP-MULTI-ON-MULTI", claimNumber: 4 }),
    );
  });

  it("flags conjunctive multiple dependency phrasing", () => {
    const result = checkClaimDependencies([
      c(1, "An apparatus comprising a body."),
      c(2, "The apparatus of claim 1, further comprising a lid."),
      c(3, "The apparatus of claims 1 and 2, further comprising a seal."),
    ]);
    expect(result.findings).toContainEqual(
      expect.objectContaining({ code: "DEP-MULTI-CONJUNCTIVE", claimNumber: 3 }),
    );
  });

  it("flags duplicate claim numbers and numbering gaps", () => {
    const dup = checkClaimDependencies([
      c(1, "An apparatus comprising a body."),
      c(1, "An apparatus comprising a frame."),
    ]);
    expect(dup.findings).toContainEqual(
      expect.objectContaining({ code: "DEP-DUPLICATE-NUMBER" }),
    );

    const gap = checkClaimDependencies([
      c(1, "An apparatus comprising a body."),
      c(3, "The apparatus of claim 1, further comprising a lid."),
    ]);
    expect(gap.passed).toBe(true); // gap is a warning, not an error
    expect(gap.findings).toContainEqual(
      expect.objectContaining({ code: "DEP-NUMBER-GAP", severity: "warning" }),
    );
  });

  it("is deterministic: identical input yields identical output", () => {
    const a = checkClaimDependencies(GOOD_SET);
    const b = checkClaimDependencies([...GOOD_SET]);
    expect(a).toEqual(b);
  });
});
