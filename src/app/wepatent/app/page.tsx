import Link from "next/link";
import { redirect } from "next/navigation";
import { needsReacceptance } from "@/lib/wepatent/domain/clickwrap";
import { isUnresolved } from "@/lib/wepatent/domain/facts";
import { getAdapters } from "@/lib/server/adapters";
import { ensurePersonalOrganization } from "@/lib/server/services/orgs";
import { requireUser } from "@/lib/server/session";

export default async function DashboardPage() {
  const context = await requireUser();
  const { data } = getAdapters();

  // Design rule (minimal human input): the blocking "Create your
  // organization" step is gone — the first organization is created on
  // first sign-in with a placeholder name (editable in Settings). This
  // idempotent call is the safety net for sessions that predate that
  // change; it uses the same transactional creation path.
  const organization =
    context.organization ?? (await ensurePersonalOrganization(context.user));
  if (!organization) redirect("/wepatent/sign-in");

  const organizationId = organization.id;
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
        <span className="org">{organization.name}</span>
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
