import { describe, expect, it } from "vitest";
import {
  MIN_QUOTE_LENGTH,
  normalizeForComparison,
  verifyCitationSet,
  verifyQuote,
} from "@/lib/knowledge";

/** A true verbatim passage from the synthetic corpus (35 U.S.C. § 112(b)). */
const VERBATIM_112B =
  "particularly pointing out and distinctly claiming the subject matter";

describe("quote verifier (Invariant 14, §6.2.4)", () => {
  it("verifies a verbatim quotation and reports its location", () => {
    const result = verifyQuote({
      corpusDocumentId: "corp_usc_112",
      quote: VERBATIM_112B,
    });
    expect(result.state).toBe("verified");
    expect(result.location?.sectionId).toBe("usc112_b");
    expect(result.verifier).toBe("quote-verifier");
  });

  it("normalizes typography only: curly quotes, dashes, whitespace runs", () => {
    const result = verifyQuote({
      corpusDocumentId: "corp_usc_112",
      quote: "particularly  pointing out\nand distinctly claiming the subject matter",
    });
    expect(result.state).toBe("verified");
    expect(normalizeForComparison("“a—b’s”")).toBe(`"a-b's"`);
  });

  it("fails a tampered quotation — the verifier never repairs quotes", () => {
    const result = verifyQuote({
      corpusDocumentId: "corp_usc_112",
      quote: "particularly pointing out and BROADLY claiming the subject matter",
    });
    expect(result.state).toBe("failed");
    expect(result.reason).toMatch(/not found verbatim/i);
  });

  it("fails a quotation attributed to the wrong (real) source", () => {
    const result = verifyQuote({
      corpusDocumentId: "corp_usc_103", // quote actually lives in §112
      quote: VERBATIM_112B,
    });
    expect(result.state).toBe("failed");
  });

  it("fails a fabricated citation identifier (fabrication cannot survive)", () => {
    const result = verifyQuote({
      corpusDocumentId: "corp_fake_authority_999",
      quote: VERBATIM_112B,
    });
    expect(result.state).toBe("failed");
    expect(result.reason).toMatch(/fabricated/i);
  });

  it("fails quotations against license-blocked sources", () => {
    const result = verifyQuote({
      corpusDocumentId: "corp_treatise_ch4",
      quote: "Content withheld: this source class is not license-cleared",
    });
    expect(result.state).toBe("failed");
    expect(result.reason).toMatch(/not license-cleared/i);
  });

  it("rejects quotes below the minimum verifiable length", () => {
    const result = verifyQuote({
      corpusDocumentId: "corp_usc_112",
      quote: "the claims",
    });
    expect(result.state).toBe("failed");
    expect(result.reason).toContain(String(MIN_QUOTE_LENGTH));
  });
});

describe("citation-set verification (verifier failures block 'verified')", () => {
  it("passes a set of good citations (with and without quotes)", () => {
    const set = verifyCitationSet([
      { corpusDocumentId: "corp_usc_112", quote: VERBATIM_112B },
      { corpusDocumentId: "corp_mpep_2143" }, // existence + license check
    ]);
    expect(set.allVerified).toBe(true);
    expect(set.checkedCount).toBe(2);
    expect(set.failures).toHaveLength(0);
  });

  it("one tampered quote fails the whole set", () => {
    const set = verifyCitationSet([
      { corpusDocumentId: "corp_usc_112", quote: VERBATIM_112B },
      {
        corpusDocumentId: "corp_usc_103",
        quote: "a patent may always be obtained for any combination",
      },
    ]);
    expect(set.allVerified).toBe(false);
    expect(set.failures).toHaveLength(1);
    expect(set.failures[0].corpusDocumentId).toBe("corp_usc_103");
  });

  it("a quote-less citation to a fabricated id fails the set", () => {
    const set = verifyCitationSet([{ corpusDocumentId: "corp_nonexistent" }]);
    expect(set.allVerified).toBe(false);
    expect(set.failures[0].reason).toMatch(/fabricated/i);
  });

  it("a quote-less citation to a license-blocked source fails the set", () => {
    const set = verifyCitationSet([{ corpusDocumentId: "corp_cle_seminar" }]);
    expect(set.allVerified).toBe(false);
    expect(set.failures[0].reason).toMatch(/not license-cleared/i);
  });
});
