import type { Metadata } from "next";
import { getAdapters } from "@/lib/adapters";
import { can } from "@/lib/domain/roles";
import {
  getCorpusReleaseInfo,
  listRegistry,
  searchCorpus,
} from "@/lib/knowledge";

export const metadata: Metadata = {
  title: "Knowledge — Lex Patent Studio",
};

const SOURCE_TYPE_LABELS: Record<string, string> = {
  statute: "Statute",
  regulation: "Regulation",
  case_scotus: "Supreme Court",
  case_cafc: "Federal Circuit",
  agency_guidance: "Agency guidance",
  ptab_decision: "PTAB",
  intl_guidance: "International",
  patent_document: "Patent document",
};

const LICENSE_LABELS: Record<string, string> = {
  government_work: "Government work",
  public_data_api: "Public data (official API)",
  org_reuse_terms: "Org reuse terms",
  licensed_commercial: "Commercial license — BLOCKED",
  internal_only: "Internal only — BLOCKED",
};

export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; asOf?: string }>;
}) {
  const adapters = getAdapters();
  const session = await adapters.auth.getSession();
  if (!session) return null;

  if (!can(session.role, "knowledge.search")) {
    return (
      <div className="max-w-[760px]">
        <h1 className="text-2xl font-medium" style={{ fontFamily: "Georgia, serif" }}>
          Knowledge
        </h1>
        <p className="mt-3 border border-[var(--line)] bg-[var(--white)] p-4 text-[0.92rem]">
          Your seat ({session.role}) does not include the corpus browser.
          Contributor seats cover intake, fact contribution, source upload,
          and status visibility; ask a practitioner admin if you need research
          access.
        </p>
      </div>
    );
  }

  const params = await searchParams;
  const query = (params.q ?? "").trim();
  const asOfDate =
    params.asOf && /^\d{4}-\d{2}-\d{2}$/.test(params.asOf)
      ? params.asOf
      : new Date().toISOString().slice(0, 10);

  const release = getCorpusReleaseInfo();
  const registry = listRegistry();
  const result =
    query.length >= 2
      ? searchCorpus({ query, jurisdiction: "US", asOfDate, limit: 12 })
      : null;

  return (
    <div className="max-w-[1200px] space-y-8">
      <header>
        <h1 className="m-0 text-3xl font-medium tracking-tight" style={{ fontFamily: "Georgia, serif" }}>
          Knowledge
        </h1>
        <p className="mt-1 mb-0 max-w-[760px] text-[0.92rem] text-[var(--muted)]">
          License-gated public corpus browser. Release{" "}
          <strong>{release.releaseId}</strong> · {release.documentCount} registry
          entries · {release.licenseBlockedCount} blocked by the license gate
          (unreachable by design). Snippets are discovery only — read the full
          section before quoting; every quotation must pass the verifier.
        </p>
      </header>

      <section aria-labelledby="ksearch-heading" className="border border-[var(--line)] bg-[var(--white)] p-4">
        <h2 id="ksearch-heading" className="mt-0 text-lg font-medium" style={{ fontFamily: "Georgia, serif" }}>
          Search the corpus
        </h2>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <div className="min-w-[260px] flex-1">
            <label htmlFor="k-q" className="mb-1 block text-[0.72rem] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
              Query
            </label>
            <input
              id="k-q"
              name="q"
              type="text"
              defaultValue={query}
              minLength={2}
              maxLength={200}
              required
              placeholder="e.g. obviousness rationales prima facie"
              className="w-full border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-[0.92rem]"
            />
          </div>
          <div>
            <label htmlFor="k-asof" className="mb-1 block text-[0.72rem] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
              As-of date (required run parameter)
            </label>
            <input
              id="k-asof"
              name="asOf"
              type="date"
              defaultValue={asOfDate}
              className="border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-[0.92rem]"
            />
          </div>
          <button
            type="submit"
            className="min-h-[44px] border border-[var(--forest)] bg-[var(--forest)] px-4 py-2 text-[0.9rem] font-bold text-white hover:opacity-90"
          >
            Search as of date
          </button>
        </form>

        {result && (
          <div className="mt-4">
            {result.insufficiencyWarning ? (
              <p className="border border-[#b9a76a] bg-[#f4ecd2] p-3 text-[0.88rem] font-semibold text-[#5d4a12]">
                {result.insufficiencyWarning}
              </p>
            ) : (
              <>
                <p className="text-[0.8rem] text-[var(--muted)]">
                  {result.hits.length} hit{result.hits.length === 1 ? "" : "s"} as of{" "}
                  {result.asOfDate} · {result.licenseBlockedCount} match
                  {result.licenseBlockedCount === 1 ? "" : "es"} withheld by the
                  license gate · release {result.corpusRelease}
                </p>
                <ol className="m-0 list-none space-y-2 p-0">
                  {result.hits.map((hit) => (
                    <li
                      key={`${hit.documentId}-${hit.sectionId}`}
                      className="border border-[var(--line)] bg-[var(--paper)] p-3"
                    >
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <strong className="text-[0.95rem]">{hit.citation}</strong>
                        <span className="text-[0.72rem] font-bold uppercase tracking-[0.08em] text-[var(--muted)]">
                          {SOURCE_TYPE_LABELS[hit.sourceType] ?? hit.sourceType}
                          {hit.primaryLaw ? " · primary law" : ""}
                        </span>
                        <span className="text-[0.75rem] text-[var(--muted)]">
                          {hit.edition} · effective {hit.effectiveDate}
                        </span>
                      </div>
                      <p className="mt-1 mb-0 text-[0.88rem]">
                        <span className="font-semibold">{hit.sectionHeading}:</span>{" "}
                        {hit.snippet}
                      </p>
                      {(hit.authorityNote || hit.supersessionNote) && (
                        <p className="mt-1 mb-0 text-[0.78rem] font-semibold text-[#5d4a12]">
                          {hit.authorityNote ?? hit.supersessionNote}
                        </p>
                      )}
                    </li>
                  ))}
                </ol>
              </>
            )}
          </div>
        )}
      </section>

      <section aria-labelledby="kregistry-heading">
        <h2 id="kregistry-heading" className="text-xl font-medium" style={{ fontFamily: "Georgia, serif" }}>
          Source registry and license basis
        </h2>
        <p className="max-w-[820px] text-[0.85rem] text-[var(--muted)]">
          Every registry entry records its license class (PRD §6.4). Entries
          outside the commercial-clear set appear here as metadata only —
          their content is unreachable in search, document reads, and quote
          verification. All local-mode entries are synthetic paraphrases; the
          production registry ships only after the license audit (approval
          gate §20.9).
        </p>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse bg-[var(--white)] text-[0.85rem]">
            <thead>
              <tr className="border-b border-[var(--ink)] text-left text-[0.7rem] uppercase tracking-[0.1em]">
                <th className="p-2">Citation</th>
                <th className="p-2">Type</th>
                <th className="p-2">Edition</th>
                <th className="p-2">Effective</th>
                <th className="p-2">License class</th>
                <th className="p-2">Retrievable</th>
              </tr>
            </thead>
            <tbody>
              {registry.map((entry) => (
                <tr key={entry.id} className="border-b border-[var(--line)] align-top">
                  <td className="p-2 font-semibold">{entry.citation}</td>
                  <td className="p-2">{SOURCE_TYPE_LABELS[entry.sourceType] ?? entry.sourceType}</td>
                  <td className="p-2 text-[var(--muted)]">{entry.edition}</td>
                  <td className="p-2 whitespace-nowrap">
                    {entry.effectiveDate}
                    {entry.supersededOn ? (
                      <span className="block text-[0.72rem] text-[#7c1f1f]">
                        superseded {entry.supersededOn}
                      </span>
                    ) : null}
                  </td>
                  <td className="p-2">{LICENSE_LABELS[entry.licenseClass] ?? entry.licenseClass}</td>
                  <td className="p-2">
                    {entry.retrievable ? (
                      <span className="font-bold text-[#2f4a16]">Yes</span>
                    ) : (
                      <span className="font-bold text-[#7c1f1f]">
                        No — license gate
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
