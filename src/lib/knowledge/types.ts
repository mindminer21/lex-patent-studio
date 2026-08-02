/**
 * Knowledge-system types (PRD §6, FR-5).
 *
 * Every corpus document carries: source type, jurisdiction, date/edition,
 * license class, authority rank, supersession status, confidentiality class,
 * provenance, and content checksum (PRD §6.1). License-class enforcement is
 * applied at ingestion AND at retrieval: a source without a commercial-clear
 * license class is unreachable (PRD FR-5, §6.4).
 */

/** License classes per the §6.4 licensing boundary table. */
export const LICENSE_CLASSES = [
  /** U.S. government works (MPEP, statutes, regulations, Fed. Reg., decisions). */
  "government_work",
  /** Public patent data via official APIs (USPTO ODP). */
  "public_data_api",
  /** EPO/WIPO/Hague materials portable only per each organization's terms. */
  "org_reuse_terms",
  /** Practical Law / commercial content — internal license only. DO NOT PORT. */
  "licensed_commercial",
  /** Recovered CLE/reference materials — DO NOT PORT unless licensed. */
  "internal_only",
] as const;
export type LicenseClass = (typeof LICENSE_CLASSES)[number];

/**
 * The commercial-clear set. Anything outside this set is unreachable in
 * retrieval — enforced in code, mirrored by the corpus-project SQL view.
 * (org_reuse_terms is clear only with the attribution obligations recorded
 * in the document's provenance; the registry stores the basis per §6.4.)
 */
export const COMMERCIAL_CLEAR_CLASSES: ReadonlySet<LicenseClass> = new Set([
  "government_work",
  "public_data_api",
  "org_reuse_terms",
]);

export function isCommercialClear(licenseClass: LicenseClass): boolean {
  return COMMERCIAL_CLEAR_CLASSES.has(licenseClass);
}

/** Source types with authority ranking (PRD §6.2 authority hierarchy). */
export const CORPUS_SOURCE_TYPES = [
  "statute",
  "regulation",
  "case_scotus",
  "case_cafc",
  "agency_guidance", // MPEP, Fed. Reg. notices — evidence of agency practice
  "ptab_decision",
  "intl_guidance", // EPO/WIPO/Hague — research grounding only
  "patent_document", // public patent data
] as const;
export type CorpusSourceType = (typeof CORPUS_SOURCE_TYPES)[number];

/**
 * Authority weight per source type. Primary law first (§6.2.1); MPEP and
 * agency guidance are evidence of agency practice, never a substitute for
 * statute, regulation, or controlling precedent (§6.2 final rule).
 */
export const AUTHORITY_WEIGHT: Record<CorpusSourceType, number> = {
  statute: 100,
  regulation: 90,
  case_scotus: 85,
  case_cafc: 80,
  agency_guidance: 60,
  ptab_decision: 50,
  intl_guidance: 30,
  patent_document: 40,
};

/** Source types that count as "primary law" for retrieval ordering. */
export const PRIMARY_LAW_TYPES: ReadonlySet<CorpusSourceType> = new Set([
  "statute",
  "regulation",
]);

export const CORPUS_COLLECTIONS = [
  "prosecution",
  "drafting",
  "litigation",
  "ptab",
  "foreign_pct",
  "technical_prior_art",
] as const;
export type CorpusCollection = (typeof CORPUS_COLLECTIONS)[number];

export interface CorpusSection {
  id: string;
  heading: string;
  /** Stable text — the quote verifier checks quotations verbatim against it. */
  text: string;
}

export interface CorpusDocument {
  id: string;
  sourceType: CorpusSourceType;
  collection: CorpusCollection;
  /** "US" for domestic authority; "EP"/"WO" international grounding only. */
  jurisdiction: "US" | "EP" | "WO";
  /** Display citation, e.g. "35 U.S.C. § 112". */
  citation: string;
  title: string;
  /** Edition or decision label, e.g. "Ninth Edition, Rev. 07.2022". */
  edition: string;
  /** Date the document/edition became effective (as-of filtering). */
  effectiveDate: string; // YYYY-MM-DD
  /** Date this document/edition was superseded, if any (as-of filtering). */
  supersededOn?: string; // YYYY-MM-DD
  /** Registry id of the superseding document, when known. */
  supersededBy?: string;
  licenseClass: LicenseClass;
  /** License basis recorded in the registry (PRD §6.4). */
  licenseBasis: string;
  confidentialityClass: "public";
  /**
   * Provenance statement. Local mode ships SYNTHETIC paraphrase snippets
   * only — clearly labeled — so no third-party text travels in this repo.
   */
  provenance: string;
  /** SHA-256 of the concatenated section text (content checksum, §6.1). */
  checksum: string;
  synthetic: true;
  sections: CorpusSection[];
}

export interface CorpusReleaseInfo {
  releaseId: string;
  createdAt: string;
  documentCount: number;
  /** Count of registry entries excluded from retrieval by the license gate. */
  licenseBlockedCount: number;
  notes: string;
}

export interface KnowledgeSearchParams {
  query: string;
  jurisdiction: "US";
  asOfDate: string; // YYYY-MM-DD — required run parameter (§6.2.3)
  collection?: CorpusCollection;
  /** Include EP/WO research-grounding materials (never filing guidance). */
  includeInternational?: boolean;
  limit?: number;
}

export interface KnowledgeSearchHit {
  documentId: string;
  citation: string;
  title: string;
  sourceType: CorpusSourceType;
  edition: string;
  effectiveDate: string;
  authorityWeight: number;
  primaryLaw: boolean;
  sectionId: string;
  sectionHeading: string;
  /** Short snippet for discovery only — workflows read full sections before quoting (§6.2.1). */
  snippet: string;
  score: number;
  /** Supersession/treatment note when the hit is near an edition boundary. */
  supersessionNote?: string;
  /** MPEP/agency guidance labeling rule (§6.2 final rule). */
  authorityNote?: string;
}

export interface KnowledgeSearchResult {
  hits: KnowledgeSearchHit[];
  corpusRelease: string;
  asOfDate: string;
  jurisdiction: string;
  /** Registry entries that matched but are not license-cleared (count only —
   *  their content is unreachable by design). */
  licenseBlockedCount: number;
  /** Non-empty when the record is insufficient to answer (§6.2 refusal). */
  insufficiencyWarning?: string;
}

export type QuoteVerificationState = "verified" | "failed";

export interface QuoteVerification {
  state: QuoteVerificationState;
  corpusDocumentId: string;
  /** Where the verbatim match was found. */
  location?: { sectionId: string; sectionHeading: string };
  reason?: string;
  checkedAt: string;
  verifier: string;
  verifierVersion: string;
}
