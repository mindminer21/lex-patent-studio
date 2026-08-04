import { describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";
import {
  analyzeRaster,
  checkRasterHygiene,
  contentPlacement,
  decodePng,
  DEFAULT_HYGIENE_THRESHOLDS,
} from "@/lib/server/figures/raster";
import {
  encodeGreyPng,
  generateSyntheticLineArt,
  pngDataUri,
  seedFrom,
  SYNTHETIC_MODEL_ID,
} from "@/lib/server/figures/synthetic";

/**
 * Raster hygiene is the gate that stops a generative model from smuggling
 * color, tone, filled areas or TEXT into a patent drawing. The synthetic
 * generator is used as the "known good" input, which also proves the local
 * pipeline produces output that survives the real gate.
 */

/* --------------------------- test image helpers ------------------------ */

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/** Encode an RGB PNG so the color path can be exercised end to end. */
function encodeRgbPng(width: number, height: number, rgb: Uint8Array): Uint8Array {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 3 + 1)] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + y * width * 3, width * 3).copy(
      raw,
      y * (width * 3 + 1) + 1,
    );
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // truecolor
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

function greyCanvas(width: number, height: number): { width: number; height: number; grey: Uint8Array } {
  const grey = new Uint8Array(width * height);
  grey.fill(255);
  return { width, height, grey };
}

function fillRect(
  canvas: { width: number; grey: Uint8Array },
  x: number,
  y: number,
  w: number,
  h: number,
  value: number,
): void {
  for (let py = y; py < y + h; py += 1) {
    for (let px = x; px < x + w; px += 1) {
      canvas.grey[py * canvas.width + px] = value;
    }
  }
}

/* ------------------------------- decoding ------------------------------ */

describe("PNG decoding", () => {
  it("round-trips an 8-bit greyscale PNG", () => {
    const canvas = greyCanvas(32, 32);
    fillRect(canvas, 4, 4, 8, 2, 0);
    const decoded = decodePng(encodeGreyPng(canvas));
    expect(decoded).not.toBeNull();
    expect(decoded!.width).toBe(32);
    expect(decoded!.height).toBe(32);
    // The drawn band is black; the paper is white.
    const at = (x: number, y: number) => decoded!.pixels[(y * 32 + x) * 4];
    expect(at(5, 5)).toBe(0);
    expect(at(20, 20)).toBe(255);
  });

  it("decodes truecolor PNGs", () => {
    const rgb = new Uint8Array(8 * 8 * 3);
    rgb.fill(255);
    rgb[0] = 255;
    rgb[1] = 0;
    rgb[2] = 0;
    const decoded = decodePng(encodeRgbPng(8, 8, rgb));
    expect(decoded).not.toBeNull();
    expect([decoded!.pixels[0], decoded!.pixels[1], decoded!.pixels[2]]).toEqual([255, 0, 0]);
  });

  it("returns null for bytes that are not a decodable PNG", () => {
    expect(decodePng(new Uint8Array([1, 2, 3, 4]))).toBeNull();
    expect(decodePng(new Uint8Array(0))).toBeNull();
  });
});

/* ------------------------------- analysis ------------------------------ */

describe("raster analysis", () => {
  it("reports no color, no midtone and a small black ratio for line art", () => {
    const canvas = greyCanvas(64, 64);
    fillRect(canvas, 10, 10, 40, 2, 0);
    fillRect(canvas, 10, 10, 2, 40, 0);
    const report = analyzeRaster(decodePng(encodeGreyPng(canvas))!);
    expect(report.colorPixelRatio).toBe(0);
    expect(report.midtoneRatio).toBe(0);
    expect(report.blackRatio).toBeLessThan(0.1);
    expect(report.contentBox).not.toBeNull();
  });

  it("measures the largest contiguous black region", () => {
    const canvas = greyCanvas(64, 64);
    fillRect(canvas, 8, 8, 32, 32, 0); // a big filled block
    const report = analyzeRaster(decodePng(encodeGreyPng(canvas))!);
    expect(report.largestBlackRegionRatio).toBeCloseTo((32 * 32) / (64 * 64), 2);
  });

  it("reports the content bounding box for trimming", () => {
    const canvas = greyCanvas(100, 100);
    fillRect(canvas, 20, 30, 10, 5, 0);
    const report = analyzeRaster(decodePng(encodeGreyPng(canvas))!);
    expect(report.contentBox).toEqual({ x: 20, y: 30, w: 10, h: 5 });
    const placement = contentPlacement(report);
    expect(placement.x).toBeCloseTo(0.2, 6);
    expect(placement.y).toBeCloseTo(0.3, 6);
  });

  it("falls back to the full box when there is no content", () => {
    expect(contentPlacement(analyzeRaster(decodePng(encodeGreyPng(greyCanvas(10, 10)))!))).toEqual({
      x: 0,
      y: 0,
      w: 1,
      h: 1,
    });
  });
});

/* ------------------------------- hygiene ------------------------------- */

describe("raster hygiene gate", () => {
  it("accepts the deterministic synthetic line art", () => {
    const verdict = checkRasterHygiene(
      generateSyntheticLineArt({ subject: "a pressure regulator", viewType: "perspective" }),
    );
    expect(verdict.violations).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  it("rejects color", () => {
    const rgb = new Uint8Array(64 * 64 * 3);
    rgb.fill(255);
    for (let i = 0; i < 64 * 20; i += 1) {
      rgb[i * 3] = 200;
      rgb[i * 3 + 1] = 30;
      rgb[i * 3 + 2] = 30;
    }
    const verdict = checkRasterHygiene(encodeRgbPng(64, 64, rgb));
    expect(verdict.ok).toBe(false);
    expect(verdict.violations.map((v) => v.code)).toContain("color_detected");
  });

  it("rejects greyscale/photographic tone", () => {
    const canvas = greyCanvas(64, 64);
    fillRect(canvas, 0, 0, 64, 40, 140); // a wash of mid grey
    const verdict = checkRasterHygiene(encodeGreyPng(canvas));
    expect(verdict.ok).toBe(false);
    expect(verdict.violations.map((v) => v.code)).toContain("greyscale_detected");
  });

  it("rejects solid black area fills", () => {
    const canvas = greyCanvas(64, 64);
    fillRect(canvas, 4, 4, 40, 40, 0);
    const verdict = checkRasterHygiene(encodeGreyPng(canvas));
    expect(verdict.ok).toBe(false);
    expect(verdict.violations.map((v) => v.code)).toContain("solid_black_area");
  });

  it("rejects text-like glyphs — Layer 2 owns all text", () => {
    // Six small, similarly-sized marks sitting on one baseline: the visual
    // signature of a rendered word.
    const canvas = greyCanvas(400, 400);
    for (let index = 0; index < 6; index += 1) {
      fillRect(canvas, 60 + index * 18, 200, 8, 14, 0);
    }
    const verdict = checkRasterHygiene(encodeGreyPng(canvas));
    expect(verdict.ok).toBe(false);
    expect(verdict.violations.map((v) => v.code)).toContain("text_detected");
  });

  it("does not flag ordinary line work as text", () => {
    const canvas = greyCanvas(400, 400);
    // Long strokes: nothing glyph-shaped.
    fillRect(canvas, 40, 40, 320, 3, 0);
    fillRect(canvas, 40, 40, 3, 320, 0);
    fillRect(canvas, 40, 357, 320, 3, 0);
    const verdict = checkRasterHygiene(encodeGreyPng(canvas));
    expect(verdict.violations.map((v) => v.code)).not.toContain("text_detected");
  });

  it("rejects an empty image rather than composing a blank figure", () => {
    const verdict = checkRasterHygiene(encodeGreyPng(greyCanvas(64, 64)));
    expect(verdict.ok).toBe(false);
    expect(verdict.violations.map((v) => v.code)).toContain("empty_image");
  });

  it("rejects undecodable bytes", () => {
    const verdict = checkRasterHygiene(new Uint8Array([0, 1, 2]));
    expect(verdict.ok).toBe(false);
    expect(verdict.violations[0].code).toBe("undecodable");
  });

  it("uses zero-tolerance defaults for text", () => {
    expect(DEFAULT_HYGIENE_THRESHOLDS.maxTextLikeGlyphs).toBe(0);
  });
});

/* ------------------------- synthetic generator ------------------------- */

describe("synthetic line-art generator", () => {
  it("is deterministic for the same subject and view", () => {
    const a = generateSyntheticLineArt({ subject: "valve body", viewType: "plan" });
    const b = generateSyntheticLineArt({ subject: "valve body", viewType: "plan" });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it("varies with the subject, so different figures do not look identical", () => {
    const a = generateSyntheticLineArt({ subject: "valve body", viewType: "plan" });
    const b = generateSyntheticLineArt({ subject: "impeller housing", viewType: "plan" });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it("draws no text at all, so it survives the same gate real art must", () => {
    for (const subject of ["valve body", "impeller", "control board"]) {
      const verdict = checkRasterHygiene(generateSyntheticLineArt({ subject, viewType: "perspective" }));
      expect(verdict.violations.map((v) => v.code), subject).not.toContain("text_detected");
      expect(verdict.ok, subject).toBe(true);
    }
  });

  it("is clearly identified as synthetic, not as a real model", () => {
    expect(SYNTHETIC_MODEL_ID).toContain("synthetic");
  });

  it("produces an embeddable data URI", () => {
    const uri = pngDataUri(generateSyntheticLineArt({ subject: "x", viewType: "plan" }));
    expect(uri.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("hashes subjects deterministically", () => {
    expect(seedFrom("abc")).toBe(seedFrom("abc"));
    expect(seedFrom("abc")).not.toBe(seedFrom("abd"));
  });
});
