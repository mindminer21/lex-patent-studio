import Link from "next/link";
import { notFound } from "next/navigation";
import { isUnresolved } from "@/lib/wepatent/domain/facts";
import { getAdapters } from "@/lib/server/adapters";
import { requireOnboarded } from "@/lib/server/session";

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await requireOnboarded();
  const { data } = getAdapters();
  const invention = await data.getInvention(context.organization.id, id);
  if (!invention) notFound();

  const [facts, sources, contributors] = await Promise.all([
    data.listFacts(context.organization.id, id),
    data.listSources(context.organization.id, id),
    data.listContributors(context.organization.id, id),
  ]);
  const unresolved = facts.filter((fact) => isUnresolved(fact.provenance));
  const supported = facts.filter((fact) => fact.provenance === "source_supported");
  const reviewed = facts.filter((fact) => fact.provenance === "counsel_reviewed");
  const unextracted = sources.filter((source) => source.status !== "extracted");

  return (
    <>
      <div className="wp-boundary-banner">
        This page shows readiness of the <em>record</em>, not a legal opinion. Approval of any
        draft for filing or reliance can come only from qualified patent counsel.
      </div>

      <div className="wp-grid cols-3">
        <div className="wp-card">
          <p className="venture-kicker">Unresolved facts</p>
          <h2>{unresolved.length}</h2>
          <p>Facts needing confirmation or disputed. Counsel will want these answered.</p>
        </div>
        <div className="wp-card">
          <p className="venture-kicker">Source-supported facts</p>
          <h2>
            {supported.length} / {facts.length}
          </h2>
          <p>Facts linked to extracted source material.</p>
        </div>
        <div className="wp-card">
          <p className="venture-kicker">Counsel-reviewed facts</p>
          <h2>{reviewed.length}</h2>
          <p>
            Set only through counsel review in the connected-counsel lane — never by you, the
            model, or the platform.
          </p>
        </div>
      </div>

      <div className="wp-card" style={{ marginTop: 22 }}>
        <h2>Unresolved items for counsel</h2>
        {unresolved.length === 0 ? (
          <p>No unresolved facts. That does not imply legal sufficiency — counsel decides.</p>
        ) : (
          <table className="wp-table">
            <thead>
              <tr>
                <th scope="col">Category</th>
                <th scope="col">Statement</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {unresolved.map((fact) => (
                <tr key={fact.id}>
                  <td>{fact.category}</td>
                  <td>{fact.statement}</td>
                  <td>
                    <span className={`wp-badge ${fact.provenance}`}>
                      {fact.provenance.replace(/_/g, " ")}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="wp-card" style={{ marginTop: 22 }}>
        <h2>Approval state</h2>
        <table className="wp-table">
          <tbody>
            <tr>
              <td>Working drafts</td>
              <td>
                <span className="wp-badge draft-label">counsel review required</span> — wepatent
                cannot approve drafts, and model output cannot mark itself approved.
              </td>
            </tr>
            <tr>
              <td>Contributor record</td>
              <td>
                {contributors.length} contributors listed; inventorship determination remains with
                counsel.
              </td>
            </tr>
            <tr>
              <td>Sources</td>
              <td>
                {unextracted.length > 0
                  ? `${unextracted.length} source(s) not yet extracted — their contents are not reflected in support status.`
                  : "All registered sources extracted."}
              </td>
            </tr>
            <tr>
              <td>Next step</td>
              <td>
                <Link href={`/wepatent/app/inventions/${id}/export`}>Create a counsel-ready export</Link> or{" "}
                <Link href="/wepatent/app/counsel">request a counsel consultation</Link> (which does not
                create representation).
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
