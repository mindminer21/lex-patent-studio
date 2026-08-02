import { notFound } from "next/navigation";
import UploadForm from "@/components/wepatent/UploadForm";
import { getAdapters } from "@/lib/server/adapters";
import { requireOnboarded } from "@/lib/server/session";
import { addSourceAction } from "../actions";

const SOURCE_KINDS = [
  "lab_notebook",
  "design_doc",
  "code",
  "presentation",
  "data",
  "image",
  "other",
];

export default async function SourcesPage({
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
  const sources = await data.listSources(context.organization.id, id);

  return (
    <>
      <div className="wp-boundary-banner">
        Uploads are validated against a type allowlist with extension, size, and content-signature
        checks, then quarantined and scanned before extraction (FR-4). Do not upload confidential
        third-party or export-controlled material.
      </div>
      {error && (
        <p className="form-error" role="alert">
          Could not register that source. Check the fields and try again.
        </p>
      )}
      <div className="wp-card">
        <h2>Sources ({sources.length})</h2>
        <table className="wp-table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Kind</th>
              <th scope="col">Pipeline status</th>
              <th scope="col">Checksum</th>
              <th scope="col">Note</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((source) => (
              <tr key={source.id}>
                <td>
                  {source.name}{" "}
                  {source.synthetic && <span className="wp-badge synthetic">synthetic</span>}
                </td>
                <td>{source.kind.replace(/_/g, " ")}</td>
                <td>
                  <span className="wp-badge neutral">{source.status}</span>
                  {source.status === "rejected" && source.quarantineReason && (
                    <span className="hint" style={{ display: "block" }}>
                      {source.quarantineReason}
                    </span>
                  )}
                </td>
                <td>
                  {source.checksumSha256 ? (
                    <code>{source.checksumSha256.slice(0, 12)}…</code>
                  ) : (
                    "—"
                  )}
                </td>
                <td>{source.note || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="consent-legal">
          Only extracted sources contribute support status to facts and drafts. Instructions inside
          uploaded documents are treated as untrusted content, never as commands.
        </p>
      </div>

      <div className="wp-card" style={{ marginTop: 22, maxWidth: 760 }}>
        <h2>Upload a source document</h2>
        <UploadForm inventionId={id} />
      </div>

      <div className="wp-card" style={{ marginTop: 22, maxWidth: 760 }}>
        <h2>Register a source (metadata only)</h2>
        <form action={addSourceAction} className="wp-form">
          <input type="hidden" name="inventionId" value={id} />
          <div className="field">
            <label htmlFor="source-name">Name</label>
            <input id="source-name" name="name" required maxLength={400} />
          </div>
          <div className="field">
            <label htmlFor="source-kind">Kind</label>
            <select id="source-kind" name="kind" required defaultValue="design_doc">
              {SOURCE_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="source-note">Note (optional)</label>
            <input id="source-note" name="note" maxLength={1000} />
          </div>
          <div>
            <button className="button venture-button" type="submit">
              Register source metadata
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
