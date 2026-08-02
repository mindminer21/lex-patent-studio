import type { CorpusPort, CorpusSnippet } from "../types";

/**
 * Credential-independent local corpus (§7.4 step 4). A small fixed set of
 * U.S. government works (public domain under 17 U.S.C. §105) with license
 * provenance and bounded excerpts — the same shape the production corpus
 * project serves. No copyrighted or licensed third-party material.
 */
const LOCAL_CORPUS: readonly CorpusSnippet[] = [
  {
    authority: "uscode",
    citation: "35 U.S.C. §101",
    title: "Inventions patentable",
    canonicalUrl:
      "https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title35-section101&num=0&edition=prelim",
    effectiveDate: "2026-01-01",
    licenseNote: "U.S. government work (17 U.S.C. §105); public domain.",
    excerpt:
      "Whoever invents or discovers any new and useful process, machine, manufacture, or composition of matter, or any new and useful improvement thereof, may obtain a patent therefor, subject to the conditions and requirements of this title.",
  },
  {
    authority: "uscode",
    citation: "35 U.S.C. §102(a)(1)",
    title: "Conditions for patentability; novelty",
    canonicalUrl:
      "https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title35-section102&num=0&edition=prelim",
    effectiveDate: "2026-01-01",
    licenseNote: "U.S. government work (17 U.S.C. §105); public domain.",
    excerpt:
      "A person shall be entitled to a patent unless the claimed invention was patented, described in a printed publication, or in public use, on sale, or otherwise available to the public before the effective filing date of the claimed invention.",
  },
  {
    authority: "uscode",
    citation: "35 U.S.C. §112(a)",
    title: "Specification",
    canonicalUrl:
      "https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title35-section112&num=0&edition=prelim",
    effectiveDate: "2026-01-01",
    licenseNote: "U.S. government work (17 U.S.C. §105); public domain.",
    excerpt:
      "The specification shall contain a written description of the invention, and of the manner and process of making and using it, in such full, clear, concise, and exact terms as to enable any person skilled in the art to which it pertains to make and use the same.",
  },
  {
    authority: "cfr",
    citation: "37 CFR 1.56(a)",
    title: "Duty to disclose information material to patentability",
    canonicalUrl:
      "https://www.ecfr.gov/current/title-37/chapter-I/subchapter-A/part-1/subpart-B/section-1.56",
    effectiveDate: "2026-01-01",
    licenseNote: "U.S. government work (17 U.S.C. §105); public domain.",
    excerpt:
      "Each individual associated with the filing and prosecution of a patent application has a duty of candor and good faith in dealing with the Office, which includes a duty to disclose to the Office all information known to that individual to be material to patentability.",
  },
];

/** Excerpts stay bounded even if the fixture grows (legal memo §6). */
export const MAX_EXCERPT_CHARS = 400;

export class LocalCorpusAdapter implements CorpusPort {
  async searchAllowlisted(query: string, limit: number): Promise<CorpusSnippet[]> {
    const terms = query
      .toLowerCase()
      .split(/[^a-z0-9§.]+/)
      .filter((term) => term.length > 2);
    const scored = LOCAL_CORPUS.map((snippet) => {
      const haystack = `${snippet.citation} ${snippet.title} ${snippet.excerpt}`.toLowerCase();
      const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
      return { snippet, score };
    });
    // Stable, deterministic: matches first, otherwise the canonical order —
    // organizational workflows always get the same authority references.
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, Math.max(0, limit)).map(({ snippet }) => ({
      ...snippet,
      excerpt:
        snippet.excerpt.length > MAX_EXCERPT_CHARS
          ? `${snippet.excerpt.slice(0, MAX_EXCERPT_CHARS)}…`
          : snippet.excerpt,
    }));
  }
}
