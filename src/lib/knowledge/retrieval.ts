import { getRegistryEntry, SYNTHETIC_CORPUS, CORPUS_RELEASE } from "./corpus";
import {
  AUTHORITY_WEIGHT,
  isCommercialClear,
  PRIMARY_LAW_TYPES,
  type CorpusDocument,
  type KnowledgeSearchHit,
  type KnowledgeSearchParams,
  type KnowledgeSearchResult,
} from "./types";

/**
 * Retrieval protocol implementation (PRD §6.2, FR-5), local mode.
 *
 * Enforced here, not by convention:
 *  1. Primary law first — statute/regulation hits order ahead of everything
 *     at comparable relevance (authority weighting).
 *  2. As-of date filtering — jurisdiction + as-of date are REQUIRED
 *     parameters; documents effective after the as-of date, or superseded on
 *     or before it, are excluded (point-in-time research).
 *  3. License-class enforcement — a source without a commercial-clear
 *     license class is unreachable. Blocked matches are COUNTED, never read.
 *  4. Source diversity — at most two sections per document in a result set.
 *  5. Insufficiency warning — an empty record produces an explicit warning
 *     rather than a confident empty answer (§6.2 refusal behavior).
 *
 * MPEP/agency guidance hits carry the mandatory "evidence of agency
 * practice" label (§6.2 final rule).
 */

const AGENCY_NOTE =
  "Agency guidance — evidence of agency practice, not a substitute for statute, regulation, or controlling precedent.";

const INTL_NOTE =
  "International authority — research grounding only; non-U.S. filing workflows are out of scope.";

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9§.]+/g, " ")
    .split(" ")
    .filter((t) => t.length > 1);
}

const STOPWORDS = new Set([
  "the", "of", "and", "or", "to", "in", "a", "an", "for", "is", "be",
  "with", "that", "by", "on", "as", "at", "it", "its", "are", "shall",
]);

function queryTerms(query: string): string[] {
  return tokenize(query).filter((t) => !STOPWORDS.has(t));
}

/** Is `doc` in force for point-in-time research at `asOfDate`? */
export function inForceAsOf(docEntry: CorpusDocument, asOfDate: string): boolean {
  if (docEntry.effectiveDate > asOfDate) return false;
  if (docEntry.supersededOn && docEntry.supersededOn <= asOfDate) return false;
  return true;
}

function scoreText(terms: string[], text: string): number {
  if (terms.length === 0) return 0;
  const tokens = tokenize(text);
  const counts = new Map<string, number>();
  for (const tok of tokens) counts.set(tok, (counts.get(tok) ?? 0) + 1);
  let matched = 0;
  let score = 0;
  for (const term of terms) {
    const c = counts.get(term) ?? 0;
    if (c > 0) {
      matched += 1;
      score += 1 + Math.log(1 + c);
    }
  }
  if (matched === 0) return 0;
  // Require meaningful coverage for multi-term queries.
  return score * (matched / terms.length);
}

function snippetFor(text: string, terms: string[]): string {
  const lower = text.toLowerCase();
  let idx = -1;
  for (const term of terms) {
    const i = lower.indexOf(term);
    if (i >= 0 && (idx === -1 || i < idx)) idx = i;
  }
  const start = Math.max(0, (idx === -1 ? 0 : idx) - 60);
  const raw = text.slice(start, start + 240);
  return `${start > 0 ? "…" : ""}${raw}${start + 240 < text.length ? "…" : ""}`;
}

const MAX_SECTIONS_PER_DOC = 2;
const DEFAULT_LIMIT = 8;

export function searchCorpus(params: KnowledgeSearchParams): KnowledgeSearchResult {
  const terms = queryTerms(params.query);
  const limit = Math.min(Math.max(params.limit ?? DEFAULT_LIMIT, 1), 25);
  let licenseBlockedCount = 0;
  const hits: KnowledgeSearchHit[] = [];

  for (const docEntry of SYNTHETIC_CORPUS) {
    // Jurisdiction: US-first product; EP/WO only on explicit opt-in (§2.6).
    if (docEntry.jurisdiction !== params.jurisdiction && !params.includeInternational) {
      continue;
    }
    if (params.collection && docEntry.collection !== params.collection) continue;
    if (!inForceAsOf(docEntry, params.asOfDate)) continue;

    const docTermScore = scoreText(terms, `${docEntry.citation} ${docEntry.title}`);
    const sectionHits: KnowledgeSearchHit[] = [];
    for (const section of docEntry.sections) {
      const s = scoreText(terms, section.text) + docTermScore * 0.5;
      if (s <= 0) continue;
      // LICENSE GATE: matched but non-clear content is counted, never read.
      if (!isCommercialClear(docEntry.licenseClass)) {
        licenseBlockedCount += 1;
        continue;
      }
      const weight = AUTHORITY_WEIGHT[docEntry.sourceType];
      sectionHits.push({
        documentId: docEntry.id,
        citation: docEntry.citation,
        title: docEntry.title,
        sourceType: docEntry.sourceType,
        edition: docEntry.edition,
        effectiveDate: docEntry.effectiveDate,
        authorityWeight: weight,
        primaryLaw: PRIMARY_LAW_TYPES.has(docEntry.sourceType),
        sectionId: section.id,
        sectionHeading: section.heading,
        snippet: snippetFor(section.text, terms),
        score: s * (weight / 100),
        supersessionNote: docEntry.supersededOn
          ? `Superseded on ${docEntry.supersededOn}${docEntry.supersededBy ? ` by ${docEntry.supersededBy}` : ""} — in force at the requested as-of date.`
          : undefined,
        authorityNote:
          docEntry.sourceType === "agency_guidance"
            ? AGENCY_NOTE
            : docEntry.sourceType === "intl_guidance"
              ? INTL_NOTE
              : undefined,
      });
    }
    sectionHits.sort((a, b) => b.score - a.score);
    hits.push(...sectionHits.slice(0, MAX_SECTIONS_PER_DOC)); // source diversity
  }

  // Primary law first at comparable relevance, then score, then authority.
  hits.sort((a, b) => {
    if (a.primaryLaw !== b.primaryLaw) {
      const comparable = Math.abs(a.score - b.score) < Math.max(a.score, b.score) * 0.9;
      if (comparable) return a.primaryLaw ? -1 : 1;
    }
    if (b.score !== a.score) return b.score - a.score;
    return b.authorityWeight - a.authorityWeight;
  });

  const limited = hits.slice(0, limit);
  return {
    hits: limited,
    corpusRelease: CORPUS_RELEASE,
    asOfDate: params.asOfDate,
    jurisdiction: params.jurisdiction,
    licenseBlockedCount,
    insufficiencyWarning:
      limited.length === 0
        ? "The retrievable record is insufficient to answer this query. Lex refuses to guess: refine the query or consult the official sources directly."
        : undefined,
  };
}

/**
 * Read a full corpus document — license-gated. Non-clear classes are
 * unreachable here exactly as in search (FR-5 license enforcement at
 * retrieval, not just ingestion).
 */
export function getCorpusDocument(
  id: string,
): { ok: true; document: CorpusDocument } | { ok: false; error: string } {
  const entry = getRegistryEntry(id);
  if (!entry) return { ok: false, error: "Unknown corpus document." };
  if (!isCommercialClear(entry.licenseClass)) {
    return {
      ok: false,
      error:
        "This registry entry is not license-cleared for commercial retrieval and is unreachable by design (PRD §6.4).",
    };
  }
  return { ok: true, document: entry };
}

/** Commercial-clear registry listing for the corpus browser. */
export function listRetrievableDocuments(): CorpusDocument[] {
  return SYNTHETIC_CORPUS.filter((d) => isCommercialClear(d.licenseClass));
}

/** Full registry listing (metadata only) including blocked classes. */
export function listRegistry(): Array<
  Pick<
    CorpusDocument,
    | "id"
    | "citation"
    | "title"
    | "sourceType"
    | "collection"
    | "jurisdiction"
    | "edition"
    | "effectiveDate"
    | "supersededOn"
    | "licenseClass"
    | "licenseBasis"
  > & { retrievable: boolean }
> {
  return SYNTHETIC_CORPUS.map((d) => ({
    id: d.id,
    citation: d.citation,
    title: d.title,
    sourceType: d.sourceType,
    collection: d.collection,
    jurisdiction: d.jurisdiction,
    edition: d.edition,
    effectiveDate: d.effectiveDate,
    supersededOn: d.supersededOn,
    licenseClass: d.licenseClass,
    licenseBasis: d.licenseBasis,
    retrievable: isCommercialClear(d.licenseClass),
  }));
}
