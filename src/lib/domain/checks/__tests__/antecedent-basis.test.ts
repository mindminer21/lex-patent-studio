import { describe, expect, it } from "vitest";
import {
  checkAntecedentBasis,
  definiteReferences,
  introducedTerms,
} from "@/lib/domain/checks/antecedent-basis";
import type { ClaimInput } from "@/lib/domain/checks/types";

const c = (number: number, text: string): ClaimInput => ({ number, text });

describe("introducedTerms / definiteReferences", () => {
  it("captures indefinite introductions", () => {
    const terms = introducedTerms(
      "An apparatus comprising a manifold plate and at least one cassette module.",
    ).map((t) => t.term);
    expect(terms).toContain("apparatus");
    expect(terms).toContain("manifold plate");
    expect(terms).toContain("cassette module");
  });

  it("expands 'a plurality of' to provide plural basis", () => {
    const terms = introducedTerms("comprising a plurality of cassette modules").map(
      (t) => t.term,
    );
    expect(terms).toContain("cassette modules");
    expect(terms).toContain("plurality of cassette modules");
  });

  it("captures definite references but not the dependency preamble", () => {
    const refs = definiteReferences(
      "The apparatus of claim 1, wherein the manifold plate comprises a port.",
    ).map((r) => r.term);
    expect(refs).toContain("manifold plate");
    expect(refs).not.toContain("apparatus");
  });
});

describe("checkAntecedentBasis", () => {
  it("passes a known-good claim set", () => {
    const result = checkAntecedentBasis([
      c(1, "An apparatus comprising a manifold plate and a cassette module."),
      c(2, "The apparatus of claim 1, wherein the cassette module is removable."),
      c(3, "The apparatus of claim 2, wherein the manifold plate comprises a port."),
      c(4, "The apparatus of claim 3, wherein the port is self-sealing."),
    ]);
    expect(result.passed).toBe(true);
    expect(result.findings.filter((f) => f.severity === "error")).toEqual([]);
  });

  it("flags 'the X' with no antecedent in the claim or its chain", () => {
    const result = checkAntecedentBasis([
      c(1, "An apparatus comprising a manifold plate."),
      c(2, "The apparatus of claim 1, wherein the retention magnet is annular."),
    ]);
    expect(result.passed).toBe(false);
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: "AB-MISSING",
        claimNumber: 2,
        term: "retention magnet",
      }),
    );
  });

  it("accepts basis introduced earlier in the same claim, in order", () => {
    const good = checkAntecedentBasis([
      c(1, "An apparatus comprising a valve, wherein the valve is biased closed."),
    ]);
    expect(good.passed).toBe(true);

    const bad = checkAntecedentBasis([
      c(1, "An apparatus wherein the valve is biased closed, comprising a valve."),
    ]);
    expect(bad.passed).toBe(false);
    expect(bad.findings).toContainEqual(
      expect.objectContaining({ code: "AB-MISSING", term: "valve" }),
    );
  });

  it("inherits basis through a multi-level dependency chain", () => {
    const result = checkAntecedentBasis([
      c(1, "An apparatus comprising a housing."),
      c(2, "The apparatus of claim 1, further comprising a latch."),
      c(3, "The apparatus of claim 2, wherein the latch engages the housing."),
    ]);
    expect(result.passed).toBe(true);
  });

  it("checks each alternative chain of a multiple dependent claim", () => {
    const result = checkAntecedentBasis([
      c(1, "An apparatus comprising a housing."),
      c(2, "The apparatus of claim 1, further comprising a latch."),
      c(3, "The apparatus of any one of claims 1-2, wherein the latch is spring-loaded."),
    ]);
    // Basis exists via claim 2 but NOT via the claim-1-only chain.
    expect(result.passed).toBe(false);
    const finding = result.findings.find(
      (f) => f.code === "AB-MISSING" && f.claimNumber === 3,
    );
    expect(finding).toBeDefined();
    expect(finding?.message).toContain("alternative chain does provide basis");
    expect(finding?.path).toEqual([1]);
  });

  it("warns on double introduction of the same term", () => {
    const result = checkAntecedentBasis([
      c(1, "An apparatus comprising a seal and a seal."),
    ]);
    expect(result.passed).toBe(true); // warning, not error
    expect(result.findings).toContainEqual(
      expect.objectContaining({ code: "AB-DUPLICATE", term: "seal" }),
    );
  });

  it("is deterministic: identical input yields identical output", () => {
    const set = [
      c(1, "An apparatus comprising a manifold plate."),
      c(2, "The apparatus of claim 1, wherein the retention magnet is annular."),
    ];
    expect(checkAntecedentBasis(set)).toEqual(checkAntecedentBasis([...set]));
  });
});
