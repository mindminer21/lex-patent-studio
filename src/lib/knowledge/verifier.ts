import { getRegistryEntry } from "./corpus";
import { isCommercialClear, type QuoteVerification } from "./types";

/**
 * Quote/citation verifier (PRD §5.1 quality control, §6.2.4, Invariant 14).
 *
 * Every quotation must be found VERBATIM (after conservative typographic
 * normalization) in the cited source's retrieved text. A quotation that
 * cannot be located — including any quotation attributed to a fabricated or
 * unlicensed identifier — FAILS, and a verifier failure blocks "verified"
 * status on the containing work product. The verifier never "fixes" a quote.
 */

export const QUOTE_VERIFIER = "quote-verifier";
export const QUOTE_VERIFIER_VERSION = "1.0.0";

/** Minimum quote length: shorter fragments match trivially and prove nothing. */
export const MIN_QUOTE_LENGTH = 15;

/**
 * Conservative normalization: whitespace runs, curly quotes/apostrophes,
 * en/em dashes, and ellipsis characters. Nothing lexical is altered.
 */
export function normalizeForComparison(text: string): string {
  return text
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export interface QuoteCheckInput {
  corpusDocumentId: string;
  quote: string;
}

export function verifyQuote(input: QuoteCheckInput): QuoteVerification {
  const base = {
    corpusDocumentId: input.corpusDocumentId,
    checkedAt: new Date().toISOString(),
    verifier: QUOTE_VERIFIER,
    verifierVersion: QUOTE_VERIFIER_VERSION,
  };

  const quote = input.quote?.trim() ?? "";
  if (quote.length < MIN_QUOTE_LENGTH) {
    return {
      ...base,
      state: "failed",
      reason: `Quotation is too short to verify (minimum ${MIN_QUOTE_LENGTH} characters).`,
    };
  }

  const entry = getRegistryEntry(input.corpusDocumentId);
  if (!entry) {
    return {
      ...base,
      state: "failed",
      reason:
        "Cited identifier does not exist in the corpus registry — possible fabricated citation. Fabricated authority never survives verification (Invariant 14).",
    };
  }
  if (!isCommercialClear(entry.licenseClass)) {
    return {
      ...base,
      state: "failed",
      reason:
        "Cited source is not license-cleared for retrieval; its text cannot be verified against and must not be quoted (PRD §6.4).",
    };
  }

  const needle = normalizeForComparison(quote);
  for (const section of entry.sections) {
    if (normalizeForComparison(section.text).includes(needle)) {
      return {
        ...base,
        state: "verified",
        location: { sectionId: section.id, sectionHeading: section.heading },
      };
    }
  }
  return {
    ...base,
    state: "failed",
    reason:
      "Quotation was not found verbatim in the cited source text. The verifier does not repair quotes; the proposition must be re-grounded or labeled analysis.",
  };
}

export interface CitationForVerification {
  corpusDocumentId: string;
  quote?: string;
}

export interface CitationSetVerification {
  allVerified: boolean;
  checkedCount: number;
  failures: Array<{ corpusDocumentId: string; reason: string }>;
  results: QuoteVerification[];
}

/**
 * Verify a work product's citation set. Citations WITHOUT a quotation are
 * existence-checked (the identifier must resolve to a licensed registry
 * entry); citations WITH a quotation must pass the verbatim check.
 */
export function verifyCitationSet(
  citations: CitationForVerification[],
): CitationSetVerification {
  const results: QuoteVerification[] = [];
  const failures: Array<{ corpusDocumentId: string; reason: string }> = [];

  for (const citation of citations) {
    if (citation.quote) {
      const result = verifyQuote({
        corpusDocumentId: citation.corpusDocumentId,
        quote: citation.quote,
      });
      results.push(result);
      if (result.state === "failed") {
        failures.push({
          corpusDocumentId: citation.corpusDocumentId,
          reason: result.reason ?? "Verification failed.",
        });
      }
      continue;
    }
    // Existence + license check for quote-less citations.
    const entry = getRegistryEntry(citation.corpusDocumentId);
    const base = {
      corpusDocumentId: citation.corpusDocumentId,
      checkedAt: new Date().toISOString(),
      verifier: QUOTE_VERIFIER,
      verifierVersion: QUOTE_VERIFIER_VERSION,
    };
    if (!entry) {
      const reason =
        "Cited identifier does not exist in the corpus registry — possible fabricated citation.";
      results.push({ ...base, state: "failed", reason });
      failures.push({ corpusDocumentId: citation.corpusDocumentId, reason });
    } else if (!isCommercialClear(entry.licenseClass)) {
      const reason =
        "Cited source is not license-cleared for retrieval (PRD §6.4).";
      results.push({ ...base, state: "failed", reason });
      failures.push({ corpusDocumentId: citation.corpusDocumentId, reason });
    } else {
      results.push({ ...base, state: "verified" });
    }
  }

  return {
    allVerified: failures.length === 0,
    checkedCount: citations.length,
    failures,
    results,
  };
}
