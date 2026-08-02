import type { CorpusPort, CorpusSnippet } from "../types";

/**
 * Production public-corpus adapter (§5.8, §7.4 step 4) over the SEPARATE
 * corpus Supabase project's PostgREST API. Never shares credentials with
 * the private application project (enforced by src/lib/env).
 *
 * License discipline (legal memo §6): only documents whose recorded
 * `license_provenance.permitted_use` includes "rag" are returned, and
 * excerpts are hard-capped — link/cite rather than republish.
 *
 * Retrieval is keyword-based over citations/titles for launch; embedding
 * retrieval (public_embeddings) requires a provider account and is part of
 * the same approval-gated activation as FR-5.
 */
export const MAX_EXCERPT_CHARS = 400;

export class SupabaseCorpusAdapter implements CorpusPort {
  private readonly baseUrl: string;
  private readonly key: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: { url: string; serviceRoleKey: string; fetchImpl?: typeof fetch }) {
    this.baseUrl = options.url.replace(/\/$/, "");
    this.key = options.serviceRoleKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async searchAllowlisted(query: string, limit: number): Promise<CorpusSnippet[]> {
    const terms = query
      .split(/[^A-Za-z0-9§.]+/)
      .filter((term) => term.length > 2)
      .slice(0, 8);
    const pattern = terms.length > 0 ? `*${terms.join("*")}*` : "*";

    const select = [
      "authority",
      "citation",
      "title",
      "canonical_url",
      "public_document_versions(version_label,effective_date,public_sections(section_ref,heading,body))",
      "license_provenance(permitted_use,owner,license_terms)",
    ].join(",");
    const url =
      `${this.baseUrl}/rest/v1/public_documents?select=${encodeURIComponent(select)}` +
      `&or=(citation.ilike.${encodeURIComponent(pattern)},title.ilike.${encodeURIComponent(pattern)})` +
      `&limit=${Math.max(1, Math.min(limit, 10))}`;

    const response = await this.fetchImpl(url, {
      headers: { apikey: this.key, authorization: `Bearer ${this.key}` },
    });
    if (!response.ok) {
      // Corpus degradation must not block drafting; callers treat an empty
      // list as "no references available" (degraded-provider state, §12).
      return [];
    }
    const rows = (await response.json().catch(() => [])) as Array<{
      authority: string;
      citation: string;
      title: string;
      canonical_url: string;
      public_document_versions?: Array<{
        version_label: string;
        effective_date: string | null;
        public_sections?: Array<{ body: string }>;
      }>;
      license_provenance?: Array<{ permitted_use: string; owner: string; license_terms: string }>;
    }>;

    const snippets: CorpusSnippet[] = [];
    for (const row of rows) {
      const license = row.license_provenance?.[0];
      // Fail closed: no recorded license provenance -> not usable.
      if (!license || !license.permitted_use.toLowerCase().includes("rag")) continue;
      const version = row.public_document_versions?.[0];
      const body = version?.public_sections?.[0]?.body ?? "";
      snippets.push({
        authority: row.authority,
        citation: row.citation,
        title: row.title,
        canonicalUrl: row.canonical_url,
        effectiveDate: version?.effective_date ?? null,
        licenseNote: `${license.owner}: ${license.license_terms}`.slice(0, 200),
        excerpt: body.length > MAX_EXCERPT_CHARS ? `${body.slice(0, MAX_EXCERPT_CHARS)}…` : body,
      });
    }
    return snippets;
  }
}
