import Link from "next/link";
import { representationStatus } from "@/lib/domain/counsel-request";
import { getAdapters } from "@/lib/server/adapters";
import { listRequestsForCounsel } from "@/lib/server/services/counsel-lane";
import { requireCounsel } from "@/lib/server/session";

/**
 * /counsel/requests (PRD §6.3): every submitted request across tenants,
 * showing LIMITED conflict-intake fields only. Draft requests are never
 * visible here — nothing is shared with counsel before submission.
 */
export default async function CounselRequestsPage() {
  await requireCounsel();
  const { data } = getAdapters();
  const requests = await listRequestsForCounsel();
  const organizations = new Map<string, string>();
  for (const request of requests) {
    if (!organizations.has(request.organizationId)) {
      const org = await data.getOrganizationById(request.organizationId);
      organizations.set(request.organizationId, org?.name ?? "Unknown organization");
    }
  }

  return (
    <>
      <div className="wp-topbar">
        <h1>Counsel requests</h1>
      </div>
      <div className="wp-boundary-banner">
        This queue shows limited conflict-intake information only. No invention record content is
        disclosed before the privacy/consent and conflict-intake rules permit it. A request is not
        an engagement; no requester is represented until a signed engagement letter exists.
      </div>

      <div className="wp-card">
        <h2>Submitted requests ({requests.length})</h2>
        {requests.length === 0 ? (
          <p>No submitted requests. Requests appear here after a customer submits conflict intake.</p>
        ) : (
          <table className="wp-table">
            <thead>
              <tr>
                <th scope="col">Organization</th>
                <th scope="col">Summary</th>
                <th scope="col">State</th>
                <th scope="col">Relationship</th>
                <th scope="col">Received</th>
                <th scope="col"></th>
              </tr>
            </thead>
            <tbody>
              {requests.map((request) => {
                const status = representationStatus(request.state);
                return (
                  <tr key={request.id}>
                    <td>{organizations.get(request.organizationId)}</td>
                    <td>{request.requestSummary.slice(0, 60)}</td>
                    <td>
                      <span className="wp-badge neutral">{request.state.replace(/_/g, " ")}</span>
                    </td>
                    <td>
                      <span
                        className={`wp-status-strip ${status.represented ? "represented" : "not-represented"}`}
                      >
                        {status.label}
                      </span>
                    </td>
                    <td>{new Date(request.createdAt).toLocaleDateString()}</td>
                    <td>
                      <Link href={`/counsel/requests/${request.id}`}>Open</Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
