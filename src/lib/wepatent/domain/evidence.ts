/**
 * Evidence-anchor domain (Intake Studio M3, feature PRD §7, FR-INT-9).
 *
 * A region anchor is a normalized rectangle drawn on a source (document
 * page, image, or a captured 3D view): coordinates are fractions of the
 * rendered surface so they survive any display size. Pure validation and
 * formatting only — persistence goes through the association services and
 * the ps-ledger state guard (invariant 13: AI-proposed anchors stay
 * `ai_proposed` until a human confirms or redraws them).
 */

export type RegionAnchor = {
  /** 1-based page number for paged documents; null for single-surface sources. */
  page: number | null;
  /** Normalized [0,1] rectangle on the rendered surface. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Canonical 3D view id the region was drawn on (e.g. "front"); else null. */
  view: string | null;
};

export const MIN_REGION_EXTENT = 0.01; // 1% of the surface in each dimension

/** Strict parse/clamp of a candidate region. Returns null when unusable. */
export function normalizeRegion(input: unknown): RegionAnchor | null {
  if (typeof input !== "object" || input === null) return null;
  const candidate = input as Record<string, unknown>;
  const num = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;
  const x = num(candidate.x);
  const y = num(candidate.y);
  const w = num(candidate.w);
  const h = num(candidate.h);
  if (x === null || y === null || w === null || h === null) return null;
  if (w < MIN_REGION_EXTENT || h < MIN_REGION_EXTENT) return null;
  const clamp = (value: number): number => Math.min(1, Math.max(0, value));
  const cx = clamp(x);
  const cy = clamp(y);
  const cw = Math.min(clamp(w), 1 - cx);
  const ch = Math.min(clamp(h), 1 - cy);
  if (cw < MIN_REGION_EXTENT || ch < MIN_REGION_EXTENT) return null;
  const round = (value: number): number => Math.round(value * 10_000) / 10_000;
  let page: number | null = null;
  if (typeof candidate.page === "number" && Number.isInteger(candidate.page) && candidate.page >= 1) {
    page = candidate.page;
  }
  const view =
    typeof candidate.view === "string" && candidate.view.length > 0 && candidate.view.length <= 40
      ? candidate.view
      : null;
  return { page, x: round(cx), y: round(cy), w: round(cw), h: round(ch), view };
}

/** Human-readable anchor locator for exports and audit trails. */
export function formatRegionAnchor(sourceName: string, region: RegionAnchor): string {
  const location = [
    region.page !== null ? `page ${region.page}` : null,
    region.view !== null ? `view ${region.view}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const rect = `[x=${region.x.toFixed(2)}, y=${region.y.toFixed(2)}, w=${region.w.toFixed(2)}, h=${region.h.toFixed(2)}]`;
  return `region on ${sourceName}${location ? ` (${location})` : ""} at ${rect}`;
}

/**
 * Keyboard-driven region editing (a11y gate, parent §12): deterministic
 * transforms shared by the viewer component and its tests. Arrow keys nudge
 * by STEP; with the resize modifier they grow/shrink instead.
 */
export const KEYBOARD_REGION_STEP = 0.02;

export function nudgeRegion(
  region: RegionAnchor,
  direction: "up" | "down" | "left" | "right",
  mode: "move" | "resize",
  step = KEYBOARD_REGION_STEP,
): RegionAnchor {
  let { x, y, w, h } = region;
  if (mode === "move") {
    if (direction === "up") y -= step;
    if (direction === "down") y += step;
    if (direction === "left") x -= step;
    if (direction === "right") x += step;
  } else {
    if (direction === "up") h -= step;
    if (direction === "down") h += step;
    if (direction === "left") w -= step;
    if (direction === "right") w += step;
  }
  w = Math.max(MIN_REGION_EXTENT, Math.min(1, w));
  h = Math.max(MIN_REGION_EXTENT, Math.min(1, h));
  x = Math.max(0, Math.min(1 - w, x));
  y = Math.max(0, Math.min(1 - h, y));
  const round = (value: number): number => Math.round(value * 10_000) / 10_000;
  return { ...region, x: round(x), y: round(y), w: round(w), h: round(h) };
}

/** Fresh keyboard-created region: centered, quarter-size (then adjustable). */
export function initialKeyboardRegion(page: number | null, view: string | null): RegionAnchor {
  return { page, view, x: 0.375, y: 0.375, w: 0.25, h: 0.25 };
}
