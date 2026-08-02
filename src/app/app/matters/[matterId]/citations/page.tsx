import type { Metadata } from "next";
import { getAdapters } from "@/lib/adapters";
import { VerificationBadge } from "@/components/workspace/badges";
import { getRegistryEntry } from "@/lib/knowledge";

export const metadata: Metadata = {
  title: "Citations — Lex Patent Studio",
};

/**
 * Authority panel (PRD §8.2 /citations): every citation across the matter's
 * work product with its verification state. Invariant 13: authority is cited
 * or the entry is a labeled-analysis marker. Invariant 14: verifier failures
 * are visible and block "verified" status on the parent document.
 */
export default async function MatterCitationsPage({
  params,
}: {
  params: Promise<{ matterId: string }>;
}) {
  const { matterId } = await params;
  const adapters = getAdapters();
  const session = await adapters.auth.getSession();
  if (!session) return null;

  const documents = await adapters.data.listDocuments(
    session.organizationId,
    matterId,
  );

  const rows = documents.flatMap((doc) =>
    doc.citations.map((citation) => ({ doc, citation })),
  );
  const authorityRows = rows.filter((r) => r.citation.kind === "authority");
  const analysisRows = rows.filter((r) => r.citation.kind === "analysis");
  const failedCount = authorityRows.filter(
    (r) => r.citation.verification === "failed",
  ).length;

  return (
    <div className="max-w-[1100px] space-y-8">
      <section aria-labelledby="cit-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="cit-heading" className="m-0 text-xl font-medium" style={{ fontFamily: "Georgia, serif" }}>
            Authority panel
          </h2>
          <p className="m-0 text-[0.82rem] text-[var(--muted)]">
            {authorityRows.length} citation{authorityRows.length === 1 ? "" : "s"} ·{" "}
            {failedCount} verifier failure{failedCount === 1 ? "" : "s"}
          </p>
        </div>
        <p className="max-w-[820px] text-[0.85rem] text-[var(--muted)]">
          Every legal proposition in this matter&apos;s work product is either
          cited to a retrievable source in its run&apos;s evidence set or
          explicitly labeled analysis. A quotation that fails the verifier
          blocks &ldquo;verified&rdquo; status on the whole document — failures
          cannot be dismissed silently.
        </p>

        {authorityRows.length === 0 ? (
          <p className="border border-dashed border-[var(--line)] bg-[var(--white)] p-4 text-[0.9rem] text-[var(--muted)]">
            No citations yet. Run a workflow with quote verification enabled
            and its evidence set will appear here with per-quotation
            verification states.
          </p>
        ) : (
          <ul className="m-0 list-none space-y-2 p-0">
            {authorityRows.map(({ doc, citation }) => {
              const registryEntry = citation.corpusDocumentId
                ? getRegistryEntry(citation.corpusDocumentId)
                : undefined;
              return (
                <li
                  key={`${doc.id}-${citation.id}`}
                  className="border border-[var(--line)] bg-[var(--white)] p-3"
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <strong className="text-[0.95rem]">{citation.citation}</strong>
                    <VerificationBadge
                      state={
                        citation.verification === "verified"
                          ? "verified"
                          : citation.verification === "failed"
                            ? "failed"
                            : "unverified"
                      }
                    />
                    <span className="text-[0.78rem] text-[var(--muted)]">
                      in {doc.title}
                    </span>
                  </div>
                  {citation.quote && (
                    <blockquote className="mt-2 mb-0 border-l-2 border-[var(--line)] pl-3 text-[0.88rem] italic">
                      &ldquo;{citation.quote}&rdquo;
                    </blockquote>
                  )}
                  {registryEntry && (
                    <p className="mt-1 mb-0 text-[0.75rem] text-[var(--muted)]">
                      {registryEntry.edition} · effective {registryEntry.effectiveDate} ·{" "}
                      {registryEntry.licenseClass}
                    </p>
                  )}
                  {citation.note && (
                    <p
                      className={`mt-1 mb-0 text-[0.8rem] font-semibold ${
                        citation.verification === "failed"
                          ? "text-[#7c1f1f]"
                          : "text-[#5d4a12]"
                      }`}
                    >
                      {citation.note}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="analysis-heading">
        <h2 id="analysis-heading" className="text-lg font-medium" style={{ fontFamily: "Georgia, serif" }}>
          Labeled analysis (no authority quoted)
        </h2>
        {analysisRows.length === 0 ? (
          <p className="text-[0.88rem] text-[var(--muted)]">
            No labeled-analysis entries in this matter yet.
          </p>
        ) : (
          <ul className="m-0 list-none space-y-2 p-0">
            {analysisRows.map(({ doc, citation }) => (
              <li
                key={`${doc.id}-${citation.id}`}
                className="border border-[var(--line)] bg-[var(--white)] p-3"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="inline-flex items-center border border-[#9a958a] bg-[#efece3] px-1.5 py-0.5 text-[0.68rem] font-bold uppercase tracking-[0.08em] text-[#5a564c]">
                    Analysis — not quoted authority
                  </span>
                  <span className="text-[0.78rem] text-[var(--muted)]">
                    in {doc.title}
                  </span>
                </div>
                {citation.note && (
                  <p className="mt-1 mb-0 text-[0.85rem]">{citation.note}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
