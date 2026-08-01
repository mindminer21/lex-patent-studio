import { notFound } from "next/navigation";
import { getAdapters } from "@/lib/server/adapters";
import { requireOnboarded } from "@/lib/server/session";
import { createExportAction } from "../actions";

export default async function ExportPage({
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

  const drafts = await data.listDrafts(context.organization.id, id);
  const versions = (
    await Promise.all(
      drafts.map((draft) => data.listDraftVersions(context.organization.id, draft.id)),
    )
  ).flat();
  const exports = await data.listExports(context.organization.id, id);

  return (
    <>
      <div className="wp-boundary-banner">
        Exports are version-locked: the manifest references immutable draft-version IDs and a
        checksum, so later record changes never silently alter an existing export. Every export
        carries the counsel-review notice.
      </div>
      {error && (
        <p className="form-error" role="alert">
          Could not create the export: {error.replace(/_/g, " ")}.
        </p>
      )}

      <div className="wp-grid cols-2">
        <div className="wp-card">
          <h2>Create a counsel package</h2>
          <form action={createExportAction} className="wp-form">
            <input type="hidden" name="inventionId" value={id} />
            <fieldset>
              <legend>Included sections</legend>
              {["facts", "contributors", "timeline", "sources"].map((section) => (
                <label className="acknowledgement" key={section}>
                  <input type="checkbox" name={`section_${section}`} defaultChecked />
                  <span>{section[0].toUpperCase() + section.slice(1)}</span>
                </label>
              ))}
            </fieldset>
            <div className="field">
              <label htmlFor="draftVersionId">Working draft version (optional)</label>
              <select id="draftVersionId" name="draftVersionId" defaultValue="">
                <option value="">No draft — record only</option>
                {versions.map((version) => (
                  <option key={version.id} value={version.id}>
                    v{version.version} · {version.modelId} ·{" "}
                    {new Date(version.createdAt).toLocaleString()}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <button className="button venture-button" type="submit">
                Create version-locked export
              </button>
            </div>
            <p className="hint">
              DOCX/PDF/ZIP artifact rendering runs as a durable job in a later phase; this build
              produces the manifest and checksum.
            </p>
          </form>
        </div>

        <div className="wp-card">
          <h2>Export history ({exports.length})</h2>
          {exports.length === 0 ? (
            <p>No exports yet.</p>
          ) : (
            exports.map((entry) => (
              <details key={entry.id} style={{ marginBottom: 14 }}>
                <summary>
                  {new Date(entry.createdAt).toLocaleString()} — checksum{" "}
                  <code>{entry.checksum.slice(0, 16)}…</code>
                </summary>
                <div className="wp-draft-output" style={{ marginTop: 10 }}>
                  {JSON.stringify(entry.manifest, null, 2)}
                </div>
              </details>
            ))
          )}
        </div>
      </div>
    </>
  );
}
