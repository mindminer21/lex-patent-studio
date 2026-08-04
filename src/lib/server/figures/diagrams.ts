/**
 * Deterministic diagram construction (Layer 2 only — no image model).
 *
 * Block diagrams, flowcharts, waveform groups and formula figures are
 * EXACTLY renderable from structured data, so asking a diffusion model to
 * draw them would only introduce error (spec §2). These builders turn the
 * component inventory / method steps / signal descriptions into
 * `DrawPrimitive`s plus the anchor points the numeral placer will use.
 *
 * Everything here is pure and deterministic: same input, same bytes out.
 */
import type { DrawPrimitive, Point } from "./types";

export type DiagramNodeInput = {
  /** Stable id used to resolve edges. */
  id: string;
  /** Box caption — a descriptive legend, permitted for block diagrams. */
  label: string;
  /** Part label for the numeral registry. */
  partLabel: string;
  /** Flowchart shape. Block diagrams always use `process`. */
  shape?: "process" | "terminal" | "decision";
};

export type DiagramEdgeInput = {
  from: string;
  to: string;
  /** Edge caption for decision branches ("yes"/"no"). Kept to one word. */
  label?: string;
};

export type DiagramResult = {
  primitives: DrawPrimitive[];
  /** Where each node's reference character should point (normalized). */
  anchors: Array<{ partLabel: string; point: Point }>;
  /** Bounding boxes of every node, for the numeral-placement solver. */
  nodeBoxes: Array<{ partLabel: string; x: number; y: number; w: number; h: number }>;
};

const NODE_W = 0.26;
const NODE_H = 0.12;

/**
 * Block diagram: nodes on a grid, edges as orthogonal connectors.
 *
 * Reference characters go OUTSIDE the boxes on lead lines (1.84(p)(3) and
 * MPEP 608.02 flowchart practice), so the anchor we return is the box edge,
 * never the box interior.
 */
export function buildBlockDiagram(
  nodes: readonly DiagramNodeInput[],
  edges: readonly DiagramEdgeInput[],
): DiagramResult {
  const count = Math.max(nodes.length, 1);
  const columns = count <= 3 ? 1 : 2;
  const rows = Math.ceil(count / columns);
  const primitives: DrawPrimitive[] = [];
  const anchors: DiagramResult["anchors"] = [];
  const nodeBoxes: DiagramResult["nodeBoxes"] = [];
  const centers = new Map<string, Point>();

  nodes.forEach((node, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const cx = columns === 1 ? 0.5 : 0.28 + column * 0.44;
    const cy = rows === 1 ? 0.5 : 0.16 + (row * (0.68 / Math.max(rows - 1, 1)));
    const x = cx - NODE_W / 2;
    const y = cy - NODE_H / 2;
    primitives.push({ kind: "rect", x, y, w: NODE_W, h: NODE_H, lineType: "solid" });
    primitives.push({
      kind: "legend_text",
      at: { x: cx, y: cy + 0.012 },
      text: node.label,
      anchor: "middle",
    });
    centers.set(node.id, { x: cx, y: cy });
    nodeBoxes.push({ partLabel: node.partLabel, x, y, w: NODE_W, h: NODE_H });
    // Anchor on the box's outer edge nearest the sheet margin, so the lead
    // line runs away from the drawing rather than across it.
    anchors.push({
      partLabel: node.partLabel,
      point: { x: cx < 0.5 ? x : x + NODE_W, y: cy - NODE_H / 4 },
    });
  });

  for (const edge of edges) {
    const from = centers.get(edge.from);
    const to = centers.get(edge.to);
    if (!from || !to) continue;
    primitives.push({ kind: "arrow", from: edgeExit(from, to), to: edgeEntry(from, to), role: "direction" });
    if (edge.label) {
      primitives.push({
        kind: "legend_text",
        at: { x: (from.x + to.x) / 2 + 0.02, y: (from.y + to.y) / 2 },
        text: edge.label,
        anchor: "start",
      });
    }
  }

  return { primitives, anchors, nodeBoxes };
}

/**
 * Flowchart: terminal (rounded/ellipse), process (rect), decision (diamond),
 * connected top-to-bottom. Same numerals-outside-boxes convention.
 */
export function buildFlowchart(
  nodes: readonly DiagramNodeInput[],
  edges: readonly DiagramEdgeInput[],
): DiagramResult {
  const primitives: DrawPrimitive[] = [];
  const anchors: DiagramResult["anchors"] = [];
  const nodeBoxes: DiagramResult["nodeBoxes"] = [];
  const centers = new Map<string, Point>();
  const rows = Math.max(nodes.length, 1);
  const step = 0.82 / Math.max(rows, 1);

  nodes.forEach((node, index) => {
    const cx = 0.5;
    const cy = 0.09 + step * index + step / 2;
    const shape = node.shape ?? "process";
    const x = cx - NODE_W / 2;
    const y = cy - NODE_H / 2;
    if (shape === "terminal") {
      primitives.push({
        kind: "ellipse",
        cx,
        cy,
        rx: NODE_W / 2,
        ry: NODE_H / 2,
        lineType: "solid",
      });
    } else if (shape === "decision") {
      primitives.push({
        kind: "polygon",
        points: [
          { x: cx, y: y },
          { x: x + NODE_W, y: cy },
          { x: cx, y: y + NODE_H },
          { x, y: cy },
        ],
        lineType: "solid",
      });
    } else {
      primitives.push({ kind: "rect", x, y, w: NODE_W, h: NODE_H, lineType: "solid" });
    }
    primitives.push({
      kind: "legend_text",
      at: { x: cx, y: cy + 0.012 },
      text: node.label,
      anchor: "middle",
    });
    centers.set(node.id, { x: cx, y: cy });
    nodeBoxes.push({ partLabel: node.partLabel, x, y, w: NODE_W, h: NODE_H });
    anchors.push({ partLabel: node.partLabel, point: { x: x + NODE_W, y: cy } });
  });

  for (const edge of edges) {
    const from = centers.get(edge.from);
    const to = centers.get(edge.to);
    if (!from || !to) continue;
    primitives.push({
      kind: "arrow",
      from: { x: from.x, y: from.y + NODE_H / 2 },
      to: { x: to.x, y: to.y - NODE_H / 2 },
      role: "direction",
    });
    if (edge.label) {
      primitives.push({
        kind: "legend_text",
        at: { x: from.x + 0.02, y: (from.y + to.y) / 2 },
        text: edge.label,
        anchor: "start",
      });
    }
  }

  return { primitives, anchors, nodeBoxes };
}

export type WaveformInput = {
  /** Letter adjacent to the vertical axis, e.g. "A". */
  letter: string;
  partLabel: string;
  /** Normalized samples in 0..1; rendered against the shared time axis. */
  samples: number[];
};

/**
 * Waveform group — 37 CFR 1.84(i): presented as a SINGLE figure with a
 * common vertical axis and time along the horizontal axis, each waveform
 * lettered adjacent to the vertical axis.
 */
export function buildWaveformGroup(waveforms: readonly WaveformInput[]): DiagramResult {
  const primitives: DrawPrimitive[] = [];
  const anchors: DiagramResult["anchors"] = [];
  const nodeBoxes: DiagramResult["nodeBoxes"] = [];
  const count = Math.max(waveforms.length, 1);
  const laneHeight = 0.78 / count;

  // One common vertical axis for the whole group, and one time axis.
  primitives.push({
    kind: "polyline",
    points: [
      { x: 0.14, y: 0.06 },
      { x: 0.14, y: 0.88 },
    ],
    lineType: "solid",
  });
  primitives.push({
    kind: "polyline",
    points: [
      { x: 0.14, y: 0.88 },
      { x: 0.94, y: 0.88 },
    ],
    lineType: "solid",
  });
  primitives.push({ kind: "legend_text", at: { x: 0.94, y: 0.94 }, text: "TIME", anchor: "end" });

  waveforms.forEach((waveform, index) => {
    const top = 0.07 + index * laneHeight;
    const bottom = top + laneHeight * 0.78;
    const samples = waveform.samples.length > 0 ? waveform.samples : [0, 1, 0, 1];
    const points: Point[] = samples.map((sample, sampleIndex) => ({
      x: 0.16 + (0.76 * sampleIndex) / Math.max(samples.length - 1, 1),
      y: bottom - clamp01(sample) * (bottom - top),
    }));
    primitives.push({ kind: "polyline", points, lineType: "solid" });
    // The lettering sits adjacent to the vertical axis, per 1.84(i).
    primitives.push({
      kind: "legend_text",
      at: { x: 0.11, y: (top + bottom) / 2 },
      text: waveform.letter,
      anchor: "end",
    });
    nodeBoxes.push({ partLabel: waveform.partLabel, x: 0.16, y: top, w: 0.76, h: bottom - top });
    anchors.push({ partLabel: waveform.partLabel, point: { x: 0.92, y: (top + bottom) / 2 } });
  });

  return { primitives, anchors, nodeBoxes };
}

/**
 * Formula figure — 37 CFR 1.84(i): each chemical or mathematical formula is
 * labeled as a SEPARATE figure. The formula body is a descriptive legend
 * drawn horizontally, left to right (1.84(o)).
 */
export function buildFormulaFigure(lines: readonly string[]): DiagramResult {
  const primitives: DrawPrimitive[] = [];
  const rows = Math.max(lines.length, 1);
  lines.forEach((line, index) => {
    primitives.push({
      kind: "legend_text",
      at: { x: 0.5, y: 0.5 - ((rows - 1) / 2 - index) * 0.12 },
      text: line,
      anchor: "middle",
    });
  });
  return { primitives, anchors: [], nodeBoxes: [] };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function edgeExit(from: Point, to: Point): Point {
  const dy = to.y - from.y;
  const dx = to.x - from.x;
  if (Math.abs(dy) >= Math.abs(dx)) {
    return { x: from.x, y: from.y + Math.sign(dy) * (NODE_H / 2) };
  }
  return { x: from.x + Math.sign(dx) * (NODE_W / 2), y: from.y };
}

function edgeEntry(from: Point, to: Point): Point {
  const dy = to.y - from.y;
  const dx = to.x - from.x;
  if (Math.abs(dy) >= Math.abs(dx)) {
    return { x: to.x, y: to.y - Math.sign(dy) * (NODE_H / 2) };
  }
  return { x: to.x - Math.sign(dx) * (NODE_W / 2), y: to.y };
}
