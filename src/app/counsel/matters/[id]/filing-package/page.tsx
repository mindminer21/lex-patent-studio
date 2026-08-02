import { notFound } from "next/navigation";
import { getAdapters } from "@/lib/server/adapters";
import { requireCounsel } from "@/lib/server/session";
import { advanceFilingPackageAction, createFilingPackageAction } from "../../../actions";

const ERROR_MESSAGES: Record<string, string> = {
  actor_not_allowed: "Only the attorney role can create or advance filing packages.",
  invalid_from_state: "That status change is not allowed from the current state.",
  invalid_input: "Please provide a description between 3 and 2000 characters.",
  not_found: "Filing package or matter not found.",
};

const NEXT_STATUS: Record<string, Array<{ to: string; label: string }>> = {
  in_preparation: [{ to: "counsel_review", label: "Send to counsel review" }],
  counsel_review: [
    { to: "counsel_approved", label: "Record counsel approval" },
    { to: "in_preparation", label: "Return to preparation" },
  ],
  counsel_approved: [],
};

export default async function FilingPackagePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const context = await requireCounsel();
  const { id } = await params;
  const { error } = await searchParams;
  const { data } = getAdapters();
  const matter = await data.getLegalMatter(id);
  if (!matter) notFound();
  const packages = await data.listFilingPackages(matter.id);

  return (
    <>
      <div className="wp-topbar">
        <h1>Filing packages — {matter.matterReference}</h1>
      </div>
      <div className="wp-boundary-banner">
        Supervised filing-package preparation (PRD Phase 4). No autonomous Patent Center
        submission exists or will be added: signatures, certifications, official fees, and
        authenticated filing remain under attorney control outside wepatent.
      </div>

      {error && (
        <p className="form-error" role="alert">
          {ERROR_MESSAGES[error] ?? "Something went wrong."}
        </p>
      )}

      <div className="wp-grid cols-2">
        <div className="wp-card">
          <h2>Packages ({packages.length})</h2>
          {packages.length === 0 ? (
            <p>No filing packages yet.</p>
          ) : (
            <table className="wp-table">
              <thead>
                <tr>
                  <th scope="col">Description</th>
                  <th scope="col">Status</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {packages.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.description}</td>
                    <td>
                      <span className="wp-badge neutral">{entry.status.replace(/_/g, " ")}</span>
                    </td>
                    <td>
                      {context.assignment.role === "counsel_attorney" &&
                        NEXT_STATUS[entry.status].map((option) => (
                          <form
                            action={advanceFilingPackageAction}
                            key={option.to}
                            className="wp-inline-form"
                          >
                            <input type="hidden" name="matterId" value={matter.id} />
                            <input type="hidden" name="packageId" value={entry.id} />
                            <input type="hidden" name="to" value={option.to} />
                            <button className="button button-secondary button-small" type="submit">
                              {option.label}
                            </button>
                          </form>
                        ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="wp-card">
          <h2>New filing package</h2>
          {context.assignment.role !== "counsel_attorney" ? (
            <p>Only the attorney role can create filing packages.</p>
          ) : (
            <form action={createFilingPackageAction} className="wp-form">
              <input type="hidden" name="matterId" value={matter.id} />
              <div className="field">
                <label htmlFor="fp-description">Description</label>
                <textarea id="fp-description" name="description" required minLength={3} />
              </div>
              <div>
                <button className="button venture-button" type="submit">
                  Create filing package
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
