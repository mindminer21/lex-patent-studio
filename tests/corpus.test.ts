import { beforeEach, describe, expect, it } from "vitest";
import { LocalCorpusAdapter, MAX_EXCERPT_CHARS } from "@/lib/server/adapters/local/corpus";
import { SupabaseCorpusAdapter } from "@/lib/server/adapters/production/corpus";
import { getAdapters } from "@/lib/server/adapters";
import { LocalDataAdapter } from "@/lib/server/adapters/local/store";
import { createOrganizationForUser } from "@/lib/server/services/orgs";
import { runGeneration } from "@/lib/server/services/generation";

/**
 * §7.4 steps 4 and 6: allowlisted public-corpus context and draft-version
 * reference linkage. Production adapter is tested with injected fetch —
 * no corpus project or credentials required (PRD §17 seam).
 */

describe("LocalCorpusAdapter", () => {
  it("returns deterministic, excerpt-bounded, license-annotated snippets", async () => {
    const corpus = new LocalCorpusAdapter();
    const snippets = await corpus.searchAllowlisted("novelty disclosure", 3);
    expect(snippets.length).toBeGreaterThan(0);
    expect(snippets.length).toBeLessThanOrEqual(3);
    for (const snippet of snippets) {
      expect(snippet.excerpt.length).toBeLessThanOrEqual(MAX_EXCERPT_CHARS + 1);
      expect(snippet.licenseNote).toContain("public domain");
      expect(snippet.canonicalUrl).toMatch(/^https:\/\//);
    }
  });
});

describe("SupabaseCorpusAdapter (production seam, injected fetch)", () => {
  const row = (overrides: Record<string, unknown> = {}) => ({
    authority: "uscode",
    citation: "35 U.S.C. §101",
    title: "Inventions patentable",
    canonical_url: "https://uscode.house.gov/x",
    public_document_versions: [
      {
        version_label: "2026",
        effective_date: "2026-01-01",
        public_sections: [{ body: "B".repeat(1_000) }],
      },
    ],
    license_provenance: [
      { permitted_use: "rag,cite", owner: "US Gov", license_terms: "public domain" },
    ],
    ...overrides,
  });

  function adapter(payload: unknown, status = 200) {
    const calls: string[] = [];
    const impl = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return Response.json(payload, { status });
    }) as typeof fetch;
    return {
      corpus: new SupabaseCorpusAdapter({
        url: "https://corpus.supabase.co",
        serviceRoleKey: "corpus-service-key",
        fetchImpl: impl,
      }),
      calls,
    };
  }

  it("queries the corpus project and caps excerpts", async () => {
    const { corpus, calls } = adapter([row()]);
    const snippets = await corpus.searchAllowlisted("patentable inventions", 3);
    expect(calls[0]).toContain("https://corpus.supabase.co/rest/v1/public_documents");
    expect(snippets).toHaveLength(1);
    expect(snippets[0].excerpt.length).toBeLessThanOrEqual(401);
    expect(snippets[0].effectiveDate).toBe("2026-01-01");
  });

  it("fails closed on missing or non-RAG license provenance", async () => {
    const { corpus } = adapter([
      row({ license_provenance: [] }),
      row({
        citation: "Proprietary Treatise §1",
        license_provenance: [
          { permitted_use: "internal-review-only", owner: "Vendor", license_terms: "licensed" },
        ],
      }),
    ]);
    expect(await corpus.searchAllowlisted("anything", 5)).toHaveLength(0);
  });

  it("degrades to an empty list on corpus outage instead of failing the run", async () => {
    const { corpus } = adapter({ message: "unavailable" }, 503);
    expect(await corpus.searchAllowlisted("anything", 3)).toHaveLength(0);
  });
});

describe("generation links versions to source/fact/corpus references (§7.4.6)", () => {
  beforeEach(() => LocalDataAdapter.reset());

  it("writes draft citations and includes authority references in the draft", async () => {
    const { data } = getAdapters();
    const user = await data.createUser({ email: "cite@example.test", displayName: "C" });
    const organization = await createOrganizationForUser(user.id, "Citation Org");
    const [invention] = await data.listInventions(organization.id);

    const result = await runGeneration({
      organizationId: organization.id,
      userId: user.id,
      inventionId: invention.id,
      workflow: "invention_disclosure_summary",
      tierId: "standard",
      idempotencyKey: "cite-run-1",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const citations = await data.listDraftCitations(organization.id, result.version.id);
    const kinds = {
      source: citations.filter((c) => c.sourceId !== null).length,
      fact: citations.filter((c) => c.factId !== null).length,
      corpus: citations.filter((c) => c.locator.startsWith("corpus:")).length,
    };
    expect(kinds.fact).toBeGreaterThan(0);
    expect(kinds.corpus).toBeGreaterThan(0);
    // The draft itself lists the allowlisted references with as-of dates.
    expect(result.version.content).toContain("Public authority references");
    expect(result.version.content).toContain("current as of");

    // Retry with the same idempotency key: no duplicate citations.
    const retry = await runGeneration({
      organizationId: organization.id,
      userId: user.id,
      inventionId: invention.id,
      workflow: "invention_disclosure_summary",
      tierId: "standard",
      idempotencyKey: "cite-run-1",
    });
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    expect(retry.version.id).toBe(result.version.id);
    expect(await data.listDraftCitations(organization.id, result.version.id)).toHaveLength(
      citations.length,
    );
  });
});
