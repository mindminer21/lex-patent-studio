import Link from "next/link";
import { getAdapters } from "@/lib/adapters";

export default async function MattersPage() {
  const adapters = getAdapters();
  const session = await adapters.auth.getSession();
  if (!session) return null;
  const org = session.organizationId;

  const matters = await adapters.data.listMatters(org);
  const withCounts = await Promise.all(
    matters.map(async (matter) => {
      const [facts, reviewItems, runs] = await Promise.all([
        adapters.data.listFacts(org, matter.id),
        adapters.data.listReviewItems(org, {
          matterId: matter.id,
          state: "pending_review",
        }),
        adapters.data.listRuns(org, matter.id),
      ]);
      return {
        matter,
        factsTotal: facts.length,
        factsApproved: facts.filter((f) => f.provenance === "counsel_reviewed").length,
        pendingReviews: reviewItems.length,
        runsTotal: runs.length,
      };
    }),
  );

  return (
    <div className="max-w-[1100px]">
      <h1 className="text-3xl font-medium tracking-tight" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>
        Matters
      </h1>
      <p className="mt-1 text-[0.9rem] text-[var(--muted)]">
        Tenant-isolated matter workspaces. Nothing learned in one matter
        surfaces in another. All matters below are synthetic demonstration
        data.
      </p>

      {withCounts.length === 0 ? (
        <p className="mt-6 border border-dashed border-[var(--line)] bg-[var(--white)] p-5 text-[0.9rem] text-[var(--muted)]">
          No matters yet. Every matter you create gets its own isolated fact
          ledger, sources, and workflow history; all generated work product
          arrives as <strong>DRAFT — NOT REVIEWED</strong> with a work-tier
          label.
        </p>
      ) : (
        <table className="mt-6 w-full border-collapse bg-[var(--white)] text-[0.9rem]">
          <thead>
            <tr className="border-b border-[var(--ink)] text-left text-[0.72rem] uppercase tracking-[0.1em]">
              <th className="p-3">Matter</th>
              <th className="p-3">Technology</th>
              <th className="p-3">Facts approved</th>
              <th className="p-3">Pending review</th>
              <th className="p-3">Runs</th>
              <th className="p-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {withCounts.map(({ matter, factsTotal, factsApproved, pendingReviews, runsTotal }) => (
              <tr key={matter.id} className="border-b border-[var(--line)] align-top">
                <td className="p-3">
                  <Link
                    href={`/app/matters/${matter.id}`}
                    className="font-bold underline underline-offset-4"
                  >
                    {matter.matterNumber}
                  </Link>
                  <p className="mb-0 mt-1 max-w-[380px] text-[0.85rem] text-[var(--muted)]">
                    {matter.title}
                  </p>
                </td>
                <td className="p-3">{matter.technologyArea}</td>
                <td className="p-3">
                  {factsApproved}/{factsTotal}
                </td>
                <td className="p-3">{pendingReviews}</td>
                <td className="p-3">{runsTotal}</td>
                <td className="p-3 capitalize">{matter.lifecycle}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
