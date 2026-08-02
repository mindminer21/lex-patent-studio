import { describe, expect, it } from "vitest";
import { checkSb08, type Sb08Row } from "@/lib/domain/checks";

const AS_OF = "2026-08-01";

const GOOD_ROWS: Sb08Row[] = [
  {
    row: 1,
    kind: "us_patent",
    citeNumber: "10,987,654",
    kindCode: "B2",
    date: "2021-04-27",
    name: "Ito et al. (synthetic)",
  },
  {
    row: 2,
    kind: "us_publication",
    citeNumber: "2020/0123456",
    kindCode: "A1",
    date: "2020-04-16",
    name: "Vega (synthetic)",
  },
  {
    row: 3,
    kind: "foreign",
    citeNumber: "3 456 789",
    countryCode: "EP",
    date: "2019-11-06",
    name: "Keller GmbH (synthetic)",
    description: "English abstract considered; relevant to claim 1 sealing limitation.",
  },
  {
    row: 4,
    kind: "npl",
    description:
      "Chen, Latent heat storage for residential heat pumps, J. Thermal Eng. 44 (2023) 112–129 (synthetic).",
  },
];

describe("SB/08 field validation (known-good fixture)", () => {
  it("passes a fully valid packet with zero findings", () => {
    const result = checkSb08(GOOD_ROWS, AS_OF);
    expect(result.passed).toBe(true);
    expect(result.findings).toHaveLength(0);
    expect(result.checker).toBe("sb08-validation");
  });

  it("accepts RE/D/PP prefixed US patent numbers", () => {
    for (const num of ["RE44123", "D654321", "PP12345", "7654321"]) {
      const result = checkSb08(
        [{ row: 1, kind: "us_patent", citeNumber: num, date: "2010-01-05", name: "X (synthetic)" }],
        AS_OF,
      );
      expect(result.passed, num).toBe(true);
    }
  });
});

describe("SB/08 field validation (known-bad fixtures)", () => {
  it("flags a missing US patent number and missing patentee", () => {
    const result = checkSb08(
      [{ row: 1, kind: "us_patent", date: "2020-01-01" }],
      AS_OF,
    );
    expect(result.passed).toBe(false);
    const codes = result.findings.map((f) => f.code);
    expect(codes).toContain("SB08-US-NUMBER-MISSING");
    expect(codes).toContain("SB08-NAME-MISSING");
  });

  it("flags malformed patent and publication numbers", () => {
    const result = checkSb08(
      [
        { row: 1, kind: "us_patent", citeNumber: "ABC123", date: "2020-01-01", name: "N" },
        { row: 2, kind: "us_publication", citeNumber: "12345", date: "2020-01-01", name: "N" },
      ],
      AS_OF,
    );
    const codes = result.findings.map((f) => f.code);
    expect(codes).toContain("SB08-US-NUMBER-FORMAT");
    expect(codes).toContain("SB08-PUB-NUMBER-FORMAT");
  });

  it("flags bad, missing, and future dates", () => {
    const result = checkSb08(
      [
        { row: 1, kind: "us_patent", citeNumber: "7654321", name: "N" },
        { row: 2, kind: "us_patent", citeNumber: "7654322", name: "N", date: "04/27/2021" },
        { row: 3, kind: "us_patent", citeNumber: "7654323", name: "N", date: "2027-01-01" },
      ],
      AS_OF,
    );
    const codes = result.findings.map((f) => f.code);
    expect(codes).toContain("SB08-DATE-MISSING");
    expect(codes).toContain("SB08-DATE-FORMAT");
    expect(codes).toContain("SB08-DATE-FUTURE");
  });

  it("flags foreign rows without country code and warns on missing relevance", () => {
    const result = checkSb08(
      [{ row: 1, kind: "foreign", citeNumber: "1234567", date: "2019-01-01" }],
      AS_OF,
    );
    const codes = result.findings.map((f) => f.code);
    expect(codes).toContain("SB08-COUNTRY-MISSING");
    expect(codes).toContain("SB08-RELEVANCE-MISSING");
    expect(result.findings.find((f) => f.code === "SB08-RELEVANCE-MISSING")?.severity).toBe(
      "warning",
    );
  });

  it("flags lowercase/long country codes", () => {
    const result = checkSb08(
      [
        {
          row: 1,
          kind: "foreign",
          citeNumber: "9876",
          countryCode: "epo",
          date: "2019-01-01",
          description: "relevance provided",
        },
      ],
      AS_OF,
    );
    expect(result.findings.map((f) => f.code)).toContain("SB08-COUNTRY-FORMAT");
  });

  it("flags NPL rows with numbers or without a real description", () => {
    const result = checkSb08(
      [
        { row: 1, kind: "npl", citeNumber: "7654321", description: "Chen, J. Thermal Eng. 44 (2023) 112–129." },
        { row: 2, kind: "npl", description: "web page" },
      ],
      AS_OF,
    );
    const codes = result.findings.map((f) => f.code);
    expect(codes).toContain("SB08-NPL-HAS-NUMBER");
    expect(codes).toContain("SB08-NPL-DESCRIPTION");
  });

  it("warns on duplicate citations, anchored to the duplicate row", () => {
    const rows: Sb08Row[] = [
      { row: 1, kind: "us_patent", citeNumber: "7654321", date: "2010-01-05", name: "N" },
      { row: 2, kind: "us_patent", citeNumber: "7654321", date: "2010-01-05", name: "N" },
    ];
    const result = checkSb08(rows, AS_OF);
    const dup = result.findings.find((f) => f.code === "SB08-DUPLICATE");
    expect(dup).toBeDefined();
    expect(dup!.severity).toBe("warning");
    expect(dup!.claimNumber).toBe(2);
    // Duplicates alone (warnings) do not fail the packet.
    expect(result.passed).toBe(true);
  });
});
