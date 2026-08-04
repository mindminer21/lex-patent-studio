import { parseStlVertices } from "./stl";

/**
 * 3D mesh viewing math (Intake Studio M3 render-to-vision, feature PRD
 * §5.1 3D row + M3 scope).
 *
 * Serverless/deployment posture: rendering happens in the BROWSER on a
 * plain Canvas 2D surface via a deterministic software projector — no
 * WebGL, no GPU, no three.js dependency, no server render worker. This
 * module is pure TypeScript shared by the client viewer component and the
 * unit tests (view matrices, projection, painter ordering, flat shading
 * are all verified without a browser).
 *
 * Snapshot views captured from this projector are uploaded as ordinary
 * image sources (derived from the parent 3D source) and flow through the
 * EXISTING image-interpretation pipeline — user-triggered, cost shown
 * before the vision pass (FR-INT-10).
 */

export type MeshData = {
  /** Flat triangle soup: 9 numbers per triangle (x,y,z × 3 vertices). */
  vertices: number[];
  triangleCount: number;
};

/** Parse STL bytes (binary or ASCII) into a renderable mesh; null = honest no. */
export function parseStlMesh(bytes: Uint8Array): MeshData | null {
  const parsed = parseStlVertices(bytes);
  if (!parsed) return null;
  return { vertices: parsed.vertices, triangleCount: parsed.vertices.length / 9 };
}

const MAX_OBJ_TRIANGLES = 500_000;

/**
 * Pure-JS Wavefront OBJ parse (M3: "extend the viewer only if a pure-JS
 * parser lands cleanly" — OBJ is line-oriented plain text, so it does).
 * Supports v/f statements; polygon faces are fan-triangulated; negative
 * indices resolve relative to the current vertex count. Anything
 * structurally broken returns null — never a fake render.
 */
export function parseObjMesh(text: string): MeshData | null {
  const positions: number[] = [];
  const triangles: number[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    if (parts[0] === "v") {
      if (parts.length < 4) return null;
      const x = Number(parts[1]);
      const y = Number(parts[2]);
      const z = Number(parts[3]);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
      positions.push(x, y, z);
    } else if (parts[0] === "f") {
      if (parts.length < 4) return null;
      const indices: number[] = [];
      for (const token of parts.slice(1)) {
        const vertexRef = token.split("/")[0];
        const raw = Number(vertexRef);
        if (!Number.isInteger(raw) || raw === 0) return null;
        const index = raw > 0 ? raw - 1 : positions.length / 3 + raw;
        if (index < 0 || index >= positions.length / 3) return null;
        indices.push(index);
      }
      for (let i = 1; i + 1 < indices.length; i += 1) {
        for (const vertexIndex of [indices[0], indices[i], indices[i + 1]]) {
          triangles.push(
            positions[vertexIndex * 3],
            positions[vertexIndex * 3 + 1],
            positions[vertexIndex * 3 + 2],
          );
        }
      }
      if (triangles.length / 9 > MAX_OBJ_TRIANGLES) return null;
    }
  }
  if (triangles.length === 0) return null;
  return { vertices: triangles, triangleCount: triangles.length / 9 };
}

/**
 * Canonical snapshot views (feature PRD §5.1: "multi-angle 2D views").
 * Yaw rotates about the model's vertical (z) axis; pitch tilts toward the
 * camera. Six views bound the interpretation cost and cover the geometry.
 */
export type CanonicalView = { id: string; label: string; yawDeg: number; pitchDeg: number };

export const CANONICAL_VIEWS: readonly CanonicalView[] = [
  { id: "front", label: "Front", yawDeg: 0, pitchDeg: 0 },
  { id: "back", label: "Back", yawDeg: 180, pitchDeg: 0 },
  { id: "left", label: "Left", yawDeg: 90, pitchDeg: 0 },
  { id: "right", label: "Right", yawDeg: -90, pitchDeg: 0 },
  { id: "top", label: "Top", yawDeg: 0, pitchDeg: -90 },
  { id: "isometric", label: "Isometric", yawDeg: 45, pitchDeg: -35 },
] as const;

export type ProjectedTriangle = {
  /** Canvas-space vertex coordinates, 3 × [x, y]. */
  points: [number, number][];
  /** Mean camera-space depth (larger = nearer the camera). */
  depth: number;
  /** Flat-shading intensity in [0.25, 1]. */
  shade: number;
};

/** Rotate a point by view yaw (about z) then pitch (about x). */
export function rotateForView(
  point: [number, number, number],
  view: CanonicalView,
): [number, number, number] {
  const yaw = (view.yawDeg * Math.PI) / 180;
  const pitch = (view.pitchDeg * Math.PI) / 180;
  const [x0, y0, z0] = point;
  // Yaw about the z (vertical modeling) axis.
  const x1 = x0 * Math.cos(yaw) - y0 * Math.sin(yaw);
  const y1 = x0 * Math.sin(yaw) + y0 * Math.cos(yaw);
  const z1 = z0;
  // Pitch about the x axis.
  const y2 = y1 * Math.cos(pitch) - z1 * Math.sin(pitch);
  const z2 = y1 * Math.sin(pitch) + z1 * Math.cos(pitch);
  return [x1, y2, z2];
}

/**
 * Deterministic orthographic projection of a mesh for one canonical view:
 * rotate, fit to the canvas with a margin, flat-shade by triangle normal,
 * and painter-sort back-to-front. Same input → identical output.
 */
export function projectMesh(
  mesh: MeshData,
  view: CanonicalView,
  canvasSize: number,
  marginFraction = 0.1,
): ProjectedTriangle[] {
  const rotated: number[] = new Array(mesh.vertices.length);
  for (let i = 0; i < mesh.vertices.length; i += 3) {
    const [x, y, z] = rotateForView(
      [mesh.vertices[i], mesh.vertices[i + 1], mesh.vertices[i + 2]],
      view,
    );
    rotated[i] = x;
    rotated[i + 1] = y;
    rotated[i + 2] = z;
  }

  // Screen plane: x → right, z → up; y is the camera axis (toward viewer
  // negative). Fit the rotated bounding box into the canvas.
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < rotated.length; i += 3) {
    if (rotated[i] < minX) minX = rotated[i];
    if (rotated[i] > maxX) maxX = rotated[i];
    if (rotated[i + 2] < minZ) minZ = rotated[i + 2];
    if (rotated[i + 2] > maxZ) maxZ = rotated[i + 2];
  }
  const extent = Math.max(maxX - minX, maxZ - minZ);
  const usable = canvasSize * (1 - 2 * marginFraction);
  const scale = extent > 0 ? usable / extent : 1;
  const offsetX = (canvasSize - (maxX - minX) * scale) / 2;
  const offsetZ = (canvasSize - (maxZ - minZ) * scale) / 2;

  const light: [number, number, number] = normalize3([0.4, -1, 0.6]);
  const projected: ProjectedTriangle[] = [];
  for (let t = 0; t < rotated.length; t += 9) {
    const points: [number, number][] = [];
    let depth = 0;
    for (let v = 0; v < 3; v += 1) {
      const x = rotated[t + v * 3];
      const y = rotated[t + v * 3 + 1];
      const z = rotated[t + v * 3 + 2];
      points.push([
        offsetX + (x - minX) * scale,
        canvasSize - (offsetZ + (z - minZ) * scale), // canvas y grows downward
      ]);
      depth += -y / 3; // camera looks along +y; nearer = smaller y
    }
    const normal = triangleNormal(
      [rotated[t], rotated[t + 1], rotated[t + 2]],
      [rotated[t + 3], rotated[t + 4], rotated[t + 5]],
      [rotated[t + 6], rotated[t + 7], rotated[t + 8]],
    );
    const lambert = Math.abs(
      normal[0] * light[0] + normal[1] * light[1] + normal[2] * light[2],
    );
    projected.push({
      points,
      depth,
      shade: Math.round((0.25 + 0.75 * Math.min(1, lambert)) * 1000) / 1000,
    });
  }
  // Painter's algorithm: draw far triangles first.
  projected.sort((a, b) => a.depth - b.depth);
  return projected;
}

function triangleNormal(
  a: [number, number, number],
  b: [number, number, number],
  c: [number, number, number],
): [number, number, number] {
  const u: [number, number, number] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v: [number, number, number] = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return normalize3([
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ]);
}

function normalize3(v: [number, number, number]): [number, number, number] {
  const length = Math.hypot(v[0], v[1], v[2]);
  if (length === 0) return [0, 0, 1];
  return [v[0] / length, v[1] / length, v[2] / length];
}

/**
 * Minimal 2D drawing surface: satisfied by CanvasRenderingContext2D and by
 * the unit tests' recording mock — the snapshot plumbing is verifiable
 * without any browser canvas.
 */
export type MeshDrawingSurface = {
  // CanvasRenderingContext2D's paint styles also accept gradients/patterns;
  // the renderer only ever assigns plain color strings.
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  fill(): void;
  stroke(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
};

/** Render one canonical view onto any 2D surface. Deterministic. */
export function renderMeshView(
  surface: MeshDrawingSurface,
  mesh: MeshData,
  view: CanonicalView,
  canvasSize: number,
): { trianglesDrawn: number } {
  surface.fillStyle = "#ffffff";
  surface.fillRect(0, 0, canvasSize, canvasSize);
  const triangles = projectMesh(mesh, view, canvasSize);
  for (const triangle of triangles) {
    const gray = Math.round(235 * triangle.shade);
    surface.fillStyle = `rgb(${gray}, ${gray}, ${gray})`;
    surface.strokeStyle = "#5a5a5a";
    surface.lineWidth = 0.5;
    surface.beginPath();
    surface.moveTo(triangle.points[0][0], triangle.points[0][1]);
    surface.lineTo(triangle.points[1][0], triangle.points[1][1]);
    surface.lineTo(triangle.points[2][0], triangle.points[2][1]);
    surface.closePath();
    surface.fill();
    surface.stroke();
  }
  return { trianglesDrawn: triangles.length };
}
