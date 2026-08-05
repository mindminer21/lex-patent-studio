import Link from "next/link";
import { softDeleteInventionAction } from "./actions";
import { notFound, redirect } from "next/navigation";
import { isUnresolved } from "@/lib/wepatent/domain/facts";
import { isEmptyRecord } from "@/lib/wepatent/domain/record-emptiness";
import { getAdapters } from "@/lib/server/adapters";
import { loadRecordContentCounts } from "@/lib/server/services/record-emptiness";
import { requireOnboarded } from "@/lib/server/session";

/**
 * Overview also carries the contextual homes for the four routes dropped
 * from the record navigation: the "Record status" rows link to Facts,
 * Contributors, Timeline, and Sources, and the counsel card links to
 * Review. Every route is unchanged — only the tab bar shrank.
 */
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

  // An empty record has one surface only — the Studio's first-run upload
  // area and guided-questions button (Jeff's direction, 2026-08-04). There
  // is no tab navigation to get back here, so the overview forwards rather
  // than showing a page of empty cards.
  if (isEmptyRecord(await loadRecordContentCounts(context.organization.id, id))) {
    redirect(`/wepatent/app/inventions/${id}/studio`);
  }

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
                  <Link href={`/wepatent/app/inventions/${id}/facts`}>View</Link>
                </td>
              </tr>
              <tr>
                <td>Contributors</td>
                <td>
                  {contributors.length} identified{" "}
                  <Link href={`/wepatent/app/inventions/${id}/contributors`}>View</Link>
                </td>
              </tr>
              <tr>
                <td>Timeline events</td>
                <td>
                  {events.length} recorded <Link href={`/wepatent/app/inventions/${id}/timeline`}>View</Link>
                </td>
              </tr>
              <tr>
                <td>Sources</td>
                <td>
                  {sources.length} organized <Link href={`/wepatent/app/inventions/${id}/sources`}>View</Link>
                </td>
              </tr>
              <tr>
                <td>Working drafts</td>
                <td>
                  {drafts.length} generated <Link href={`/wepatent/app/inventions/${id}/drafts`}>View</Link>
                </td>
              </tr>
              <tr>
                <td>Exports</td>
                <td>
                  {exports.length} created <Link href={`/wepatent/app/inventions/${id}/export`}>View</Link>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="wp-card" style={{ marginTop: 22 }}>
          <p className="venture-kicker">Delete this record</p>
          <p>
            Deleting moves the record out of active lists immediately (soft delete). It is
            permanently purged — facts, sources, drafts, and exports removed — after the
            organization&apos;s retention window ({/* FR-3 */}see Settings).
          </p>
          <form action={softDeleteInventionAction}>
            <input type="hidden" name="inventionId" value={id} />
            <button className="button button-secondary button-small" type="submit">
              Soft-delete invention record
            </button>
          </form>
        </div>
        <div className="wp-card" style={{ marginTop: 22 }}>
          <p className="venture-kicker">What counsel still decides</p>
          <p>
            Inventorship, ownership, patentability, filing strategy, and deadlines are legal
            determinations. This record prepares the facts;{" "}
            <Link href={`/wepatent/app/inventions/${id}/review`}>Review</Link> shows what remains
            unresolved before you talk to counsel.
          </p>
        </div>
      </div>
    </div>
  );
}
