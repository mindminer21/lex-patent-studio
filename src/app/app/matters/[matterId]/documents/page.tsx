import { getAdapters } from "@/lib/adapters";
import {
  DraftWatermark,
  TierBadge,
  VerificationBadge,
} from "@/components/workspace/badges";
import { can } from "@/lib/domain/roles";
import { ExportButton } from "./ExportButton";
import { ThreePassSection } from "./ThreePassSection";
import { evaluateLexDelivery } from "@/lib/domain/lex-draft-passes";
import { canInvokeWorkflow } from "@/lib/domain/roles";
import { effectiveTier } from "@/lib/domain/tiers";

/** §8.2 /documents — generated versions, exports, manifests. */
export default async function DocumentsPage({
  params,
}: {
  params: Promise<{ matterId: string }>;
}) {
  const { matterId } = await params;
  const adapters = getAdapters();
  const session = await adapters.auth.getSession();
  if (!session) return null;
  const org = session.organizationId;

  const [documents, exports] = await Promise.all([
    adapters.data.listDocuments(org, matterId),
    adapters.data.listExports(org, matterId),
  ]);
  const exportsByDoc = new Map<string, typeof exports>();
  for (const record of exports) {
    const list = exportsByDoc.get(record.documentId) ?? [];
    list.push(record);
    exportsByDoc.set(record.documentId, list);
  }
  const canExport = can(session.role, "export.draft");

  /**
   * The three-pass view. The blockers come from the SHARED delivery gate, so
   * what a practitioner is told here is byte-identical to what the export
   * path enforces.
   */
  const draftSets = await adapters.data.listDraftSets(org, matterId);
  const latestSet = draftSets[draftSets.length - 1] ?? null;
  const figuresInBrief = latestSet?.illustrationsBrief?.figures ?? [];
  const decision = latestSet
    ? evaluateLexDelivery(latestSet, {
        ready: figuresInBrief.filter((figure) => !figure.needsInput).length,
        unresolved: figuresInBrief.filter((figure) => figure.needsInput).length,
      })
    : null;

  return (
    <div className="max-w-[1000px]">
      <h2 className="m-0 mb-1 text-lg font-medium" style={{ fontFamily: "Georgia, serif" }}>
        Documents
      </h2>
      <p className="mt-0 mb-4 text-[0.85rem] text-[var(--muted)]">
        Generated versions with export manifests. Manifests are
        version-locked with SHA-256 checksums; later edits create new
        versions and never mutate an exported artifact.
      </p>

      <ThreePassSection
        matterId={matterId}
        set={latestSet}
        blockers={decision && !decision.allowed ? decision.blockers : []}
        canDraft={canInvokeWorkflow(session.role, effectiveTier("section_draft"))}
        canAccept={can(session.role, "review.decide.tierB")}
      />

      {documents.length === 0 ? (
        <p className="border border-dashed border-[var(--line)] bg-[var(--white)] p-4 text-[0.85rem] text-[var(--muted)]">
          No work product yet.
        </p>
      ) : (
        <div className="space-y-4">
          {documents.map((doc) => {
            const docExports = exportsByDoc.get(doc.id) ?? [];
            return (
              <article key={doc.id} className="border border-[var(--line)] bg-[var(--white)]">
                <header className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-4 py-2.5">
                  <DraftWatermark reviewState={doc.reviewState} />
                  <TierBadge tier={doc.tier} compact />
                  <VerificationBadge state={doc.verificationState} />
                  <span className="ml-auto text-[0.7rem] text-[var(--muted)]">
                    v{doc.version} · hash {doc.versionHash}
                  </span>
                </header>
                <div className="px-4 py-3">
                  <h3 className="m-0 text-[1.05rem] font-medium" style={{ fontFamily: "Georgia, serif" }}>
                    {doc.title}
                  </h3>
                  <p className="mb-2 mt-0.5 text-[0.75rem] text-[var(--muted)]">
                    {doc.deliverableType} · {doc.modelId} · {doc.corpusRelease}
                    {doc.actualChargeUsd != null &&
                      ` · actual $${doc.actualChargeUsd.toFixed(2)}`}
                  </p>
                  {canExport && <ExportButton documentId={doc.id} />}

                  {docExports.length > 0 && (
                    <div className="mt-3 border-t border-[var(--line)] pt-2">
                      <h4 className="m-0 text-[0.68rem] font-bold uppercase tracking-[0.13em] text-[var(--muted)]">
                        Exports (immutable)
                      </h4>
                      <ul className="m-0 mt-1.5 list-none space-y-2 p-0">
                        {docExports.map((record) => (
                          <li key={record.id} className="text-[0.75rem] leading-relaxed">
                            <a
                              href={`/api/exports/${record.id}`}
                              className="font-bold underline underline-offset-4"
                            >
                              {record.fileName}
                            </a>{" "}
                            ·{" "}
                            <a
                              href={`/api/exports/${record.id}?format=pdf`}
                              className="font-bold underline underline-offset-4"
                            >
                              PDF
                            </a>{" "}
                            — v{record.documentVersion} ·{" "}
                            {record.manifest.watermark
                              ? `watermarked "${record.manifest.watermark}"`
                              : "approved export (no watermark)"}
                            <span className="block break-all text-[var(--muted)]">
                              docx sha256 {record.docxSha256} · pdf sha256{" "}
                              {record.pdfSha256} · manifest locks doc hash{" "}
                              {record.manifest.documentVersionHash} ·{" "}
                              {record.manifest.approvals.length} approval record(s) ·{" "}
                              {record.createdAt.slice(0, 16).replace("T", " ")}Z
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
