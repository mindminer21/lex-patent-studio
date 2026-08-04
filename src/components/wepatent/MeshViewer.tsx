"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CANONICAL_VIEWS,
  parseObjMesh,
  parseStlMesh,
  renderMeshView,
  type MeshData,
} from "@/lib/wepatent/domain/mesh";

/**
 * Browser 3D viewer + snapshot capture (Intake Studio M3 render-to-vision).
 *
 * Serverless-compatible by construction: the mesh renders IN THE BROWSER
 * with a deterministic Canvas-2D software projector (no WebGL, no GPU, no
 * server renderer). "Generate views for AI interpretation" is user-
 * triggered with the cost estimate shown FIRST (FR-INT-10); it captures
 * the six canonical views as PNGs and uploads them as derived image
 * sources (linked to this parent 3D source) through the unchanged FR-4
 * pipeline — they then flow through the EXISTING image-interpretation
 * pass from the studio.
 */

const CANVAS_SIZE = 512;

export default function MeshViewer({
  inventionId,
  sourceId,
  sourceName,
  format,
  visionEstimateText,
  derivedViewCount,
}: {
  inventionId: string;
  sourceId: string;
  sourceName: string;
  format: "stl" | "obj";
  /** Server-computed estimate for the six-image vision pass (FR-INT-10). */
  visionEstimateText: string;
  derivedViewCount: number;
}) {
  const router = useRouter();
  const canvasRefs = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const [mesh, setMesh] = useState<MeshData | null>(null);
  const [parseFailed, setParseFailed] = useState(false);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/inventions/${inventionId}/sources/${sourceId}/raw`);
        if (!response.ok) {
          if (!cancelled) setParseFailed(true);
          return;
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        const parsed =
          format === "stl"
            ? parseStlMesh(bytes)
            : parseObjMesh(new TextDecoder("utf-8", { fatal: false }).decode(bytes));
        if (cancelled) return;
        if (!parsed) {
          setParseFailed(true);
          return;
        }
        setMesh(parsed);
      } catch {
        if (!cancelled) setParseFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inventionId, sourceId, format]);

  const renderAll = useCallback(() => {
    if (!mesh) return;
    for (const view of CANONICAL_VIEWS) {
      const canvas = canvasRefs.current.get(view.id);
      const context = canvas?.getContext("2d");
      if (canvas && context) {
        renderMeshView(context, mesh, view, CANVAS_SIZE);
      }
    }
  }, [mesh]);

  useEffect(() => {
    renderAll();
  }, [renderAll]);

  async function generateViews(): Promise<void> {
    if (!mesh) return;
    setBusy(true);
    setStatus("Capturing views…");
    try {
      let uploaded = 0;
      for (const view of CANONICAL_VIEWS) {
        const canvas = canvasRefs.current.get(view.id);
        if (!canvas) continue;
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob((value) => resolve(value), "image/png"),
        );
        if (!blob) continue;
        const filename = `${sourceName.replace(/\.[^.]+$/, "")}-view-${view.id}.png`;
        const signResponse = await fetch(`/api/inventions/${inventionId}/uploads/sign`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename,
            mimeType: "image/png",
            declaredBytes: blob.size,
            kind: "image",
            note: `Derived 3D snapshot (${view.label} view) of ${sourceName}, captured in the browser for AI interpretation.`,
            derivedFromSourceId: sourceId,
          }),
        });
        const signBody = (await signResponse.json()) as { uploadUrl?: string };
        if (!signResponse.ok || !signBody.uploadUrl) continue;
        const putResponse = await fetch(signBody.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": "image/png" },
          body: blob,
        });
        if (putResponse.ok) uploaded += 1;
      }
      setStatus(
        uploaded > 0
          ? `${uploaded} snapshot view(s) uploaded as derived image sources (linked to this 3D model) and queued through the validated upload pipeline. Run "Interpret uploads" in the studio to start the vision pass — the cost is shown there before anything runs.`
          : "No views could be uploaded. Please try again.",
      );
      router.refresh();
    } catch {
      setStatus("Capturing or uploading the views failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (parseFailed) {
    return (
      <p data-testid="mesh-parse-failed">
        This 3D file did not parse cleanly in the browser viewer, so nothing is rendered
        (never a fake preview). The raw file remains stored for the counsel package —
        please describe what it shows in your record.
      </p>
    );
  }

  return (
    <div data-testid="mesh-viewer">
      {mesh ? (
        <p>
          Parsed {mesh.triangleCount.toLocaleString()} triangles ({format.toUpperCase()}).
          Rendered in your browser with a deterministic software projector — no upload
          happens until you choose to generate views.
        </p>
      ) : (
        <p>Loading and parsing the model…</p>
      )}
      <div className="wp-mesh-views" data-testid="mesh-views">
        {CANONICAL_VIEWS.map((view) => (
          <figure key={view.id}>
            <canvas
              width={CANVAS_SIZE}
              height={CANVAS_SIZE}
              data-testid={`mesh-canvas-${view.id}`}
              ref={(element) => {
                if (element) canvasRefs.current.set(view.id, element);
              }}
            />
            <figcaption>{view.label}</figcaption>
          </figure>
        ))}
      </div>
      <div className="wp-card" style={{ marginTop: 12 }}>
        <h3>Generate views for AI interpretation</h3>
        <p>
          Captures the six canonical views above as PNG snapshots and uploads them as
          derived image sources linked to this 3D model. Each snapshot passes the same
          validated upload pipeline as any file. The vision interpretation pass is a
          separate, user-triggered step in the studio; estimated cost for interpreting all
          six views: <strong data-testid="vision-estimate">{visionEstimateText}</strong>{" "}
          (provider cost × 1.50, settled from actual usage).
        </p>
        {derivedViewCount > 0 && (
          <p className="hint" data-testid="derived-count">
            {derivedViewCount} derived view(s) already exist for this model.
          </p>
        )}
        <button
          className="button venture-button"
          type="button"
          disabled={busy || !mesh}
          onClick={() => void generateViews()}
          data-testid="generate-views"
        >
          {busy ? "Capturing…" : "Generate views for AI interpretation"}
        </button>
        {status && (
          <p role="status" aria-live="polite" data-testid="views-status">
            {status}
          </p>
        )}
      </div>
    </div>
  );
}
