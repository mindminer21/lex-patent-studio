import { describe, expect, it } from "vitest";
import { checkSectionCompleteness } from "@/lib/domain/checks";

const FULL_SPEC = [
  { heading: "Background", body: "Conventional sensible-heat water storage saturates near the delivery temperature of a residential heat pump, leaving surplus uncaptured." },
  { heading: "Summary", body: "In one aspect, a thermal storage apparatus includes a manifold plate having a plurality of self-sealing ports and cassette modules." },
  { heading: "Detailed description", body: "The apparatus includes a manifold plate 12 having self-sealing ports 16 arranged in a rectangular grid across the plate face." },
  { heading: "Abstract", body: "A modular latent-heat storage apparatus with self-sealing hydronic ports and replaceable phase-change cassettes is disclosed." },
];

describe("section completeness (known-good fixtures)", () => {
  it("passes a complete utility specification in order", () => {
    const result = checkSectionCompleteness(FULL_SPEC, "utility_specification");
    expect(result.passed).toBe(true);
    expect(result.findings).toHaveLength(0);
  });

  it("passes an OA response with separated amendments and remarks", () => {
    const result = checkSectionCompleteness(
      [
        { heading: "Amendments to the claims", body: "Claim 1 (currently amended): A thermal storage apparatus comprising [[a]] the manifold plate with underlined additions marked." },
        { heading: "Remarks", body: "The rejection of claims 1-7 under 35 U.S.C. 103 is respectfully traversed for the reasons below, addressing each cited reference." },
      ],
      "oa_response",
    );
    expect(result.passed).toBe(true);
  });

  it("passes a research memo with the §9.5 contract sections", () => {
    const result = checkSectionCompleteness(
      [
        { heading: "Question presented", body: "Whether the planned trade-show demonstration starts a statutory clock affecting U.S. filing strategy under current law." },
        { heading: "Short answer (analysis)", body: "Filing before the demonstration removes the question; otherwise the grace period analysis controls the outcome here." },
        { heading: "Authority relied upon (evidence set)", body: "35 U.S.C. § 102 [verified]; 35 U.S.C. § 102(b)(1) [verified] with the full source trail attached." },
      ],
      "research_memo",
    );
    expect(result.passed).toBe(true);
  });
});

describe("section completeness (known-bad fixtures)", () => {
  it("SEC-MISSING: absent required sections fail", () => {
    const result = checkSectionCompleteness(
      FULL_SPEC.filter((s) => s.heading !== "Abstract"),
      "utility_specification",
    );
    expect(result.passed).toBe(false);
    const missing = result.findings.find((f) => f.code === "SEC-MISSING");
    expect(missing?.term).toBe("abstract");
  });

  it("SEC-EMPTY: a present-but-empty section fails", () => {
    const sections = FULL_SPEC.map((s) =>
      s.heading === "Summary" ? { ...s, body: "TBD." } : s,
    );
    const result = checkSectionCompleteness(sections, "utility_specification");
    expect(result.passed).toBe(false);
    expect(result.findings.find((f) => f.code === "SEC-EMPTY")?.term).toBe("summary");
  });

  it("SEC-ORDER: out-of-order arrangement warns but does not fail", () => {
    const shuffled = [FULL_SPEC[1], FULL_SPEC[0], FULL_SPEC[2], FULL_SPEC[3]];
    const result = checkSectionCompleteness(shuffled, "utility_specification");
    expect(result.findings.find((f) => f.code === "SEC-ORDER")?.severity).toBe("warning");
    expect(result.passed).toBe(true);
  });

  it("SEC-MIXED: argument language inside the amendment section fails an OA response", () => {
    const result = checkSectionCompleteness(
      [
        { heading: "Amendments to the claims", body: "Claim 1 (currently amended): … The rejection is respectfully traversed because the reference teaches away." },
        { heading: "Remarks", body: "Further remarks addressing the combination rationale and the objective evidence of record are presented below." },
      ],
      "oa_response",
    );
    expect(result.passed).toBe(false);
    expect(result.findings.map((f) => f.code)).toContain("SEC-MIXED");
  });
});
