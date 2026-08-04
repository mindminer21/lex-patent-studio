/**
 * Pure-JS STL parsing + deterministic geometry summary (Intake Studio M2
 * "3D pipeline hardening"). No renderer, no model call, no external
 * dependency: a clean parse yields an honest NON-MODEL interpretation
 * artifact (dimensions, triangle count, bounding box, detected mirror
 * symmetries). A file that does not parse cleanly stays
 * `stored_uninterpreted` — never a fake interpretation.
 */

export type StlGeometrySummary = {
  format: "binary" | "ascii";
  triangleCount: number;
  vertexCount: number;
  boundingBox: { min: [number, number, number]; max: [number, number, number] };
  /** Extent along x/y/z in the file's own modeling units. */
  dimensions: [number, number, number];
  /** Mirror symmetries across the bounding-box center planes. */
  detectedSymmetries: Array<"mirror_x" | "mirror_y" | "mirror_z">;
  /** True when the mesh was too large for the symmetry check (skipped). */
  symmetryCheckSkipped: boolean;
};

const MAX_TRIANGLES = 500_000;
const MAX_SYMMETRY_TRIANGLES = 100_000;

/** Parse an STL byte stream. Returns null unless the file parses CLEANLY. */
export function parseStlGeometry(bytes: Uint8Array): StlGeometrySummary | null {
  const binary = parseBinaryStl(bytes);
  if (binary) return binary;
  return parseAsciiStl(bytes);
}

/**
 * Clean-parse the raw triangle soup (M3 browser viewer): flat array of
 * vertex coordinates, 9 numbers per triangle. Same strict clean-parse
 * contract as the summary — null means "do not pretend to render this".
 */
export function parseStlVertices(
  bytes: Uint8Array,
): { format: "binary" | "ascii"; vertices: number[] } | null {
  const binary = parseBinaryStlVertices(bytes);
  if (binary) return { format: "binary", vertices: binary };
  const ascii = parseAsciiStlVertices(bytes);
  if (ascii) return { format: "ascii", vertices: ascii };
  return null;
}

function parseBinaryStlVertices(bytes: Uint8Array): number[] | null {
  if (bytes.length < 84) return null;
  // ASCII files start with "solid"; a binary header may too, so we decide
  // by the exact length contract, not the header text.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const triangleCount = view.getUint32(80, true);
  if (triangleCount === 0 || triangleCount > MAX_TRIANGLES) return null;
  const expected = 84 + triangleCount * 50;
  if (bytes.length !== expected) return null;

  const vertices: number[] = [];
  for (let index = 0; index < triangleCount; index += 1) {
    const base = 84 + index * 50 + 12; // skip the normal
    for (let vertex = 0; vertex < 3; vertex += 1) {
      const offset = base + vertex * 12;
      const x = view.getFloat32(offset, true);
      const y = view.getFloat32(offset + 4, true);
      const z = view.getFloat32(offset + 8, true);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
      vertices.push(x, y, z);
    }
  }
  return vertices;
}

function parseBinaryStl(bytes: Uint8Array): StlGeometrySummary | null {
  const vertices = parseBinaryStlVertices(bytes);
  if (!vertices) return null;
  return summarize("binary", vertices.length / 9, vertices);
}

const ASCII_VERTEX = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g;

function parseAsciiStlVertices(bytes: Uint8Array): number[] | null {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  if (!/^\s*solid\b/.test(text)) return null;
  const facetCount = (text.match(/facet\s+normal/g) ?? []).length;
  if (facetCount === 0 || facetCount > MAX_TRIANGLES) return null;

  const vertices: number[] = [];
  for (const match of text.matchAll(ASCII_VERTEX)) {
    const x = Number(match[1]);
    const y = Number(match[2]);
    const z = Number(match[3]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    vertices.push(x, y, z);
  }
  // A clean ASCII STL has exactly 3 vertices per facet.
  if (vertices.length !== facetCount * 9) return null;
  return vertices;
}

function parseAsciiStl(bytes: Uint8Array): StlGeometrySummary | null {
  const vertices = parseAsciiStlVertices(bytes);
  if (!vertices) return null;
  return summarize("ascii", vertices.length / 9, vertices);
}

function summarize(
  format: "binary" | "ascii",
  triangleCount: number,
  vertices: number[],
): StlGeometrySummary {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < vertices.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = vertices[index + axis];
      if (value < min[axis]) min[axis] = value;
      if (value > max[axis]) max[axis] = value;
    }
  }
  const dimensions: [number, number, number] = [
    max[0] - min[0],
    max[1] - min[1],
    max[2] - min[2],
  ];

  const symmetryCheckSkipped = triangleCount > MAX_SYMMETRY_TRIANGLES;
  const detectedSymmetries = symmetryCheckSkipped
    ? []
    : detectMirrorSymmetries(vertices, min, max);

  return {
    format,
    triangleCount,
    vertexCount: vertices.length / 3,
    boundingBox: { min, max },
    dimensions,
    detectedSymmetries,
    symmetryCheckSkipped,
  };
}

/**
 * Mirror-symmetry detection across the bounding-box center planes:
 * quantize the vertex multiset, reflect it per axis, and compare. This is
 * a deterministic geometric property check, not a visual interpretation.
 */
function detectMirrorSymmetries(
  vertices: number[],
  min: [number, number, number],
  max: [number, number, number],
): Array<"mirror_x" | "mirror_y" | "mirror_z"> {
  const extent = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  if (extent <= 0) return [];
  const quantum = extent / 4096;
  const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];

  const quantize = (value: number): number => Math.round(value / quantum);
  // Unique quantized vertex positions: symmetry is a property of the shape,
  // not of how a mesh happens to be triangulated (vertex multiplicity).
  const baseKeys = new Set<string>();
  for (let index = 0; index < vertices.length; index += 3) {
    baseKeys.add(
      `${quantize(vertices[index])}:${quantize(vertices[index + 1])}:${quantize(vertices[index + 2])}`,
    );
  }

  const axes: Array<"mirror_x" | "mirror_y" | "mirror_z"> = [];
  const names: Array<"mirror_x" | "mirror_y" | "mirror_z"> = ["mirror_x", "mirror_y", "mirror_z"];
  for (let axis = 0; axis < 3; axis += 1) {
    let symmetric = true;
    for (let index = 0; index < vertices.length; index += 3) {
      const coords = [vertices[index], vertices[index + 1], vertices[index + 2]];
      coords[axis] = 2 * center[axis] - coords[axis];
      const key = `${quantize(coords[0])}:${quantize(coords[1])}:${quantize(coords[2])}`;
      if (!baseKeys.has(key)) {
        symmetric = false;
        break;
      }
    }
    if (symmetric) axes.push(names[axis]);
  }
  return axes;
}

/** Human-readable artifact content for the geometry summary. */
export function formatGeometrySummary(filename: string, summary: StlGeometrySummary): string {
  const round = (value: number): string => (Math.round(value * 1000) / 1000).toString();
  const lines = [
    `Deterministic STL geometry summary for "${filename}" — computed by code, no AI model involved.`,
    `Format: ${summary.format} STL · Triangles: ${summary.triangleCount} · Vertices: ${summary.vertexCount}`,
    `Bounding box (modeling units): min [${summary.boundingBox.min.map(round).join(", ")}], max [${summary.boundingBox.max.map(round).join(", ")}]`,
    `Dimensions (x × y × z): ${summary.dimensions.map(round).join(" × ")}`,
    summary.symmetryCheckSkipped
      ? "Symmetry check: skipped (mesh too large for the deterministic check)."
      : `Detected mirror symmetries: ${
          summary.detectedSymmetries.length > 0
            ? summary.detectedSymmetries.join(", ")
            : "none detected"
        }`,
    "This is a geometric parse, not a visual interpretation. The raw file is retained for the counsel package; please describe what the model shows so counsel has the context.",
  ];
  return lines.join("\n");
}
