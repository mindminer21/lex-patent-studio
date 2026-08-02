import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdapters } from "@/lib/server/adapters";
import { requireCounsel } from "@/lib/server/session";

export default async function CounselMatterPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireCounsel();
  const { id } = await params;
  const { data } = getAdapters();
  const matter = await data.getLegalMatter(id);
  if (!matter) notFound();
  const engagement = await data.getEngagement(matter.engagementId);
  const organization = await data.getOrganizationById(matter.organizationId);
  const packages = await data.listFilingPackages(matter.id);

  return (
    <>
      <div className="wp-topbar">
        <h1>Matter {matter.matterReference}</h1>
        <span className="wp-status-strip represented">Engagement signed</span>
      </div>
      <div className="wp-boundary-banner">
        This matter exists under the signed engagement with{" "}
        {engagement?.lawFirmName ?? "the law firm"}. Patent Center credentials, signatures,
        certifications, official fees, and authenticated submission remain under attorney control
        outside this system — wepatent never files.
      </div>

      <div className="wp-grid cols-2">
        <div className="wp-card">
          <h2>Matter record</h2>
          <table className="wp-table">
            <tbody>
              <tr>
                <td>Client organization</td>
                <td>{organization?.name ?? "Unknown"}</td>
              </tr>
              <tr>
                <td>Opened</td>
                <td>{new Date(matter.openedAt).toLocaleString()}</td>
              </tr>
              <tr>
                <td>Engagement</td>
                <td>
                  {engagement ? (
                    <Link href={`/counsel/engagements/${engagement.id}`}>
                      {engagement.scopeSummary.slice(0, 60)}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="wp-card">
          <h2>Filing packages ({packages.length})</h2>
          <p>
            Supervised preparation only: <em>in preparation → counsel review → counsel
            approved</em>. There is no submission state in wepatent.
          </p>
          <p>
            <Link href={`/counsel/matters/${matter.id}/filing-package`}>
              Open the filing-package workspace
            </Link>
          </p>
        </div>
      </div>
    </>
  );
}
