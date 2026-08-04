/**
 * Post-generation raster hygiene for Layer-1 output.
 *
 * A generative image model cannot be trusted to obey "no color, no
 * greyscale, no solid fills, no text" — so we verify mechanically rather
 * than hoping. Everything here is pure JS (node:zlib for the PNG stream);
 * no native binaries, no headless browser, serverless-safe.
 *
 * HONESTY NOTE ON TEXT DETECTION
 * ------------------------------
 * `detectTextLikeGlyphs` is a connected-component GLYPH HEURISTIC, not OCR.
 * It flags small, dense, similarly-sized blobs that sit on a shared baseline
 * — the visual signature of rendered characters. It will occasionally flag
 * a row of small drawing details, and it can miss a single isolated
 * character. It is deliberately biased toward false positives, because the
 * cost of a false positive is one regenerate and the cost of a false
 * negative is model-rendered text inside a patent drawing, which Layer 2
 * must own. Its verdict is reported as evidence, never as a guarantee.
 */
import { inflateSync } from "node:zlib";

export type RasterImage = {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, row-major. */
  pixels: Uint8Array;
};

export type RasterReport = {
  width: number;
  height: number;
  /** Fraction of pixels whose channels differ (i.e. actually colored). */
  colorPixelRatio: number;
  /** Fraction of pixels that are neither near-black nor near-white. */
  midtoneRatio: number;
  /** Fraction of pixels that are near-black. */
  blackRatio: number;
  /** Largest contiguous near-black region as a fraction of the image. */
  largestBlackRegionRatio: number;
  /** Glyph-heuristic verdict — see the module note. */
  textLikeGlyphCount: number;
  /** Content bounding box in pixels (near-black content). */
  contentBox: { x: number; y: number; w: number; h: number } | null;
};

export type HygieneThresholds = {
  /** Any color at all is a failure; a hair of tolerance for JPEG-ish noise. */
  maxColorPixelRatio: number;
  maxMidtoneRatio: number;
  /** Solid black shading of areas is not permitted (1.84(m)). */
  maxLargestBlackRegionRatio: number;
  /** Any detected text is a hard failure — Layer 2 owns all text. */
  maxTextLikeGlyphs: number;
};

export const DEFAULT_HYGIENE_THRESHOLDS: HygieneThresholds = {
  maxColorPixelRatio: 0.001,
  maxMidtoneRatio: 0.06,
  maxLargestBlackRegionRatio: 0.02,
  maxTextLikeGlyphs: 0,
};

export type HygieneVerdict = {
  ok: boolean;
  report: RasterReport;
  violations: Array<{ code: HygieneViolationCode; detail: string }>;
};

export type HygieneViolationCode =
  | "color_detected"
  | "greyscale_detected"
  | "solid_black_area"
  | "text_detected"
  | "empty_image"
  | "undecodable";

const NEAR_BLACK = 96;
const NEAR_WHITE = 200;

/* ------------------------------------------------------------------ */
/* PNG decoding (8-bit, non-interlaced: grey, RGB, grey+A, RGBA)        */
/* ------------------------------------------------------------------ */

export function decodePng(bytes: Uint8Array): RasterImage | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 8) return null;
  for (let i = 0; i < 8; i += 1) if (bytes[i] !== signature[i]) return null;

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat: Uint8Array[] = [];
  let palette: Uint8Array | null = null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    );
    const dataStart = offset + 8;
    if (dataStart + length > bytes.length) return null;
    if (type === "IHDR") {
      width = view.getUint32(dataStart);
      height = view.getUint32(dataStart + 4);
      bitDepth = bytes[dataStart + 8];
      colorType = bytes[dataStart + 9];
      interlace = bytes[dataStart + 12];
    } else if (type === "PLTE") {
      palette = bytes.slice(dataStart, dataStart + length);
    } else if (type === "IDAT") {
      idat.push(bytes.slice(dataStart, dataStart + length));
    } else if (type === "IEND") {
      break;
    }
    offset = dataStart + length + 4;
  }

  if (width <= 0 || height <= 0 || bitDepth !== 8 || interlace !== 0) return null;
  if (idat.length === 0) return null;

  const channels =
    colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 3 ? 1 : colorType === 4 ? 2 : 4;
  if (colorType === 3 && !palette) return null;

  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idat.map((chunk) => Buffer.from(chunk))));
  } catch {
    return null;
  }

  const stride = width * channels;
  if (raw.length < (stride + 1) * height) return null;

  const out = new Uint8Array(width * height * 4);
  const previous = new Uint8Array(stride);
  const current = new Uint8Array(stride);

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    const filter = raw[rowStart];
    for (let i = 0; i < stride; i += 1) {
      const rawByte = raw[rowStart + 1 + i];
      const left = i >= channels ? current[i - channels] : 0;
      const up = previous[i];
      const upLeft = i >= channels ? previous[i - channels] : 0;
      let value: number;
      switch (filter) {
        case 0:
          value = rawByte;
          break;
        case 1:
          value = rawByte + left;
          break;
        case 2:
          value = rawByte + up;
          break;
        case 3:
          value = rawByte + ((left + up) >> 1);
          break;
        case 4:
          value = rawByte + paeth(left, up, upLeft);
          break;
        default:
          return null;
      }
      current[i] = value & 0xff;
    }
    for (let x = 0; x < width; x += 1) {
      const source = x * channels;
      const target = (y * width + x) * 4;
      if (colorType === 0) {
        const grey = current[source];
        out[target] = grey;
        out[target + 1] = grey;
        out[target + 2] = grey;
        out[target + 3] = 255;
      } else if (colorType === 2) {
        out[target] = current[source];
        out[target + 1] = current[source + 1];
        out[target + 2] = current[source + 2];
        out[target + 3] = 255;
      } else if (colorType === 3 && palette) {
        const index = current[source] * 3;
        out[target] = palette[index] ?? 0;
        out[target + 1] = palette[index + 1] ?? 0;
        out[target + 2] = palette[index + 2] ?? 0;
        out[target + 3] = 255;
      } else if (colorType === 4) {
        const grey = current[source];
        out[target] = grey;
        out[target + 1] = grey;
        out[target + 2] = grey;
        out[target + 3] = current[source + 1];
      } else {
        out[target] = current[source];
        out[target + 1] = current[source + 1];
        out[target + 2] = current[source + 2];
        out[target + 3] = current[source + 3];
      }
    }
    previous.set(current);
  }

  return { width, height, pixels: out };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/* ------------------------------------------------------------------ */
/* Analysis                                                            */
/* ------------------------------------------------------------------ */

export function analyzeRaster(image: RasterImage): RasterReport {
  const { width, height, pixels } = image;
  const total = width * height;
  let colored = 0;
  let midtone = 0;
  let black = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  const mask = new Uint8Array(total);
  for (let index = 0; index < total; index += 1) {
    const p = index * 4;
    const r = pixels[p];
    const g = pixels[p + 1];
    const b = pixels[p + 2];
    const alpha = pixels[p + 3];
    // Alpha-composite over white: an unfilled PNG background is white paper.
    const rr = Math.round((r * alpha + 255 * (255 - alpha)) / 255);
    const gg = Math.round((g * alpha + 255 * (255 - alpha)) / 255);
    const bb = Math.round((b * alpha + 255 * (255 - alpha)) / 255);
    const maxChannel = Math.max(rr, gg, bb);
    const minChannel = Math.min(rr, gg, bb);
    if (maxChannel - minChannel > 12) colored += 1;
    const luma = Math.round(0.299 * rr + 0.587 * gg + 0.114 * bb);
    if (luma <= NEAR_BLACK) {
      black += 1;
      mask[index] = 1;
      const x = index % width;
      const y = Math.floor(index / width);
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    } else if (luma < NEAR_WHITE) {
      midtone += 1;
    }
  }

  const { largestRegion, components } = connectedComponents(mask, width, height);

  return {
    width,
    height,
    colorPixelRatio: total === 0 ? 0 : colored / total,
    midtoneRatio: total === 0 ? 0 : midtone / total,
    blackRatio: total === 0 ? 0 : black / total,
    largestBlackRegionRatio: total === 0 ? 0 : largestRegion / total,
    textLikeGlyphCount: detectTextLikeGlyphs(components, width, height),
    contentBox:
      maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
  };
}

type Component = { x: number; y: number; w: number; h: number; area: number };

function connectedComponents(
  mask: Uint8Array,
  width: number,
  height: number,
): { largestRegion: number; components: Component[] } {
  const visited = new Uint8Array(mask.length);
  const components: Component[] = [];
  let largestRegion = 0;
  const stack: number[] = [];

  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] !== 1 || visited[start] === 1) continue;
    stack.length = 0;
    stack.push(start);
    visited[start] = 1;
    let area = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    while (stack.length > 0) {
      const index = stack.pop()!;
      area += 1;
      const x = index % width;
      const y = (index - x) / width;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      // 8-connectivity so a thin diagonal stroke stays one component.
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const neighbour = ny * width + nx;
          if (mask[neighbour] === 1 && visited[neighbour] === 0) {
            visited[neighbour] = 1;
            stack.push(neighbour);
          }
        }
      }
    }
    if (area > largestRegion) largestRegion = area;
    components.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, area });
  }
  return { largestRegion, components };
}

/**
 * Glyph heuristic (see module note — this is NOT OCR).
 *
 * A component looks like a character when it is small relative to the image,
 * roughly as tall as it is wide or taller, and reasonably solid. Characters
 * do not occur alone in rendered text, so we only report a hit when at least
 * three such components share a baseline band and similar heights — the
 * signature of a rendered word.
 */
export function detectTextLikeGlyphs(
  components: readonly Component[],
  width: number,
  height: number,
): number {
  const minDim = Math.min(width, height);
  const candidates = components.filter((component) => {
    const tall = component.h >= minDim * 0.012 && component.h <= minDim * 0.09;
    const narrow = component.w >= minDim * 0.005 && component.w <= minDim * 0.09;
    const ratio = component.w / Math.max(component.h, 1);
    const boxArea = component.w * component.h;
    const density = component.area / Math.max(boxArea, 1);
    // The density ceiling is 1.0 on purpose: characters like "1", "I" and "l"
    // fill their bounding box almost completely, and excluding solid blobs
    // would let exactly those through. The ≥3-on-a-baseline requirement below
    // is what keeps isolated solid marks in line art from tripping this.
    return tall && narrow && ratio >= 0.15 && ratio <= 1.6 && density >= 0.16 && density <= 1.0;
  });
  if (candidates.length < 3) return 0;

  let hits = 0;
  const used = new Set<number>();
  for (let i = 0; i < candidates.length; i += 1) {
    if (used.has(i)) continue;
    const base = candidates[i];
    const baseline = base.y + base.h;
    const group = [i];
    for (let j = i + 1; j < candidates.length; j += 1) {
      if (used.has(j)) continue;
      const other = candidates[j];
      const sameBaseline = Math.abs(other.y + other.h - baseline) <= Math.max(base.h * 0.35, 2);
      const similarHeight = Math.abs(other.h - base.h) <= Math.max(base.h * 0.5, 2);
      const nearby = Math.abs(other.x - base.x) <= base.w * 24;
      if (sameBaseline && similarHeight && nearby) group.push(j);
    }
    if (group.length >= 3) {
      for (const index of group) used.add(index);
      hits += group.length;
    }
  }
  return hits;
}

/**
 * Full hygiene gate for one Layer-1 image. Returns every violation found so
 * the caller can log exactly why a generation was rejected.
 */
export function checkRasterHygiene(
  bytes: Uint8Array,
  thresholds: HygieneThresholds = DEFAULT_HYGIENE_THRESHOLDS,
): HygieneVerdict {
  const image = decodePng(bytes);
  if (!image) {
    return {
      ok: false,
      report: emptyReport(),
      violations: [{ code: "undecodable", detail: "output was not a decodable 8-bit PNG" }],
    };
  }
  const report = analyzeRaster(image);
  const violations: HygieneVerdict["violations"] = [];

  if (report.colorPixelRatio > thresholds.maxColorPixelRatio) {
    violations.push({
      code: "color_detected",
      detail: `${(report.colorPixelRatio * 100).toFixed(2)}% of pixels are colored; color is prohibited without a petition (37 CFR 1.84(a)(2))`,
    });
  }
  if (report.midtoneRatio > thresholds.maxMidtoneRatio) {
    violations.push({
      code: "greyscale_detected",
      detail: `${(report.midtoneRatio * 100).toFixed(2)}% of pixels are mid-tone; drawings must be black line art, not greyscale (37 CFR 1.84(b))`,
    });
  }
  if (report.largestBlackRegionRatio > thresholds.maxLargestBlackRegionRatio) {
    violations.push({
      code: "solid_black_area",
      detail: `largest solid black region is ${(report.largestBlackRegionRatio * 100).toFixed(2)}% of the image; solid black shading of areas is not permitted (37 CFR 1.84(m))`,
    });
  }
  if (report.textLikeGlyphCount > thresholds.maxTextLikeGlyphs) {
    violations.push({
      code: "text_detected",
      detail: `${report.textLikeGlyphCount} text-like glyph components detected; Layer 2 owns all text, so any text in generated art is a hard failure`,
    });
  }
  if (!report.contentBox || report.blackRatio < 0.0005) {
    violations.push({ code: "empty_image", detail: "no drawable content found in the output" });
  }

  return { ok: violations.length === 0, report, violations };
}

function emptyReport(): RasterReport {
  return {
    width: 0,
    height: 0,
    colorPixelRatio: 0,
    midtoneRatio: 0,
    blackRatio: 0,
    largestBlackRegionRatio: 0,
    textLikeGlyphCount: 0,
    contentBox: null,
  };
}

/**
 * Trim to the content bounding box and return normalized placement so the
 * composer can drop the art into its box without wasted white space.
 */
export function contentPlacement(report: RasterReport): { x: number; y: number; w: number; h: number } {
  if (!report.contentBox || report.width === 0 || report.height === 0) {
    return { x: 0, y: 0, w: 1, h: 1 };
  }
  const box = report.contentBox;
  return {
    x: box.x / report.width,
    y: box.y / report.height,
    w: box.w / report.width,
    h: box.h / report.height,
  };
}
