import type { Metadata } from "next";
import Link from "next/link";
import { getAdapters } from "@/lib/adapters";
import { can } from "@/lib/domain/roles";
import { portfolioSummaryEndpoint } from "@/lib/api/endpoints";
import { DEADLINE_DISCLAIMER } from "@/lib/domain/schemas";

export const metadata: Metadata = {
  title: "Portfolio — Lex Patent Studio",
};

interface PortfolioMatter {
  matterId: string;
  matterNumber: string;
  title: string;
  lifecycle: string;
  technologyArea: string;
  facts: { total: number; approved: number };
  claims: number;
  runs: number;
  pendingReviews: number;
  pendingByTier: { A: number; B: number; C: number };
  exports: number;
  nextObservedDate: string | null;
  coverageGaps: string[];
}

/**
 * /portfolio (§8.2): cross-matter status dashboard, coverage-gap signals,
 * and filing-priority ordering (§5.1 Portfolio). Role-gated: contributor,
 * operator, and viewer seats have no portfolio visibility (FR-2).
 */
export default async function PortfolioPage() {
  const adapters = getAdapters();
  const session = await adapters.auth.getSession();
  if (!session) return null;

  if (!can(session.role, "portfolio.view")) {
    return (
      <div className="max-w-[760px]">
        <h1 className="text-2xl font-medium" style={{ fontFamily: "Georgia, serif" }}>
          Portfolio
        </h1>
        <p className="mt-3 border border-[var(--line)] bg-[var(--white)] p-4 text-[0.92rem]">
          Portfolio dashboards are limited to practitioner roles. Your seat
          ({session.role}) does not include cross-matter visibility.
        </p>
      </div>
    );
  }

  const result = await portfolioSummaryEndpoint(session);
  const body = result.body as {
    matters: PortfolioMatter[];
    priorities: string[];
  };
  const byId = new Map(body.matters.map((m) => [m.matterId, m]));
  const ordered = body.priorities
    .map((id) => byId.get(id))
    .filter((m): m is PortfolioMatter => Boolean(m));

  return (
    <div className="max-w-[1200px] space-y-8">
      <header>
        <h1 className="m-0 text-3xl font-medium tracking-tight" style={{ fontFamily: "Georgia, serif" }}>
          Portfolio
        </h1>
        <p className="mt-1 mb-0 max-w-[760px] text-[0.92rem] text-[var(--muted)]">
          Status across every matter in this tenant, with deterministic
          coverage-gap signals and an advisory priority ordering. Signals are
          status observations — never legal conclusions or docket guarantees.
        </p>
      </header>

      <p className="m-0 border border-[#b9a76a] bg-[#f4ecd2] p-3 text-[0.82rem] font-semibold text-[#5d4a12]">
        {DEADLINE_DISCLAIMER}
      </p>

      <section aria-labelledby="pf-table-heading">
        <h2 id="pf-table-heading" className="text-xl font-medium" style={{ fontFamily: "Georgia, serif" }}>
          Matters by advisory priority
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse bg-[var(--white)] text-[0.86rem]">
            <thead>
              <tr className="border-b border-[var(--ink)] text-left text-[0.7rem] uppercase tracking-[0.1em]">
                <th className="p-2">Matter</th>
                <th className="p-2">Facts (approved/total)</th>
                <th className="p-2">Claims</th>
                <th className="p-2">Runs</th>
                <th className="p-2">Pending reviews (A/B/C)</th>
                <th className="p-2">Exports</th>
                <th className="p-2">Next observed date</th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((matter) => (
                <tr key={matter.matterId} className="border-b border-[var(--line)] align-top">
                  <td className="p-2">
                    <Link
                      href={`/app/matters/${matter.matterId}`}
                      className="font-bold underline underline-offset-4"
                    >
                      {matter.matterNumber}
                    </Link>
                    <span className="block max-w-[280px] text-[0.78rem] text-[var(--muted)]">
                      {matter.title} · {matter.technologyArea} · {matter.lifecycle}
                    </span>
                  </td>
                  <td className="p-2">
                    {matter.facts.approved}/{matter.facts.total}
                  </td>
                  <td className="p-2">{matter.claims}</td>
                  <td className="p-2">{matter.runs}</td>
                  <td className="p-2">
                    {matter.pendingByTier.A}/{matter.pendingByTier.B}/
                    {matter.pendingByTier.C}
                  </td>
                  <td className="p-2">{matter.exports}</td>
                  <td className="p-2 whitespace-nowrap">
                    {matter.nextObservedDate ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="pf-gaps-heading">
        <h2 id="pf-gaps-heading" className="text-xl font-medium" style={{ fontFamily: "Georgia, serif" }}>
          Coverage-gap signals
        </h2>
        {ordered.every((m) => m.coverageGaps.length === 0) ? (
          <p className="text-[0.9rem] text-[var(--muted)]">
            No gap signals across the portfolio.
          </p>
        ) : (
          <ul className="m-0 list-none space-y-2 p-0">
            {ordered
              .filter((m) => m.coverageGaps.length > 0)
              .map((matter) => (
                <li key={matter.matterId} className="border border-[var(--line)] bg-[var(--white)] p-3">
                  <strong className="text-[0.9rem]">{matter.matterNumber}</strong>
                  <ul className="mb-0 mt-1 space-y-0.5 pl-5 text-[0.85rem]">
                    {matter.coverageGaps.map((gap) => (
                      <li key={gap}>{gap}</li>
                    ))}
                  </ul>
                </li>
              ))}
          </ul>
        )}
      </section>
    </div>
  );
}
