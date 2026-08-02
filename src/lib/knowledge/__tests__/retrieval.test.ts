import { describe, expect, it } from "vitest";
import {
  getCorpusDocument,
  inForceAsOf,
  listRegistry,
  listRetrievableDocuments,
  searchCorpus,
  SYNTHETIC_CORPUS,
  getCorpusReleaseInfo,
  isCommercialClear,
} from "@/lib/knowledge";

const AS_OF = "2026-08-01";

describe("license-class enforcement at retrieval (FR-5, §6.4)", () => {
  it("licensed_commercial and internal_only sources are never searchable", () => {
    // Query with terms that appear in the blocked stubs' text.
    const result = searchCorpus({
      query: "content withheld license-cleared",
      jurisdiction: "US",
      asOfDate: AS_OF,
    });
    expect(result.hits.every((h) => h.documentId !== "corp_treatise_ch4")).toBe(true);
    expect(result.hits.every((h) => h.documentId !== "corp_cle_seminar")).toBe(true);
    // The match is COUNTED as blocked, proving the gate saw and refused it.
    expect(result.licenseBlockedCount).toBeGreaterThan(0);
  });

  it("getCorpusDocument refuses non-clear registry entries", () => {
    const blocked = getCorpusDocument("corp_treatise_ch4");
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error).toMatch(/not license-cleared/i);
    const cle = getCorpusDocument("corp_cle_seminar");
    expect(cle.ok).toBe(false);
  });

  it("unknown identifiers are refused, not fabricated", () => {
    const missing = getCorpusDocument("corp_does_not_exist");
    expect(missing.ok).toBe(false);
  });

  it("the retrievable listing excludes every blocked class", () => {
    const retrievable = listRetrievableDocuments();
    expect(retrievable.length).toBeGreaterThan(0);
    expect(retrievable.every((d) => isCommercialClear(d.licenseClass))).toBe(true);
  });

  it("the registry lists blocked entries as metadata with retrievable=false", () => {
    const registry = listRegistry();
    const blocked = registry.filter((r) => !r.retrievable);
    expect(blocked.map((b) => b.id).sort()).toEqual([
      "corp_cle_seminar",
      "corp_treatise_ch4",
    ]);
    const release = getCorpusReleaseInfo();
    expect(release.licenseBlockedCount).toBe(2);
    expect(release.documentCount).toBe(SYNTHETIC_CORPUS.length);
  });
});

describe("as-of date filtering and supersession (§6.2.3, §6.2.5)", () => {
  it("returns the superseded MPEP edition for a pre-supersession as-of date", () => {
    const result = searchCorpus({
      query: "prima facie obviousness rationales",
      jurisdiction: "US",
      asOfDate: "2013-01-15",
    });
    const ids = result.hits.map((h) => h.documentId);
    expect(ids).toContain("corp_mpep_2143_e8");
    expect(ids).not.toContain("corp_mpep_2143"); // not yet effective
  });

  it("returns the current MPEP edition (not the superseded one) for a modern as-of date", () => {
    const result = searchCorpus({
      query: "prima facie obviousness rationales",
      jurisdiction: "US",
      asOfDate: AS_OF,
    });
    const ids = result.hits.map((h) => h.documentId);
    expect(ids).toContain("corp_mpep_2143");
    expect(ids).not.toContain("corp_mpep_2143_e8");
  });

  it("inForceAsOf handles boundaries: effective date inclusive, supersession date exclusive-from", () => {
    const e8 = SYNTHETIC_CORPUS.find((d) => d.id === "corp_mpep_2143_e8")!;
    expect(inForceAsOf(e8, "2012-08-01")).toBe(true); // effective that day
    expect(inForceAsOf(e8, "2014-02-28")).toBe(true); // day before supersession
    expect(inForceAsOf(e8, "2014-03-01")).toBe(false); // superseded that day
    expect(inForceAsOf(e8, "2012-07-31")).toBe(false); // before effective
  });

  it("documents effective after the as-of date are excluded", () => {
    const result = searchCorpus({
      query: "artificial intelligence tools review",
      jurisdiction: "US",
      asOfDate: "2024-01-01", // before the 2024-04-11 Fed. Reg. notice
    });
    expect(result.hits.every((h) => h.documentId !== "corp_fr_ai_guidance")).toBe(true);
  });
});

describe("jurisdiction and international grounding (§2.6)", () => {
  it("EP guidance is excluded from a default US search", () => {
    const result = searchCorpus({
      query: "problem-solution approach inventive step",
      jurisdiction: "US",
      asOfDate: AS_OF,
    });
    expect(result.hits.every((h) => h.documentId !== "corp_epo_gvii")).toBe(true);
  });

  it("EP guidance appears only with the explicit international opt-in, labeled research-grounding-only", () => {
    const result = searchCorpus({
      query: "problem-solution approach inventive step",
      jurisdiction: "US",
      asOfDate: AS_OF,
      includeInternational: true,
    });
    const hit = result.hits.find((h) => h.documentId === "corp_epo_gvii");
    expect(hit).toBeDefined();
    expect(hit!.authorityNote).toMatch(/research grounding only/i);
  });
});

describe("authority weighting and ordering (§6.2.1, §6.2.3)", () => {
  it("primary law ranks ahead of agency guidance at comparable relevance", () => {
    const result = searchCorpus({
      query: "obvious before the effective filing date ordinary skill",
      jurisdiction: "US",
      asOfDate: AS_OF,
    });
    expect(result.hits.length).toBeGreaterThan(1);
    const firstPrimaryIdx = result.hits.findIndex((h) => h.primaryLaw);
    const firstAgencyIdx = result.hits.findIndex(
      (h) => h.sourceType === "agency_guidance",
    );
    expect(firstPrimaryIdx).toBeGreaterThanOrEqual(0);
    if (firstAgencyIdx >= 0) expect(firstPrimaryIdx).toBeLessThan(firstAgencyIdx);
  });

  it("MPEP hits carry the mandatory agency-practice label", () => {
    const result = searchCorpus({
      query: "information disclosure statement material to patentability",
      jurisdiction: "US",
      asOfDate: AS_OF,
    });
    const mpep = result.hits.filter((h) => h.sourceType === "agency_guidance");
    expect(mpep.length).toBeGreaterThan(0);
    for (const hit of mpep) {
      expect(hit.authorityNote).toMatch(/evidence of agency practice/i);
    }
  });

  it("source diversity: no more than two sections per document", () => {
    const result = searchCorpus({
      query: "specification claims invention description enable",
      jurisdiction: "US",
      asOfDate: AS_OF,
      limit: 25,
    });
    const perDoc = new Map<string, number>();
    for (const hit of result.hits) {
      perDoc.set(hit.documentId, (perDoc.get(hit.documentId) ?? 0) + 1);
    }
    for (const count of perDoc.values()) expect(count).toBeLessThanOrEqual(2);
  });
});

describe("insufficiency behavior (§6.2 refusal-to-guess)", () => {
  it("an unanswerable query returns an explicit warning, never a confident empty answer", () => {
    const result = searchCorpus({
      query: "zymurgy quantum basketweaving jurisprudence",
      jurisdiction: "US",
      asOfDate: AS_OF,
    });
    expect(result.hits).toHaveLength(0);
    expect(result.insufficiencyWarning).toMatch(/insufficient/i);
  });

  it("every result records the corpus release for reproducibility (§6.5)", () => {
    const result = searchCorpus({
      query: "obviousness",
      jurisdiction: "US",
      asOfDate: AS_OF,
    });
    expect(result.corpusRelease).toMatch(/corpus-2026\.07\.2/);
  });
});
