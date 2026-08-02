import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdapters } from "@/lib/server/adapters";
import { getEngagementView } from "@/lib/server/services/counsel-lane";
import { requireCounsel } from "@/lib/server/session";

export default async function CounselEngagementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireCounsel();
  const { id } = await params;
  const view = await getEngagementView(id);
  if (!view) notFound();
  const { engagement, request, matter } = view;
  const { data } = getAdapters();
  const organization = await data.getOrganizationById(engagement.organizationId);

  return (
    <>
      <div className="wp-topbar">
        <h1>Engagement — {organization?.name ?? "Unknown organization"}</h1>
        <span
          className={`wp-status-strip ${engagement.signedAt ? "represented" : "not-represented"}`}
        >
          {engagement.signedAt ? "Engagement signed" : "Offered — not yet represented"}
        </span>
      </div>
      <div className="wp-boundary-banner">
        Representation exists only as defined by the signed engagement letter with{" "}
        {engagement.lawFirmName} — not through wepatent, and only within the engagement&apos;s
        scope. Legal fees are billed by the law firm under its own engagement, never through
        wepatent subscriptions or AI usage.
      </div>

      <div className="wp-card" style={{ maxWidth: 860 }}>
        <table className="wp-table">
          <tbody>
            <tr>
              <td>Law firm</td>
              <td>{engagement.lawFirmName}</td>
            </tr>
            <tr>
              <td>Scope summary</td>
              <td>{engagement.scopeSummary}</td>
            </tr>
            <tr>
              <td>Offered</td>
              <td>{new Date(engagement.offeredAt).toLocaleString()}</td>
            </tr>
            <tr>
              <td>Signed</td>
              <td>
                {engagement.signedAt
                  ? `${new Date(engagement.signedAt).toLocaleString()} · evidence: ${engagement.signedDocumentRef}`
                  : "Not signed"}
              </td>
            </tr>
            <tr>
              <td>Request</td>
              <td>
                {request ? (
                  <Link href={`/counsel/requests/${request.id}`}>
                    {request.requestSummary.slice(0, 60)}
                  </Link>
                ) : (
                  "—"
                )}
              </td>
            </tr>
            <tr>
              <td>Matter</td>
              <td>
                {matter ? (
                  <Link href={`/counsel/matters/${matter.id}`}>{matter.matterReference}</Link>
                ) : (
                  "Not converted"
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
