import Link from "next/link";
import { needsReacceptance } from "@/lib/wepatent/domain/clickwrap";
import { isUnresolved } from "@/lib/wepatent/domain/facts";
import { getAdapters } from "@/lib/server/adapters";
import { requireUser } from "@/lib/server/session";
import { createOrganizationAction } from "./actions";

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

      <div className="wp-card">
        <div className="wp-topbar" style={{ marginBottom: 10 }}>
          <h2>Inventions</h2>
          <div style={{ textAlign: "right" }}>
            <Link className="button venture-button button-small" href="/wepatent/app/inventions/start">
              New invention
            </Link>
            <span className="hint" style={{ display: "block", marginTop: 4 }}>
              Start a patent-ready disclosure
            </span>
          </div>
        </div>
        {factSummaries.length === 0 ? (
          <div className="wp-empty">
            <h2>Click New Invention to start a patent disclosure</h2>
            <p>Upload files, answer questions about your invention, or both.</p>
            <Link className="button venture-button" href="/wepatent/app/inventions/start">
              New invention
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
