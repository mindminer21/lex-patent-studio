import { describe, expect, it } from "vitest";
import {
  checkNumeralConsistency,
  extractFigureRefs,
  extractNumeralUses,
} from "@/lib/domain/checks";

const GOOD_SECTIONS = [
  {
    heading: "Brief description of the drawings",
    body: "FIG. 1 shows a thermal storage apparatus. FIG. 2 shows the manifold plate 12 in detail.",
  },
  {
    heading: "Detailed description",
    body: "The apparatus includes a manifold plate 12 having self-sealing ports 16. Each cassette module 14 engages the manifold plate 12 through a respective port 16. As shown in FIG. 2, the manifold plate 12 carries a temperature sensor 18.",
  },
];

describe("numeral extraction", () => {
  it("extracts element/numeral pairs and skips years, claims, and figures", () => {
    const uses = extractNumeralUses(
      "a manifold plate 12 as described in claim 3 and FIG. 2, filed in 2026, with ports 16",
    );
    const numerals = uses.map((u) => u.numeral);
    expect(numerals).toContain("12");
    expect(numerals).toContain("16");
    expect(numerals).not.toContain("3"); // claim reference
    expect(numerals).not.toContain("2026"); // year
  });

  it("extracts figure references including ranges", () => {
    const refs = extractFigureRefs("FIG. 1, FIGS. 3-5, and FIG. 7A");
    expect([...refs].sort()).toEqual(["1", "3", "4", "5", "7A"]);
  });
});

describe("numeral consistency (known-good fixture)", () => {
  it("passes a consistent specification and claim set", () => {
    const result = checkNumeralConsistency(GOOD_SECTIONS, [
      { number: 1, text: "A thermal storage apparatus comprising a manifold plate 12 and ports 16." },
    ]);
    expect(result.passed).toBe(true);
    expect(result.findings.filter((f) => f.severity === "error")).toHaveLength(0);
  });
});

describe("numeral consistency (known-bad fixtures)", () => {
  it("NUM-CONFLICT: one numeral for two different elements", () => {
    const result = checkNumeralConsistency([
      {
        heading: "Detailed description",
        body: "The manifold plate 12 connects to the heat exchanger. The control valve 12 regulates flow.",
      },
    ]);
    expect(result.passed).toBe(false);
    const conflict = result.findings.find((f) => f.code === "NUM-CONFLICT");
    expect(conflict).toBeDefined();
    expect(conflict!.term).toBe("12");
  });

  it("NUM-LABEL-SPLIT: one element with two numerals is a warning", () => {
    const result = checkNumeralConsistency([
      {
        heading: "Detailed description",
        body: "The manifold plate 12 is coupled to the housing. In another view the manifold plate 22 is shown.",
      },
    ]);
    const split = result.findings.find((f) => f.code === "NUM-LABEL-SPLIT");
    expect(split).toBeDefined();
    expect(split!.severity).toBe("warning");
    expect(result.passed).toBe(true); // warnings alone do not fail
  });

  it("NUM-CLAIM-ONLY: claim numeral absent from the specification", () => {
    const result = checkNumeralConsistency(GOOD_SECTIONS, [
      { number: 4, text: "The apparatus of claim 1, further comprising a bypass conduit 44." },
    ]);
    const claimOnly = result.findings.find((f) => f.code === "NUM-CLAIM-ONLY");
    expect(claimOnly).toBeDefined();
    expect(claimOnly!.claimNumber).toBe(4);
    expect(claimOnly!.term).toBe("44");
    expect(result.passed).toBe(false);
  });

  it("FIG-NOT-DESCRIBED: a referenced figure missing from the description", () => {
    const result = checkNumeralConsistency([
      {
        heading: "Brief description of the drawings",
        body: "FIG. 1 shows the apparatus.",
      },
      {
        heading: "Detailed description",
        body: "As shown in FIG. 3, the sensor module 18 is mounted on the plate 12. The plate 12 and module 18 are described above.",
      },
    ]);
    const fig = result.findings.find((f) => f.code === "FIG-NOT-DESCRIBED");
    expect(fig).toBeDefined();
    expect(fig!.term).toBe("FIG. 3");
    expect(result.passed).toBe(false);
  });
});
