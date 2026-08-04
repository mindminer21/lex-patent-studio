"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  initialKeyboardRegion,
  nudgeRegion,
  type RegionAnchor,
} from "@/lib/wepatent/domain/evidence";

/**
 * Source viewer with region-anchor drawing (Intake Studio M3, FR-INT-9).
 *
 * - Mouse/touch: drag on the surface to draw a rectangle.
 * - Keyboard (a11y gate, parent §12): press "n" or Enter on the focused
 *   surface to create a centered region, arrow keys nudge it, Shift+arrows
 *   resize, then save with the labeled button. An aria-live region
 *   announces every change.
 * - AI-proposed anchors (from distillation) render as dashed amber
 *   overlays labeled "AI proposed" until confirmed, redrawn, or rejected
 *   (invariant 13); confirmed/user anchors are solid green.
 */

export type ViewerAssociation = {
  id: string;
  solutionId: string;
  state: "ai_proposed" | "user_confirmed" | "user_edited";
  createdByActor: "user" | "model";
  region: RegionAnchor;
};

export type ViewerSolution = { id: string; statement: string };

type Surface =
  | { kind: "image"; src: string }
  | { kind: "page"; textExcerpt: string };

function describeRegion(region: RegionAnchor): string {
  return `x ${(region.x * 100).toFixed(0)}%, y ${(region.y * 100).toFixed(0)}%, width ${(region.w * 100).toFixed(0)}%, height ${(region.h * 100).toFixed(0)}%${region.page ? `, page ${region.page}` : ""}`;
}

export default function RegionViewer({
  sourceId,
  sourceName,
  surface,
  solutions,
  associations,
  focusAssociationId,
  paged,
}: {
  sourceId: string;
  sourceName: string;
  surface: Surface;
  solutions: ViewerSolution[];
  associations: ViewerAssociation[];
  focusAssociationId: string | null;
  /** Paged documents record a page number with each anchor. */
  paged: boolean;
}) {
  const router = useRouter();
  const surfaceRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const [draft, setDraft] = useState<RegionAnchor | null>(null);
  const [adjustingId, setAdjustingId] = useState<string | null>(null);
  const [adjustRegion, setAdjustRegion] = useState<RegionAnchor | null>(null);
  const [selectedSolution, setSelectedSolution] = useState(solutions[0]?.id ?? "");
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const focusAssociation = useMemo(
    () => associations.find((association) => association.id === focusAssociationId) ?? null,
    [associations, focusAssociationId],
  );

  function relativePoint(event: React.PointerEvent): { x: number; y: number } | null {
    const bounds = surfaceRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width === 0 || bounds.height === 0) return null;
    return {
      x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
      y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
    };
  }

  function onPointerDown(event: React.PointerEvent): void {
    if (adjustingId) return;
    const point = relativePoint(event);
    if (!point) return;
    dragStart.current = point;
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent): void {
    if (!dragStart.current) return;
    const point = relativePoint(event);
    if (!point) return;
    const x = Math.min(dragStart.current.x, point.x);
    const y = Math.min(dragStart.current.y, point.y);
    const w = Math.abs(point.x - dragStart.current.x);
    const h = Math.abs(point.y - dragStart.current.y);
    if (w >= 0.01 && h >= 0.01) {
      setDraft({ page: paged ? page : null, view: null, x, y, w, h });
    }
  }

  function onPointerUp(): void {
    if (dragStart.current && draft) {
      setStatus(`Region drawn at ${describeRegion(draft)}. Choose a solution and save.`);
    }
    dragStart.current = null;
  }

  function activeRegion(): RegionAnchor | null {
    return adjustingId ? adjustRegion : draft;
  }

  function setActiveRegion(region: RegionAnchor): void {
    if (adjustingId) setAdjustRegion(region);
    else setDraft(region);
    setStatus(
      `${adjustingId ? "Anchor adjusted to" : "Region at"} ${describeRegion(region)}.`,
    );
  }

  function onKeyDown(event: React.KeyboardEvent): void {
    const directionByKey: Record<string, "up" | "down" | "left" | "right"> = {
      ArrowUp: "up",
      ArrowDown: "down",
      ArrowLeft: "left",
      ArrowRight: "right",
    };
    if (event.key === "n" || (event.key === "Enter" && !activeRegion())) {
      event.preventDefault();
      const region = initialKeyboardRegion(paged ? page : null, null);
      setActiveRegion(region);
      setStatus(
        `Region created at ${describeRegion(region)}. Arrow keys move it; Shift+arrows resize; then save with the button.`,
      );
      return;
    }
    if (event.key === "Escape" && activeRegion()) {
      event.preventDefault();
      if (adjustingId) {
        setAdjustingId(null);
        setAdjustRegion(null);
      } else {
        setDraft(null);
      }
      setStatus("Region editing cancelled.");
      return;
    }
    const direction = directionByKey[event.key];
    const region = activeRegion();
    if (direction && region) {
      event.preventDefault();
      setActiveRegion(nudgeRegion(region, direction, event.shiftKey ? "resize" : "move"));
    }
  }

  async function saveDraft(): Promise<void> {
    if (!draft || !selectedSolution) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/ps-pairs/${selectedSolution}/associations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId, region: draft }),
      });
      if (!response.ok) {
        setStatus("Saving the region failed. Please try again.");
        return;
      }
      setDraft(null);
      setStatus("Region anchor saved and linked to the solution.");
      router.refresh();
    } catch {
      setStatus("Network error while saving the region.");
    } finally {
      setBusy(false);
    }
  }

  async function saveAdjustment(): Promise<void> {
    if (!adjustingId || !adjustRegion) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/associations/${adjustingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "redraw", region: adjustRegion }),
      });
      if (!response.ok) {
        setStatus("Adjusting the anchor failed. Please try again.");
        return;
      }
      setAdjustingId(null);
      setAdjustRegion(null);
      setStatus("Anchor adjusted — recorded as your edit.");
      router.refresh();
    } catch {
      setStatus("Network error while adjusting the anchor.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmAnchor(associationId: string): Promise<void> {
    setBusy(true);
    try {
      const response = await fetch(`/api/associations/${associationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm" }),
      });
      setStatus(response.ok ? "Anchor confirmed." : "Confirming the anchor failed.");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function removeAnchor(associationId: string, state: string): Promise<void> {
    setBusy(true);
    try {
      const response = await fetch(`/api/associations/${associationId}`, { method: "DELETE" });
      setStatus(
        response.ok
          ? state === "ai_proposed"
            ? "AI-proposed anchor rejected (recorded as a rejection signal)."
            : "Anchor removed."
          : "Removing the anchor failed.",
      );
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const solutionLabel = (solutionId: string): string => {
    const solution = solutions.find((candidate) => candidate.id === solutionId);
    return solution ? solution.statement.slice(0, 60) : solutionId;
  };

  const boxStyle = (region: RegionAnchor): React.CSSProperties => ({
    left: `${region.x * 100}%`,
    top: `${region.y * 100}%`,
    width: `${region.w * 100}%`,
    height: `${region.h * 100}%`,
  });

  return (
    <div>
      <p className="hint" id="region-viewer-instructions">
        Draw a rectangle with the mouse, or focus the surface and press{" "}
        <kbd>n</kbd> (or Enter) to create a region, arrow keys to move it,
        Shift+arrows to resize, Escape to cancel. Dashed amber anchors are AI
        proposals awaiting your review; solid green anchors are yours.
      </p>
      {paged && (
        <div className="field" style={{ maxWidth: 220 }}>
          <label htmlFor="viewer-page">Page number for new anchors</label>
          <input
            id="viewer-page"
            type="number"
            min={1}
            max={999}
            value={page}
            onChange={(event) => setPage(Math.max(1, Number(event.target.value) || 1))}
          />
        </div>
      )}
      <div
        ref={surfaceRef}
        className="wp-region-surface"
        role="application"
        aria-label={`Region drawing surface for ${sourceName}. Press n to create a region; arrow keys move; Shift plus arrow keys resize; Escape cancels.`}
        aria-describedby="region-viewer-instructions"
        tabIndex={0}
        data-testid="region-surface"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onKeyDown={onKeyDown}
      >
        {surface.kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={surface.src} alt={`Uploaded source ${sourceName}`} />
        ) : (
          <div className="wp-page-proxy" data-testid="page-proxy">
            {surface.textExcerpt ||
              "No extracted text available. This proxy stands in for the page surface; anchors use normalized coordinates."}
          </div>
        )}
        {associations.map((association) => (
          <div
            key={association.id}
            className={`wp-region-box ${association.state === "ai_proposed" ? "ai_proposed" : ""} ${
              association.id === focusAssociationId ? "focused" : ""
            }`}
            style={boxStyle(
              association.id === adjustingId && adjustRegion
                ? adjustRegion
                : association.region,
            )}
            data-testid={`region-box-${association.id}`}
            data-state={association.state}
          >
            <span className="wp-region-tag">
              {association.state === "ai_proposed" ? "AI proposed" : "Confirmed"}
            </span>
          </div>
        ))}
        {draft && (
          <div className="wp-region-box draft" style={boxStyle(draft)} data-testid="region-draft">
            <span className="wp-region-tag">New region</span>
          </div>
        )}
      </div>
      <p role="status" aria-live="polite" className="hint" data-testid="region-status">
        {status}
      </p>

      {draft && (
        <div className="wp-card" style={{ marginTop: 12 }} data-testid="save-region-panel">
          <h3>Link this region to a solution</h3>
          {solutions.length === 0 ? (
            <p>
              No solutions exist yet — distill or add a solution in the studio first, then draw
              the region.
            </p>
          ) : (
            <div className="wp-form">
              <div className="field">
                <label htmlFor="region-solution">Solution</label>
                <select
                  id="region-solution"
                  value={selectedSolution}
                  onChange={(event) => setSelectedSolution(event.target.value)}
                >
                  {solutions.map((solution) => (
                    <option key={solution.id} value={solution.id}>
                      {solution.statement.slice(0, 90)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="wp-actions">
                <button
                  className="button venture-button button-small"
                  type="button"
                  disabled={busy || !selectedSolution}
                  onClick={() => void saveDraft()}
                  data-testid="save-region"
                >
                  Save region anchor
                </button>
                <button
                  className="button button-small"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setDraft(null);
                    setStatus("Region discarded.");
                  }}
                >
                  Discard
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="wp-card" style={{ marginTop: 12 }} data-testid="anchor-list">
        <h3>Region anchors on this source ({associations.length})</h3>
        {focusAssociation && (
          <p className="hint">
            Opened at anchor: {describeRegion(focusAssociation.region)} (highlighted).
          </p>
        )}
        {associations.length === 0 && <p>None yet — draw the first one above.</p>}
        <ul className="wp-studio-list">
          {associations.map((association) => (
            <li key={association.id}>
              <span
                className={`wp-badge ${association.state === "ai_proposed" ? "needs_confirmation" : "source_supported"}`}
              >
                {association.state === "ai_proposed" ? "AI proposed" : association.state}
              </span>{" "}
              {describeRegion(association.region)} → {solutionLabel(association.solutionId)}
              <span className="wp-actions" style={{ marginTop: 6 }}>
                {association.state === "ai_proposed" && (
                  <button
                    className="button button-small"
                    type="button"
                    disabled={busy}
                    onClick={() => void confirmAnchor(association.id)}
                  >
                    Confirm anchor
                  </button>
                )}
                {adjustingId === association.id ? (
                  <>
                    <button
                      className="button venture-button button-small"
                      type="button"
                      disabled={busy}
                      onClick={() => void saveAdjustment()}
                      data-testid="save-adjustment"
                    >
                      Save adjustment
                    </button>
                    <button
                      className="button button-small"
                      type="button"
                      onClick={() => {
                        setAdjustingId(null);
                        setAdjustRegion(null);
                        setStatus("Adjustment cancelled.");
                      }}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    className="button button-small"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setAdjustingId(association.id);
                      setAdjustRegion(association.region);
                      setDraft(null);
                      setStatus(
                        "Adjust mode: focus the surface, then arrow keys move the anchor and Shift+arrows resize it.",
                      );
                      surfaceRef.current?.focus();
                    }}
                  >
                    Adjust
                  </button>
                )}
                <button
                  className="button button-small"
                  type="button"
                  disabled={busy}
                  onClick={() => void removeAnchor(association.id, association.state)}
                >
                  {association.state === "ai_proposed" ? "Reject" : "Remove"}
                </button>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
