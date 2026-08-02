import Link from "next/link";
import { needsReacceptance } from "@/lib/wepatent/domain/clickwrap";
import { representationStatus } from "@/lib/wepatent/domain/counsel-request";
import { isUnresolved } from "@/lib/wepatent/domain/facts";
import { getAdapters } from "@/lib/server/adapters";
import { requireUser } from "@/lib/server/session";
import { createOrganizationAction } from "./actions";

function centsToUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const context = await requireUser();
  const { data } = getAdapters();

  if (!context.membership || !context.organization) {
    return (
      <>
        <div className="wp-topbar">
          <h1>Create your organization</h1>
        </div>
        <div className="wp-boundary-banner">
          wepatent is not a law firm. Creating an organization, uploading materials, or paying for
          software never creates an attorney-client relationship.
        </div>
        <div className="wp-card" style={{ maxWidth: 640 }}>
          <p className="venture-kicker">Step 1 of 2</p>
          <h2>Name your organization</h2>
          <p>
            Your organization holds invention records, members, and billing. You can invite
            teammates later from Settings.
          </p>
          <form action={createOrganizationAction} className="wp-form">
            {error === "invalid_org_name" && (
              <p className="form-error" role="alert">
                Organization names must be 2–120 characters.
              </p>
            )}
            <div className="field">
              <label htmlFor="org-name">Organization name</label>
              <input id="org-name" name="name" type="text" required minLength={2} maxLength={120} />
            </div>
            <div>
              <button className="button venture-button" type="submit">
                Create organization
              </button>
            </div>
          </form>
        </div>
      </>
    );
  }

  const organizationId = context.organization.id;
  const acceptance = await data.getLatestAcceptance(organizationId, context.user.id);
  const termsPending = !acceptance || needsReacceptance(acceptance.termsVersion);
  const inventions = await data.listInventions(organizationId);
  const wallet = await data.getWallet(organizationId);
  const counselRequests = await data.listCounselRequests(organizationId);

  const factSummaries = await Promise.all(
    inventions.map(async (invention) => {
      const facts = await data.listFacts(organizationId, invention.id);
      return {
        invention,
        factCount: facts.length,
        unresolved: facts.filter((fact) => isUnresolved(fact.provenance)).length,
      };
    }),
  );

  return (
    <>
      <div className="wp-topbar">
        <h1>Dashboard</h1>
        <span className="org">{context.organization.name}</span>
      </div>

      {termsPending ? (
        <div className="wp-boundary-banner wp-banner-danger">
          <strong>Action required:</strong> before substantive invention intake you must review and
          accept the current Self-Service Terms and acknowledgements.{" "}
          <Link href="/wepatent/app/terms">Review and accept</Link>
        </div>
      ) : (
        <div className="wp-boundary-banner">
          wepatent organizes facts and prepares working drafts. It is not a law firm and does not
          provide legal advice; qualified patent counsel must review and approve drafts before any
          consequential use.
        </div>
      )}

      <div className="wp-grid cols-3">
        <div className="wp-card">
          <p className="venture-kicker">Invention records</p>
          <h2>{inventions.length}</h2>
          <p>
            {factSummaries.reduce((sum, s) => sum + s.unresolved, 0)} unresolved facts across all
            records.
          </p>
        </div>
        <div className="wp-card">
          <p className="venture-kicker">AI usage wallet</p>
          <h2>{wallet ? centsToUsd(wallet.balanceCents - wallet.reservedCents) : "$0.00"}</h2>
          <p>
            Available (synthetic local credit). Charges are provider cost × 1.50, shown before every
            run. <Link href="/wepatent/app/billing">Billing</Link>
          </p>
        </div>
        <div className="wp-card">
          <p className="venture-kicker">Counsel requests</p>
          <h2>{counselRequests.length}</h2>
          {counselRequests.length > 0 ? (
            <p>
              Latest: {counselRequests[counselRequests.length - 1].state} —{" "}
              {representationStatus(counselRequests[counselRequests.length - 1].state).label}.{" "}
              <Link href="/wepatent/app/counsel">View</Link>
            </p>
          ) : (
            <p>
              No requests. Requesting counsel never creates representation by itself.{" "}
              <Link href="/wepatent/app/counsel">Learn more</Link>
            </p>
          )}
        </div>
      </div>

      <div className="wp-card" style={{ marginTop: 22 }}>
        <div className="wp-topbar" style={{ marginBottom: 10 }}>
          <h2>Invention records</h2>
          <Link className="button venture-button button-small" href="/wepatent/app/inventions/new">
            New invention record
          </Link>
        </div>
        {factSummaries.length === 0 ? (
          <div className="wp-empty">
            <h2>No invention records yet</h2>
            <p>Create your first invention record to start organizing facts for counsel.</p>
            <Link className="button venture-button" href="/wepatent/app/inventions/new">
              Create an invention record
            </Link>
          </div>
        ) : (
          <table className="wp-table">
            <thead>
              <tr>
                <th scope="col">Title</th>
                <th scope="col">Facts</th>
                <th scope="col">Unresolved</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {factSummaries.map(({ invention, factCount, unresolved }) => (
                <tr key={invention.id}>
                  <td>
                    <Link href={`/wepatent/app/inventions/${invention.id}`}>{invention.title}</Link>{" "}
                    {invention.synthetic && <span className="wp-badge synthetic">Synthetic example</span>}
                  </td>
                  <td>{factCount}</td>
                  <td>{unresolved}</td>
                  <td>
                    <span className="wp-badge draft-label">Working record — counsel review required</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
