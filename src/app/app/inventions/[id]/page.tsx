import Link from "next/link";
import { notFound } from "next/navigation";
import { isUnresolved } from "@/lib/domain/facts";
import { getAdapters } from "@/lib/server/adapters";
import { requireOnboarded } from "@/lib/server/session";

export default async function InventionOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const context = await requireOnboarded();
  const { data } = getAdapters();
  const invention = await data.getInvention(context.organization.id, id);
  if (!invention) notFound();

  const [facts, contributors, events, sources, drafts, exports] = await Promise.all([
    data.listFacts(context.organization.id, id),
    data.listContributors(context.organization.id, id),
    data.listDisclosureEvents(context.organization.id, id),
    data.listSources(context.organization.id, id),
    data.listDrafts(context.organization.id, id),
    data.listExports(context.organization.id, id),
  ]);
  const unresolved = facts.filter((fact) => isUnresolved(fact.provenance));

  return (
    <div className="wp-grid cols-2">
      <div className="wp-card">
        <p className="venture-kicker">Summary</p>
        <p>{invention.summary}</p>
        <h3>Problem</h3>
        <p>{invention.problem}</p>
        <h3>Technical solution</h3>
        <p>{invention.solution}</p>
        {invention.businessContext && (
          <>
            <h3>Business context</h3>
            <p>{invention.businessContext}</p>
          </>
        )}
      </div>
      <div>
        <div className="wp-card">
          <p className="venture-kicker">Record status</p>
          <table className="wp-table">
            <tbody>
              <tr>
                <td>Facts</td>
                <td>
                  {facts.length} recorded · {unresolved.length} unresolved{" "}
                  <Link href={`/app/inventions/${id}/facts`}>View</Link>
                </td>
              </tr>
              <tr>
                <td>Contributors</td>
                <td>
                  {contributors.length} identified{" "}
                  <Link href={`/app/inventions/${id}/contributors`}>View</Link>
                </td>
              </tr>
              <tr>
                <td>Timeline events</td>
                <td>
                  {events.length} recorded <Link href={`/app/inventions/${id}/timeline`}>View</Link>
                </td>
              </tr>
              <tr>
                <td>Sources</td>
                <td>
                  {sources.length} organized <Link href={`/app/inventions/${id}/sources`}>View</Link>
                </td>
              </tr>
              <tr>
                <td>Working drafts</td>
                <td>
                  {drafts.length} generated <Link href={`/app/inventions/${id}/drafts`}>View</Link>
                </td>
              </tr>
              <tr>
                <td>Exports</td>
                <td>
                  {exports.length} created <Link href={`/app/inventions/${id}/export`}>View</Link>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="wp-card" style={{ marginTop: 22 }}>
          <p className="venture-kicker">What counsel still decides</p>
          <p>
            Inventorship, ownership, patentability, filing strategy, and deadlines are legal
            determinations. This record prepares the facts;{" "}
            <Link href={`/app/inventions/${id}/review`}>Review</Link> shows what remains
            unresolved before you talk to counsel.
          </p>
        </div>
      </div>
    </div>
  );
}
