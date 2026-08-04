/**
 * Deterministic synthetic line-art generator (local/dev mode).
 *
 * WHAT THIS IS: a programmatic stand-in for Layer 1 so the ENTIRE pipeline —
 * plan → generate → compose → validate → attach → review → export — runs and
 * is provably working with no Google credential and zero spend.
 *
 * WHAT THIS IS NOT: a drawing of the user's invention. It is an obviously
 * schematic placeholder, seeded from the subject text so it is stable across
 * runs. Every figure produced this way is labeled "synthetic placeholder"
 * in the product, in the sheet legend, and in the export provenance. It must
 * never be presented as a depiction of the actual subject.
 *
 * It deliberately obeys the same constraints the real Layer 1 must obey —
 * pure black on white, thin uniform lines, no solid fills, NO TEXT — so the
 * raster-hygiene gate and the validator are exercised for real.
 */
import { deflateSync } from "node:zlib";

export const SYNTHETIC_MODEL_ID = "local-synthetic-line-art";
export const SYNTHETIC_LEGEND = "Synthetic placeholder art (local mode)";

export type SyntheticOptions = {
  width?: number;
  height?: number;
  /** Seeds the shape; the same subject always yields the same bytes. */
  subject: string;
  viewType: string;
};

/** Deterministic 32-bit hash — the only source of "randomness" here. */
export function seedFrom(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Canvas = { width: number; height: number; grey: Uint8Array };

function blankCanvas(width: number, height: number): Canvas {
  const grey = new Uint8Array(width * height);
  grey.fill(255);
  return { width, height, grey };
}

function plot(canvas: Canvas, x: number, y: number): void {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) return;
  canvas.grey[py * canvas.width + px] = 0;
}

/** Bresenham, drawn twice with a 1px offset for a uniform 2px stroke. */
function line(canvas: Canvas, x0: number, y0: number, x1: number, y1: number): void {
  drawThin(canvas, x0, y0, x1, y1);
  drawThin(canvas, x0 + 1, y0, x1 + 1, y1);
}

function drawThin(canvas: Canvas, x0: number, y0: number, x1: number, y1: number): void {
  let sx0 = Math.round(x0);
  let sy0 = Math.round(y0);
  const sx1 = Math.round(x1);
  const sy1 = Math.round(y1);
  const dx = Math.abs(sx1 - sx0);
  const dy = -Math.abs(sy1 - sy0);
  const stepX = sx0 < sx1 ? 1 : -1;
  const stepY = sy0 < sy1 ? 1 : -1;
  let error = dx + dy;
  for (let guard = 0; guard < 20_000; guard += 1) {
    plot(canvas, sx0, sy0);
    if (sx0 === sx1 && sy0 === sy1) return;
    const doubled = 2 * error;
    if (doubled >= dy) {
      error += dy;
      sx0 += stepX;
    }
    if (doubled <= dx) {
      error += dx;
      sy0 += stepY;
    }
  }
}

function polyline(canvas: Canvas, points: Array<[number, number]>, closed = false): void {
  for (let i = 0; i + 1 < points.length; i += 1) {
    line(canvas, points[i][0], points[i][1], points[i + 1][0], points[i + 1][1]);
  }
  if (closed && points.length > 2) {
    const last = points[points.length - 1];
    line(canvas, last[0], last[1], points[0][0], points[0][1]);
  }
}

function ellipse(canvas: Canvas, cx: number, cy: number, rx: number, ry: number): void {
  const steps = 96;
  const points: Array<[number, number]> = [];
  for (let i = 0; i < steps; i += 1) {
    const theta = (i / steps) * Math.PI * 2;
    points.push([cx + rx * Math.cos(theta), cy + ry * Math.sin(theta)]);
  }
  polyline(canvas, points, true);
}

/**
 * Draw the placeholder. An isometric enclosure with an internal cylinder and
 * 45° hatching on one face — recognizably "a technical line drawing shaped
 * object", recognizably NOT a real depiction.
 */
export function generateSyntheticLineArt(options: SyntheticOptions): Uint8Array {
  const width = options.width ?? 768;
  const height = options.height ?? 768;
  const canvas = blankCanvas(width, height);
  const random = mulberry32(seedFrom(`${options.subject}|${options.viewType}`));

  const inset = Math.round(Math.min(width, height) * 0.14);
  const w = width - inset * 2;
  const h = height - inset * 2;
  const depth = Math.round(Math.min(w, h) * (0.16 + random() * 0.08));

  const frontLeft = inset;
  const frontTop = inset + depth;
  const frontRight = inset + w - depth;
  const frontBottom = inset + h;

  // Front face
  polyline(
    canvas,
    [
      [frontLeft, frontTop],
      [frontRight, frontTop],
      [frontRight, frontBottom],
      [frontLeft, frontBottom],
    ],
    true,
  );
  // Isometric top and right faces
  polyline(canvas, [
    [frontLeft, frontTop],
    [frontLeft + depth, frontTop - depth],
    [frontRight + depth, frontTop - depth],
    [frontRight, frontTop],
  ]);
  polyline(canvas, [
    [frontRight, frontBottom],
    [frontRight + depth, frontBottom - depth],
    [frontRight + depth, frontTop - depth],
  ]);

  // Internal element: a cylinder in elevation.
  const cx = frontLeft + (frontRight - frontLeft) * (0.34 + random() * 0.12);
  const cy = frontTop + (frontBottom - frontTop) * 0.5;
  const rx = Math.round((frontRight - frontLeft) * 0.13);
  const ry = Math.round((frontBottom - frontTop) * 0.09);
  ellipse(canvas, cx, cy - ry * 2, rx, ry);
  line(canvas, cx - rx, cy - ry * 2, cx - rx, cy + ry * 2);
  line(canvas, cx + rx, cy - ry * 2, cx + rx, cy + ry * 2);
  ellipse(canvas, cx, cy + ry * 2, rx, ry);

  // A second element, dashed to stand in for a hidden line.
  const hx = frontLeft + (frontRight - frontLeft) * 0.68;
  for (let y = frontTop + 12; y < frontBottom - 12; y += 14) {
    line(canvas, hx, y, hx, Math.min(y + 7, frontBottom - 12));
  }

  // 45° hatching on a band, thin and evenly spaced (never a solid fill).
  const bandTop = frontBottom - Math.round((frontBottom - frontTop) * 0.18);
  const spacing = 11;
  for (let offset = -h; offset < w * 2; offset += spacing) {
    const x0 = frontLeft + offset;
    const y0 = bandTop;
    const x1 = x0 + (frontBottom - bandTop);
    const y1 = frontBottom;
    if (x1 < frontLeft || x0 > frontRight) continue;
    drawThin(
      canvas,
      Math.max(x0, frontLeft),
      y0 + Math.max(0, frontLeft - x0),
      Math.min(x1, frontRight),
      y1 - Math.max(0, x1 - frontRight),
    );
  }

  return encodeGreyPng(canvas);
}

/* ------------------------------------------------------------------ */
/* Minimal 8-bit greyscale PNG encoder (pure JS, node:zlib)            */
/* ------------------------------------------------------------------ */

export function encodeGreyPng(canvas: Canvas): Uint8Array {
  const { width, height, grey } = canvas;
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width + 1)] = 0; // filter type 0 (None)
    Buffer.from(grey.buffer, grey.byteOffset + y * width, width).copy(
      raw,
      y * (width + 1) + 1,
    );
  }
  const compressed = deflateSync(raw);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // color type: greyscale
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", compressed),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Data URI for embedding in a composed SVG sheet. */
export function pngDataUri(bytes: Uint8Array): string {
  return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
}
