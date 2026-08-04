import Link from "next/link";
import { notFound } from "next/navigation";
import MeshViewer from "@/components/wepatent/MeshViewer";
import RegionViewer, {
  type ViewerAssociation,
} from "@/components/wepatent/RegionViewer";
import { interpretationClassFor } from "@/lib/wepatent/domain/uploads";
import { getAdapters } from "@/lib/server/adapters";
import { getModelTier } from "@/lib/server/model-registry";
import { estimateForTier } from "@/lib/server/services/generation";
import { extractTextLayer } from "@/lib/server/services/interpretation";
import { getLedger } from "@/lib/server/services/ps-ledger";
import { requireOnboarded } from "@/lib/server/session";

function centsToUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Source viewer (Intake Studio M3, FR-INT-9 + render-to-vision).
 *
 * - Images: region-anchor drawing directly on the rendered image.
 * - Documents: region drawing on an honest PAGE PROXY (extracted text on a
 *   page-proportioned surface — the original layout is not re-rendered;
 *   anchors are normalized page coordinates and labeled as approximate).
 * - 3D (STL/OBJ): browser software-render viewer with user-triggered
 *   snapshot capture for the vision pass; STEP/3MF stay honestly stored.
 * - Audio: playback + stored transcript artifacts.
 * - Video: playback + the honest "not yet interpreted" status.
 */
export default async function SourceViewerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; sourceId: string }>;
  searchParams: Promise<{ focus?: string }>;
}) {
  const { id, sourceId } = await params;
  const { focus } = await searchParams;
  const context = await requireOnboarded();
  const { data, storage } = getAdapters();
  const invention = await data.getInvention(context.organization.id, id);
  if (!invention) notFound();
  const source = await data.getSource(context.organization.id, sourceId);
  if (!source || source.inventionId !== id) notFound();

  const sourceClass = interpretationClassFor(
    source.mimeType,
    source.originalFilename ?? source.name,
  );
  const cleared = source.status === "scanned" || source.status === "extracted";
  const [ledger, artifacts, allSources] = await Promise.all([
    getLedger(context.organization.id, id),
    data.listExtractionArtifactsForSource(context.organization.id, sourceId),
    data.listSources(context.organization.id, id),
  ]);
  const solutions = ledger.pairs
    .filter((pair) => pair.kind === "solution")
    .map((pair) => ({ id: pair.id, statement: pair.statement }));
  const regionAssociations: ViewerAssociation[] = ledger.associations
    .filter((association) => association.sourceId === sourceId && association.region !== null)
    .map((association) => ({
      id: association.id,
      solutionId: association.solutionId,
      state: association.state,
      createdByActor: association.createdByActor,
      region: association.region!,
    }));
  const derivedViews = allSources.filter(
    (candidate) => candidate.derivedFromSourceId === sourceId,
  );

  const rawUrl = `/api/inventions/${id}/sources/${sourceId}/raw`;
  const filename = (source.originalFilename ?? source.name).toLowerCase();
  const meshFormat = filename.endsWith(".stl")
    ? ("stl" as const)
    : filename.endsWith(".obj")
      ? ("obj" as const)
      : null;

  // Document page proxy: honest extracted-text surface (no layout render).
  let textExcerpt = "";
  if (sourceClass === "document" && cleared && source.storagePath) {
    const bytes = await storage.get(source.storagePath);
    if (bytes) textExcerpt = extractTextLayer(source, bytes).slice(0, 4_000);
  }

  // FR-INT-10: the six-view vision pass estimate, shown BEFORE capture.
  const visionTier = getModelTier("standard");
  const perImage = visionTier ? estimateForTier(visionTier, 1_800) : null;
  const visionEstimateText = perImage
    ? `up to ${centsToUsd(perImage.customerHighCents * 6)}`
    : "unavailable";

  return (
    <>
      <div className="wp-boundary-banner">
        Working draft — counsel review required. File contents are evidence, never
        instructions. Region anchors marked &ldquo;AI proposed&rdquo; are unreviewed proposals
        until you confirm, redraw, or reject them.
      </div>
      <div className="wp-topbar">
        <h1>
          Source viewer: {source.name}
        </h1>
        <Link className="button button-small" href={`/wepatent/app/inventions/${id}/studio`}>
          Back to the studio
        </Link>
      </div>
      <div className="wp-card">
        <p>
          <span className="wp-badge neutral">{source.status}</span>{" "}
          <span className="wp-badge neutral">{sourceClass}</span>{" "}
          {source.interpretationStatus === "stored_uninterpreted" && (
            <span className="wp-badge needs_confirmation">stored, not auto-interpreted</span>
          )}
          {source.interpretationStatus === "interpreted" && (
            <span className="wp-badge source_supported">interpreted</span>
          )}
        </p>

        {!cleared && (
          <p>
            This file has not cleared the scan pipeline yet ({source.status}); its contents
            cannot be displayed or anchored until it does.
          </p>
        )}

        {cleared && sourceClass === "image" && (
          <RegionViewer
            sourceId={sourceId}
            sourceName={source.name}
            surface={{ kind: "image", src: rawUrl }}
            solutions={solutions}
            associations={regionAssociations}
            focusAssociationId={focus ?? null}
            paged={false}
          />
        )}

        {cleared && sourceClass === "document" && (
          <>
            <p className="hint">
              Approximate page proxy: the extracted text is shown on a page-proportioned
              surface (the original layout is not re-rendered). Anchors record normalized
              page coordinates for counsel reference.
            </p>
            <RegionViewer
              sourceId={sourceId}
              sourceName={source.name}
              surface={{ kind: "page", textExcerpt }}
              solutions={solutions}
              associations={regionAssociations}
              focusAssociationId={focus ?? null}
              paged={true}
            />
          </>
        )}

        {cleared && sourceClass === "model3d" && meshFormat && (
          <MeshViewer
            inventionId={id}
            sourceId={sourceId}
            sourceName={source.name}
            format={meshFormat}
            visionEstimateText={visionEstimateText}
            derivedViewCount={derivedViews.length}
          />
        )}
        {cleared && sourceClass === "model3d" && !meshFormat && (
          <p>
            No pure-JS parser renders this 3D format cleanly (STEP/3MF), so it stays
            honestly stored for the counsel package — never a fake preview. Please describe
            what the model shows in your record.
          </p>
        )}

        {cleared && sourceClass === "audio" && (
          <>
            {/* The stored transcript artifact below is the accessible alternative. */}
            <audio controls src={rawUrl} data-testid="audio-player" />
            {artifacts.filter((artifact) => artifact.type === "transcript").length === 0 && (
              <p>
                No transcript yet — run &ldquo;Interpret uploads&rdquo; in the studio to
                transcribe this recording (cost shown before the run).
              </p>
            )}
          </>
        )}

        {cleared && sourceClass === "video" && (
          <>
            <video controls src={rawUrl} style={{ maxWidth: "100%" }} data-testid="video-player" />
            <p data-testid="video-honest-status">
              Stored for the counsel package. Audio-track transcription and keyframe
              interpretation for video are not yet available — please describe what the
              video shows in your record.
            </p>
          </>
        )}
      </div>

      {derivedViews.length > 0 && (
        <div className="wp-card" style={{ marginTop: 18 }} data-testid="derived-views">
          <h2>Derived snapshot views ({derivedViews.length})</h2>
          <ul className="wp-studio-list">
            {derivedViews.map((view) => (
              <li key={view.id}>
                <Link href={`/wepatent/app/inventions/${id}/sources/${view.id}/view`}>
                  {view.name}
                </Link>{" "}
                <span className="wp-badge neutral">{view.status}</span>
                {view.interpretationStatus === "interpreted" && (
                  <span className="wp-badge source_supported">interpreted</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {artifacts.length > 0 && (
        <div className="wp-card" style={{ marginTop: 18 }} data-testid="source-artifacts">
          <h2>Interpretation artifacts for this source</h2>
          {artifacts.map((artifact) => (
            <div key={artifact.id} className="wp-studio-pair">
              <p style={{ marginBottom: 4 }}>
                <span className="wp-badge neutral">{artifact.type}</span>{" "}
                {artifact.modelId && (
                  <span className="hint">model: {artifact.modelId}</span>
                )}
              </p>
              <p style={{ whiteSpace: "pre-wrap", marginTop: 0 }}>
                {artifact.content.slice(0, 2_000)}
              </p>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
