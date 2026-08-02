import { notFound } from "next/navigation";
import { FACT_CATEGORIES } from "@/lib/wepatent/domain/facts";
import { getAdapters } from "@/lib/server/adapters";
import { requireOnboarded } from "@/lib/server/session";
import { addFactAction, factProvenanceAction } from "../actions";

export default async function FactsPage({
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
  const facts = await data.listFacts(context.organization.id, id);

  return (
    <>
      <div className="wp-boundary-banner">
        Facts are the canonical record, kept separate from generated prose. Model output can never
        change facts, and only qualified counsel review (in a later phase) can mark a fact
        counsel-reviewed.
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error === "actor_not_allowed"
            ? "That change is not allowed from the app lane — counsel-reviewed status requires counsel review."
            : "Could not apply that change. Please try again."}
        </p>
      )}
      <div className="wp-card">
        <h2>Canonical facts ({facts.length})</h2>
        <table className="wp-table">
          <thead>
            <tr>
              <th scope="col">Category</th>
              <th scope="col">Statement</th>
              <th scope="col">Provenance</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {facts.map((fact) => (
              <tr key={fact.id}>
                <td>{fact.category}</td>
                <td>{fact.statement}</td>
                <td>
                  <span className={`wp-badge ${fact.provenance}`}>
                    {fact.provenance.replace(/_/g, " ")}
                  </span>
                </td>
                <td>
                  <div className="wp-actions">
                    {fact.provenance !== "needs_confirmation" && (
                      <form action={factProvenanceAction} className="wp-inline-form">
                        <input type="hidden" name="inventionId" value={id} />
                        <input type="hidden" name="factId" value={fact.id} />
                        <input type="hidden" name="to" value="needs_confirmation" />
                        <button className="button button-secondary button-small" type="submit">
                          Needs confirmation
                        </button>
                      </form>
                    )}
                    {fact.provenance !== "disputed" && (
                      <form action={factProvenanceAction} className="wp-inline-form">
                        <input type="hidden" name="inventionId" value={id} />
                        <input type="hidden" name="factId" value={fact.id} />
                        <input type="hidden" name="to" value="disputed" />
                        <button className="button button-secondary button-small" type="submit">
                          Mark disputed
                        </button>
                      </form>
                    )}
                    {(fact.provenance === "needs_confirmation" ||
                      fact.provenance === "disputed") && (
                      <form action={factProvenanceAction} className="wp-inline-form">
                        <input type="hidden" name="inventionId" value={id} />
                        <input type="hidden" name="factId" value={fact.id} />
                        <input type="hidden" name="to" value="user_asserted" />
                        <button className="button button-secondary button-small" type="submit">
                          Re-assert
                        </button>
                      </form>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="wp-card" style={{ marginTop: 22, maxWidth: 760 }}>
        <h2>Add a fact</h2>
        <form action={addFactAction} className="wp-form">
          <input type="hidden" name="inventionId" value={id} />
          <div className="field">
            <label htmlFor="fact-category">Category</label>
            <select id="fact-category" name="category" required defaultValue="technical">
              {FACT_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="fact-statement">Statement</label>
            <textarea id="fact-statement" name="statement" required minLength={3} />
            <p className="hint">State what happened or what is true, not a legal conclusion.</p>
          </div>
          <div>
            <button className="button venture-button" type="submit">
              Add user-asserted fact
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
