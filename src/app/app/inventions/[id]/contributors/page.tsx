import { notFound } from "next/navigation";
import { getAdapters } from "@/lib/server/adapters";
import { requireOnboarded } from "@/lib/server/session";
import { addContributorAction } from "../actions";

export default async function ContributorsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const context = await requireOnboarded();
  const { data } = getAdapters();
  const invention = await data.getInvention(context.organization.id, id);
  if (!invention) notFound();
  const contributors = await data.listContributors(context.organization.id, id);

  return (
    <>
      <div className="wp-boundary-banner">
        List everyone who contributed ideas or design work. Which contributors are legal inventors
        is a determination for qualified patent counsel — the software only collects contribution
        facts.
      </div>
      {error && (
        <p className="form-error" role="alert">
          Could not add that contributor. Check the fields and try again.
        </p>
      )}
      <div className="wp-card">
        <h2>Contributors ({contributors.length})</h2>
        <table className="wp-table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Email</th>
              <th scope="col">Contribution</th>
            </tr>
          </thead>
          <tbody>
            {contributors.map((contributor) => (
              <tr key={contributor.id}>
                <td>{contributor.name}</td>
                <td>{contributor.email ?? "—"}</td>
                <td>{contributor.contribution}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="wp-card" style={{ marginTop: 22, maxWidth: 760 }}>
        <h2>Add a contributor</h2>
        <form action={addContributorAction} className="wp-form">
          <input type="hidden" name="inventionId" value={id} />
          <div className="field">
            <label htmlFor="contrib-name">Name</label>
            <input id="contrib-name" name="name" required maxLength={400} />
          </div>
          <div className="field">
            <label htmlFor="contrib-email">Email (optional)</label>
            <input id="contrib-email" name="email" type="email" />
          </div>
          <div className="field">
            <label htmlFor="contrib-contribution">What they contributed</label>
            <textarea id="contrib-contribution" name="contribution" required minLength={3} />
          </div>
          <div>
            <button className="button venture-button" type="submit">
              Add contributor
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
