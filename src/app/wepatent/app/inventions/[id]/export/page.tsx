import { notFound } from "next/navigation";
import { getAdapters } from "@/lib/server/adapters";
import { mintDownloadToken } from "@/lib/server/services/export-download";
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
  const exportViews = await Promise.all(
    exports.map(async (entry) => {
      const artifacts = await data.listExportArtifacts(context.organization.id, entry.id);
      const renderJob = await data.findJobByKey(
        context.organization.id,
        "export_render",
        entry.id,
      );
      return {
        entry,
        renderJob,
        artifacts: artifacts.map((artifact) => ({
          artifact,
          href: `/api/exports/${entry.id}/artifacts/${encodeURIComponent(artifact.name)}?token=${encodeURIComponent(
            mintDownloadToken({
              organizationId: context.organization.id,
              exportId: entry.id,
              name: artifact.name,
            }),
          )}`,
        })),
      };
    }),
  );

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
              {[
                ["facts", "Facts"],
                ["contributors", "Contributors"],
                ["timeline", "Timeline"],
                ["sources", "Sources"],
                ["ps_ledger", "Problem/Solution ledger"],
                ["coverage", "Enablement coverage report"],
              ].map(([section, label]) => (
                <label className="acknowledgement" key={section}>
                  <input type="checkbox" name={`section_${section}`} defaultChecked />
                  <span>{label}</span>
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
              DOCX, PDF, and manifest artifacts render as a durable job right after the export is
              created; each artifact records its own SHA-256 checksum.
            </p>
          </form>
        </div>

        <div className="wp-card">
          <h2>Export history ({exports.length})</h2>
          {exports.length === 0 ? (
            <p>No exports yet.</p>
          ) : (
            exportViews.map(({ entry, artifacts, renderJob }) => (
              <details key={entry.id} style={{ marginBottom: 14 }} open={exports.length === 1}>
                <summary>
                  {new Date(entry.createdAt).toLocaleString()} — checksum{" "}
                  <code>{entry.checksum.slice(0, 16)}…</code>
                </summary>
                {artifacts.length > 0 ? (
                  <table className="wp-table" style={{ marginTop: 10 }}>
                    <thead>
                      <tr>
                        <th scope="col">Artifact</th>
                        <th scope="col">SHA-256</th>
                        <th scope="col"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {artifacts.map(({ artifact, href }) => (
                        <tr key={artifact.id}>
                          <td>{artifact.name}</td>
                          <td>
                            <code>{artifact.sha256.slice(0, 16)}…</code>
                          </td>
                          <td>
                            <a href={href}>Download</a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p role="status" style={{ marginTop: 10 }}>
                    Artifact rendering: {renderJob ? renderJob.status : "queued"}. Refresh to see
                    DOCX/PDF downloads.
                  </p>
                )}
                <p className="hint">Download links are short-lived and tenant-scoped.</p>
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
