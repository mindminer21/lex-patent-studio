import { getAdapters } from "@/lib/adapters";
import { can } from "@/lib/domain/roles";
import { UploadSignForm } from "./UploadSignForm";

const STATE_LABELS: Record<string, string> = {
  uploaded: "Uploaded — awaiting scan",
  scanning: "Malware scan in progress",
  quarantined: "Quarantined — not retrievable",
  extracting: "Extraction in progress",
  extracted: "Extracted — retrievable",
  failed: "Extraction failed",
};

/** §8.2 /sources — uploads, patents, authorities, extraction state. */
export default async function SourcesPage({
  params,
}: {
  params: Promise<{ matterId: string }>;
}) {
  const { matterId } = await params;
  const adapters = getAdapters();
  const session = await adapters.auth.getSession();
  if (!session) return null;

  const sources = await adapters.data.listSources(session.organizationId, matterId);
  const canUpload = can(session.role, "sources.upload");

  return (
    <div className="max-w-[900px]">
      <h2 className="m-0 mb-1 text-lg font-medium" style={{ fontFamily: "Georgia, serif" }}>
        Sources
      </h2>
      <p className="mt-0 mb-4 text-[0.85rem] text-[var(--muted)]">
        Matter-private uploads and references. Retrieval for this matter uses
        only this matter&apos;s index — no code path searches, cites, or learns
        from another matter or tenant.
      </p>

      {sources.length === 0 ? (
        <p className="border border-dashed border-[var(--line)] bg-[var(--white)] p-4 text-[0.85rem] text-[var(--muted)]">
          No sources uploaded yet.
        </p>
      ) : (
        <ul className="m-0 list-none space-y-3 p-0">
          {sources.map((src) => (
            <li key={src.id} className="border border-[var(--line)] bg-[var(--white)] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <strong className="text-[0.9rem]">{src.title}</strong>
                <span
                  className={`ml-auto inline-flex items-center border px-1.5 py-0.5 text-[0.66rem] font-bold uppercase tracking-[0.08em] ${
                    src.extractionState === "extracted"
                      ? "border-[#5f7d4f] bg-[#e2eecd] text-[#2f4a16]"
                      : src.extractionState === "quarantined" ||
                          src.extractionState === "failed"
                        ? "border-[#a05252] bg-[#f6dcdc] text-[#7c1f1f]"
                        : "border-[#7d94ad] bg-[#e2ebf3] text-[#2c4763]"
                  }`}
                >
                  {STATE_LABELS[src.extractionState] ?? src.extractionState}
                </span>
              </div>
              <p className="mb-0 mt-1 text-[0.75rem] text-[var(--muted)]">
                {src.kind.replaceAll("_", " ")}
                {src.fileName ? ` · ${src.fileName}` : ""}
                {src.pageCount ? ` · ${src.pageCount} pp.` : ""} · uploaded by{" "}
                {src.uploadedBy} ·{" "}
                {src.createdAt.slice(0, 10)}
              </p>
            </li>
          ))}
        </ul>
      )}

      {canUpload && (
        <div className="mt-5">
          <UploadSignForm matterId={matterId} />
        </div>
      )}
    </div>
  );
}
