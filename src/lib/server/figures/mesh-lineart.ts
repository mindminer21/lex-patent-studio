/**
 * Model-derived line art (spec §5 Stage 2, `from_uploaded_model`).
 *
 * Reuses the M2/M3 mesh pipeline: the caller parses STL/OBJ and projects a
 * canonical view (that code lives in the product's domain layer), then hands
 * the PROJECTED TRIANGLES here. This module extracts silhouette and feature
 * edges and returns pure vector primitives — no shading fills, no raster, no
 * model.
 *
 * This is the highest-fidelity path in the whole feature: the geometry is
 * the user's own, so nothing is invented and the output is exact.
 *
 * The input type is structural on purpose so this file stays product-neutral
 * and never imports from a product namespace.
 */
import type { DrawPrimitive, Point } from "./types";

export type ProjectedTriangleLike = {
  points: [number, number][];
  depth: number;
  shade: number;
};

/** Quantization used to match shared edges between adjacent triangles. */
const EDGE_PRECISION = 2;

type EdgeRecord = {
  a: [number, number];
  b: [number, number];
  count: number;
  shades: number[];
};

function edgeKey(a: [number, number], b: [number, number]): string {
  const ka = `${a[0].toFixed(EDGE_PRECISION)},${a[1].toFixed(EDGE_PRECISION)}`;
  const kb = `${b[0].toFixed(EDGE_PRECISION)},${b[1].toFixed(EDGE_PRECISION)}`;
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

function signedArea(points: [number, number][]): number {
  const [p0, p1, p2] = points;
  return (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1]);
}

/**
 * Silhouette + feature edges from a projected mesh.
 *
 * - An edge used by only ONE front-facing triangle is a silhouette edge.
 * - An edge shared by two front-facing triangles whose flat-shade values
 *   differ by more than `featureThreshold` is a feature (crease) edge.
 * - Everything else is interior tessellation and is discarded, which is what
 *   turns a triangulated mesh into a patent-style outline drawing.
 */
export function lineArtFromProjection(
  triangles: readonly ProjectedTriangleLike[],
  canvasSize: number,
  featureThreshold = 0.18,
): DrawPrimitive[] {
  const edges = new Map<string, EdgeRecord>();
  for (const triangle of triangles) {
    // Discard back faces: they are hidden by the solid body.
    if (signedArea(triangle.points) <= 0) continue;
    for (let i = 0; i < 3; i += 1) {
      const a = triangle.points[i];
      const b = triangle.points[(i + 1) % 3];
      const key = edgeKey(a, b);
      const existing = edges.get(key);
      if (existing) {
        existing.count += 1;
        existing.shades.push(triangle.shade);
      } else {
        edges.set(key, { a, b, count: 1, shades: [triangle.shade] });
      }
    }
  }

  const primitives: DrawPrimitive[] = [];
  const scale = canvasSize === 0 ? 1 : canvasSize;
  for (const edge of edges.values()) {
    const isSilhouette = edge.count === 1;
    const isFeature =
      edge.count >= 2 &&
      Math.max(...edge.shades) - Math.min(...edge.shades) > featureThreshold;
    if (!isSilhouette && !isFeature) continue;
    const points: Point[] = [
      { x: clamp01(edge.a[0] / scale), y: clamp01(edge.a[1] / scale) },
      { x: clamp01(edge.b[0] / scale), y: clamp01(edge.b[1] / scale) },
    ];
    primitives.push({ kind: "polyline", points, lineType: "solid" });
  }
  // Deterministic order so the same mesh always composes to the same bytes.
  primitives.sort((a, b) => {
    if (a.kind !== "polyline" || b.kind !== "polyline") return 0;
    return (
      a.points[0].x - b.points[0].x ||
      a.points[0].y - b.points[0].y ||
      a.points[1].x - b.points[1].x ||
      a.points[1].y - b.points[1].y
    );
  });
  return primitives;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Anchor points for reference characters on model-derived art: sample the
 * extremes of the drawn outline so lead lines reach real features rather
 * than empty space.
 */
export function anchorsFromPrimitives(primitives: readonly DrawPrimitive[], count: number): Point[] {
  const points: Point[] = [];
  for (const primitive of primitives) {
    if (primitive.kind === "polyline") points.push(...primitive.points);
  }
  if (points.length === 0 || count <= 0) return [];
  const sorted = [...points].sort((a, b) => a.y - b.y || a.x - b.x);
  const anchors: Point[] = [];
  for (let i = 0; i < count; i += 1) {
    const index = Math.min(
      sorted.length - 1,
      Math.round(((i + 0.5) / count) * (sorted.length - 1)),
    );
    anchors.push(sorted[index]);
  }
  return anchors;
}
