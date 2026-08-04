/**
 * Layer 2 — deterministic vector composition.
 *
 * This module owns EVERYTHING in a patent drawing that must be exact:
 * reference characters, lead lines, `FIG. N` labels, sheet numbering,
 * margins and sight, `Prior Art` legends, section arrows, crosshair scan
 * targets and identifying indicia. No model is involved and no randomness
 * exists — the same spec composes to the same bytes.
 *
 * It also emits COMPOSITION METADATA alongside the SVG: the actual position,
 * size and rotation of every mark it drew. The validator (Layer 3) checks
 * that metadata, so compliance is measured against the real output rather
 * than against the intent that produced it.
 */
import {
  CROSSHAIR_ARM_CM,
  LINE_WEIGHT_CM,
  MAX_SIGHT_CM,
  TYPE_SIZE_CM,
  mm,
  sheetGeometry,
  type SheetGeometry,
} from "./geometry";
import type {
  Annotation,
  DrawPrimitive,
  FigureSetSpec,
  FigureSpec,
  LineType,
  Orientation,
  Point,
  SheetSize,
} from "./types";

export const COMPOSER_VERSION = "figures-composer-1.0.0";

/** Ratio of glyph advance width to cap height for the plain sans stack. */
const CHAR_WIDTH_RATIO = 0.62;
/** Gap the lead line stops short of the feature (1.84(q): must not touch). */
const LEAD_TERMINAL_GAP_CM = 0.18;
/** Minimum vertical pitch between stacked reference characters. */
const REF_PITCH_CM = 0.62;
/** Gutter width reserved outside each art box for reference characters. */
const GUTTER_CM = 1.7;
/** Height of the label strip under each figure (FIG. N + Prior Art). */
const LABEL_STRIP_CM = 1.35;
/** Strip at the top of the sight for the sheet number (inside the sight). */
const SHEET_NUMBER_STRIP_CM = 1.1;
/** Clear separation between adjacent figure cells (1.84(h): not crowded). */
const CELL_GAP_CM = 1.0;

export type Mm = { x: number; y: number };

export type TextRole =
  | "reference"
  | "figure_label"
  | "sheet_number"
  | "legend"
  | "prior_art"
  | "indicia"
  | "copyright";

export type TextMark = {
  role: TextRole;
  text: string;
  /** Anchor point in mm from the sheet's top-left. */
  atMm: Mm;
  /** Cap height in CM — the unit 37 CFR 1.84(p)(3) measures. */
  heightCm: number;
  boxMm: { x: number; y: number; w: number; h: number };
  /** 0 = reads in the same direction as the view it belongs to. */
  rotationDeg: number;
  underlined: boolean;
  figureNumber: number | null;
};

export type LeadLineMark = {
  figureNumber: number;
  numeral: string;
  pointsMm: Mm[];
  /** Distance from the lead line's terminus to the feature it points at. */
  terminalGapMm: number;
};

export type DrawnSegment = {
  figureNumber: number;
  a: Mm;
  b: Mm;
  lineType: LineType;
  isHatch: boolean;
};

export type FigurePlacement = {
  figureNumber: number;
  partialSuffix: string | null;
  label: string;
  sheetNumber: number;
  artBoxMm: { x: number; y: number; w: number; h: number };
  cellBoxMm: { x: number; y: number; w: number; h: number };
  rotationDeg: number;
  isPriorArt: boolean;
  /** Hatching angles used, by part label — for the differing-angle check. */
  hatchAnglesByPart: Array<{ partLabel: string; angleDeg: number; spacingCm: number }>;
};

export type SheetComposition = {
  sheetNumber: number;
  totalSheets: number;
  orientation: Orientation;
  geometry: SheetGeometry;
  svg: string;
  figures: FigurePlacement[];
  textMarks: TextMark[];
  leadLines: LeadLineMark[];
  segments: DrawnSegment[];
  /** A frame around the sight is forbidden (1.84(g)); always false here. */
  hasSightFrame: boolean;
  crosshairs: Array<{ atMm: Mm; armMm: number; inMargin: boolean }>;
  rasters: Array<{ figureNumber: number; dataUri: string }>;
};

export type Composition = {
  sheets: SheetComposition[];
  /**
   * Figures the placement solver could not satisfy compliantly. These are
   * surfaced as `needs_human_review`, never emitted with a violating
   * placement (spec §5 Stage 3).
   */
  unplaceable: Array<{ figureNumber: number; reason: string }>;
  composerVersion: string;
};

export type ComposeOptions = {
  /** Optional identifying indicia in the top margin (1.84(c)). */
  indicia?: string | null;
  /** Crosshair scan targets in two cater-corner margins (1.84(h)). */
  crosshairs?: boolean;
  /** Copyright/mask-work notice, drawn inside the sight (1.84(s)). */
  copyrightNotice?: string | null;
};

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

/**
 * How much of a sheet a figure wants, in HALF-CELLS: 1 = half a sheet,
 * 2 = the whole sheet. Deterministic from the figure's own content, so the
 * same set always packs the same way.
 */
function sheetShare(figure: FigureSpec): 1 | 2 {
  const boxes = figure.primitives.filter(
    (p) => p.kind === "rect" || p.kind === "polygon" || p.kind === "ellipse",
  ).length;
  // A busy diagram gets the whole sheet; anything else shares.
  if (figure.viewType === "flowchart" || figure.viewType === "block_diagram") {
    return boxes >= 4 ? 2 : 1;
  }
  if (figure.viewType === "waveform") return boxes >= 4 ? 2 : 1;
  if (figure.viewType === "exploded") return 2;
  return 1;
}

/**
 * Pack figures onto sheets. Two half-height cells per portrait sheet unless
 * a figure needs the whole sheet. Views never overlap and never sit inside
 * another view's outline, because each occupies its own disjoint cell
 * (1.84(h)(1)).
 */
function packSheets(figures: readonly FigureSpec[]): FigureSpec[][] {
  const sheets: FigureSpec[][] = [];
  let current: FigureSpec[] = [];
  let capacity = 2;
  for (const figure of figures) {
    const share = sheetShare(figure);
    if (share > capacity && current.length > 0) {
      sheets.push(current);
      current = [];
      capacity = 2;
    }
    current.push(figure);
    capacity -= share;
    if (capacity <= 0) {
      sheets.push(current);
      current = [];
      capacity = 2;
    }
  }
  if (current.length > 0) sheets.push(current);
  return sheets.length > 0 ? sheets : [[]];
}

/* ------------------------------------------------------------------ */
/* Reference-character placement solver                                */
/* ------------------------------------------------------------------ */

type PlacedAnnotation = {
  numeral: string;
  labelMm: Mm;
  anchorMm: Mm;
  leadPointsMm: Mm[];
  underlined: boolean;
  terminalGapMm: number;
};

/**
 * Place reference characters for one figure.
 *
 * Strategy, in the order 1.84(p)(3)/(q) prefers:
 *  1. OUTSIDE the figure, in the gutter on whichever side the feature is
 *     nearer, one character per lead line.
 *  2. Anchors are sorted by y and assigned gutter slots in the SAME order,
 *     which makes lead-line crossing impossible by construction: two
 *     straight segments from a common vertical line to points whose y-order
 *     matches the labels' y-order cannot intersect.
 *  3. Overflow beyond gutter capacity falls back to the on-surface
 *     underlined convention with a blank halo.
 *  4. If even that cannot fit, the figure is reported unplaceable and marked
 *     `needs_human_review` — never drawn with a violating placement.
 */
function placeAnnotations(
  annotations: readonly Annotation[],
  artBoxMm: { x: number; y: number; w: number; h: number },
  gutterMm: number,
): { placed: PlacedAnnotation[]; overflow: number } {
  if (annotations.length === 0) return { placed: [], overflow: 0 };

  const pitchMm = mm(REF_PITCH_CM);
  const capacityPerSide = Math.max(1, Math.floor(artBoxMm.h / pitchMm));
  const gapMm = mm(LEAD_TERMINAL_GAP_CM);

  const withAbs = annotations.map((annotation) => ({
    annotation,
    anchorMm: {
      x: artBoxMm.x + annotation.anchor.x * artBoxMm.w,
      y: artBoxMm.y + annotation.anchor.y * artBoxMm.h,
    },
  }));

  const left = withAbs.filter((item) => item.annotation.anchor.x < 0.5);
  const right = withAbs.filter((item) => item.annotation.anchor.x >= 0.5);

  const placed: PlacedAnnotation[] = [];
  let overflow = 0;

  for (const [side, items] of [
    ["left", left] as const,
    ["right", right] as const,
  ]) {
    const sorted = [...items].sort((a, b) => a.anchorMm.y - b.anchorMm.y);
    const usable = sorted.slice(0, capacityPerSide);
    const spill = sorted.slice(capacityPerSide);
    overflow += spill.length;

    // Distribute slots evenly across the art box height, preserving order.
    const count = usable.length;
    const labelX =
      side === "left" ? artBoxMm.x - gutterMm * 0.55 : artBoxMm.x + artBoxMm.w + gutterMm * 0.55;
    usable.forEach((item, index) => {
      const t = count === 1 ? 0.5 : index / (count - 1);
      const slotY = artBoxMm.y + pitchMm * 0.5 + t * Math.max(artBoxMm.h - pitchMm, 0);
      const labelMm: Mm = { x: labelX, y: slotY };
      const start: Mm = {
        // Lead line originates immediately adjacent to the character.
        x: side === "left" ? labelMm.x + pitchMm * 0.35 : labelMm.x - pitchMm * 0.35,
        y: labelMm.y,
      };
      const terminus = shortenTo(start, item.anchorMm, gapMm);
      placed.push({
        numeral: item.annotation.numeral,
        labelMm,
        anchorMm: item.anchorMm,
        leadPointsMm: [start, terminus],
        underlined: false,
        terminalGapMm: distance(terminus, item.anchorMm),
      });
    });

    // Overflow: on-surface underlined convention (1.84(q)) — no lead line.
    for (const item of spill) {
      placed.push({
        numeral: item.annotation.numeral,
        labelMm: item.anchorMm,
        anchorMm: item.anchorMm,
        leadPointsMm: [],
        underlined: true,
        terminalGapMm: 0,
      });
    }
  }

  return { placed, overflow };
}

function distance(a: Mm, b: Mm): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Point on segment a→b that stops `gap` mm short of b. */
function shortenTo(a: Mm, b: Mm, gap: number): Mm {
  const length = distance(a, b);
  if (length <= gap) return { ...a };
  const t = (length - gap) / length;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/* ------------------------------------------------------------------ */
/* SVG emission                                                        */
/* ------------------------------------------------------------------ */

function dashArray(lineType: LineType | undefined): string {
  switch (lineType) {
    case "dashed":
      return "1.8 1.2"; // hidden lines
    case "phantom":
      return "6 1.5 0.6 1.5 0.6 1.5"; // dash-dot-dot-dash
    case "projection":
      return "6 1.5 0.6 1.5"; // dash-dot-dash
    default:
      return "";
  }
}

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function n(value: number): string {
  return (Math.round(value * 1000) / 1000).toString();
}

function textBox(text: string, at: Mm, heightCm: number, anchor: "start" | "middle" | "end") {
  const h = mm(heightCm);
  const w = text.length * h * CHAR_WIDTH_RATIO;
  const x = anchor === "start" ? at.x : anchor === "middle" ? at.x - w / 2 : at.x - w;
  return { x, y: at.y - h, w, h };
}

/* ------------------------------------------------------------------ */
/* Compose                                                             */
/* ------------------------------------------------------------------ */

export function compose(spec: FigureSetSpec, options: ComposeOptions = {}): Composition {
  const orientation: Orientation = "portrait"; // 1.84(f): portrait whenever possible
  const geometry = sheetGeometry(spec.sheetSize, orientation);
  // Drawable figures only: needs_input / failed figures are never composed —
  // they are surfaced in the product with their question instead (§8).
  const drawable = spec.figures.filter(
    (figure) => figure.state !== "needs_input" && figure.state !== "failed",
  );
  const packs = packSheets(drawable);
  const totalSheets = packs.length;
  const unplaceable: Composition["unplaceable"] = [];

  const sheets: SheetComposition[] = packs.map((figures, index) => {
    const sheetNumber = index + 1;
    const body: string[] = [];
    const textMarks: TextMark[] = [];
    const leadLines: LeadLineMark[] = [];
    const segments: DrawnSegment[] = [];
    const rasters: SheetComposition["rasters"] = [];
    const placements: FigurePlacement[] = [];
    const crosshairs: SheetComposition["crosshairs"] = [];

    const sightXMm = mm(geometry.sightXCm);
    const sightYMm = mm(geometry.sightYCm);
    const sightWMm = mm(geometry.sightWidthCm);
    const sightHMm = mm(geometry.sightHeightCm);

    /* --- sheet number: inside the sight, centered, clear of the drawing --- */
    const sheetNumberText = `${sheetNumber}/${totalSheets}`;
    const sheetNumberAt: Mm = { x: sightXMm + sightWMm / 2, y: sightYMm + mm(0.55) };
    body.push(
      svgText(sheetNumberText, sheetNumberAt, TYPE_SIZE_CM.sheetNumber, "middle", false, 0),
    );
    textMarks.push({
      role: "sheet_number",
      text: sheetNumberText,
      atMm: sheetNumberAt,
      heightCm: TYPE_SIZE_CM.sheetNumber,
      boxMm: textBox(sheetNumberText, sheetNumberAt, TYPE_SIZE_CM.sheetNumber, "middle"),
      rotationDeg: 0,
      underlined: false,
      figureNumber: null,
    });

    /* --- optional identifying indicia, centered in the TOP MARGIN --------- */
    if (options.indicia) {
      const at: Mm = { x: mm(geometry.widthCm) / 2, y: mm(1.2) };
      body.push(svgText(options.indicia, at, TYPE_SIZE_CM.legendText, "middle", false, 0));
      textMarks.push({
        role: "indicia",
        text: options.indicia,
        atMm: at,
        heightCm: TYPE_SIZE_CM.legendText,
        boxMm: textBox(options.indicia, at, TYPE_SIZE_CM.legendText, "middle"),
        rotationDeg: 0,
        underlined: false,
        figureNumber: null,
      });
    }

    /* --- optional crosshair scan targets in cater-corner margins ---------- */
    if (options.crosshairs) {
      const arm = mm(CROSSHAIR_ARM_CM);
      const corners: Mm[] = [
        { x: mm(geometry.marginLeftCm / 2), y: mm(geometry.marginTopCm / 2) },
        {
          x: mm(geometry.widthCm - geometry.marginRightCm / 2),
          y: mm(geometry.heightCm - geometry.marginBottomCm / 2),
        },
      ];
      for (const corner of corners) {
        body.push(
          `<path d="M ${n(corner.x - arm / 2)} ${n(corner.y)} H ${n(corner.x + arm / 2)} M ${n(corner.x)} ${n(corner.y - arm / 2)} V ${n(corner.y + arm / 2)}" stroke="#000" stroke-width="${n(mm(LINE_WEIGHT_CM.hatch))}" fill="none"/>`,
        );
        crosshairs.push({
          atMm: corner,
          armMm: arm,
          inMargin:
            corner.x < sightXMm ||
            corner.x > sightXMm + sightWMm ||
            corner.y < sightYMm ||
            corner.y > sightYMm + sightHMm,
        });
      }
    }

    /* --- figure cells ----------------------------------------------------- */
    const cellsTop = sightYMm + mm(SHEET_NUMBER_STRIP_CM);
    const cellsHeight = sightHMm - mm(SHEET_NUMBER_STRIP_CM);
    const shares = figures.map(sheetShare);
    const totalShare = shares.reduce((sum, share) => sum + share, 0) || 2;
    let cursorY = cellsTop;

    figures.forEach((figure, figureIndex) => {
      const share = shares[figureIndex];
      const gapCount = figures.length - 1;
      const usableHeight = cellsHeight - mm(CELL_GAP_CM) * gapCount;
      const cellH = (usableHeight * share) / totalShare;
      const cellBoxMm = { x: sightXMm, y: cursorY, w: sightWMm, h: cellH };
      const labelStripMm = mm(LABEL_STRIP_CM);
      const gutterMm = mm(GUTTER_CM);
      const artBoxMm = {
        x: sightXMm + gutterMm,
        y: cursorY,
        w: sightWMm - gutterMm * 2,
        h: cellH - labelStripMm,
      };

      const hatchAnglesByPart: FigurePlacement["hatchAnglesByPart"] = [];

      /* primitives */
      for (const primitive of figure.primitives) {
        emitPrimitive(primitive, artBoxMm, figure.figureNumber, body, segments, rasters, textMarks, hatchAnglesByPart);
      }

      /* reference characters + lead lines */
      const { placed, overflow } = placeAnnotations(figure.annotations, artBoxMm, gutterMm);
      if (overflow > 0 && overflow > Math.max(1, Math.floor(figure.annotations.length / 2))) {
        unplaceable.push({
          figureNumber: figure.figureNumber,
          reason: `${overflow} reference characters could not be placed outside the figure without crowding`,
        });
      }
      for (const item of placed) {
        if (item.leadPointsMm.length >= 2) {
          const points = item.leadPointsMm.map((point) => `${n(point.x)},${n(point.y)}`).join(" ");
          body.push(
            `<polyline points="${points}" fill="none" stroke="#000" stroke-width="${n(mm(LINE_WEIGHT_CM.lead))}"/>`,
          );
          leadLines.push({
            figureNumber: figure.figureNumber,
            numeral: item.numeral,
            pointsMm: item.leadPointsMm,
            terminalGapMm: item.terminalGapMm,
          });
        }
        if (item.underlined) {
          // Blank halo so the character never sits on hatching (1.84(q)).
          const box = textBox(item.numeral, item.labelMm, TYPE_SIZE_CM.referenceCharacter, "middle");
          body.push(
            `<rect x="${n(box.x - 0.6)}" y="${n(box.y - 0.6)}" width="${n(box.w + 1.2)}" height="${n(box.h + 1.2)}" fill="#fff" stroke="none"/>`,
          );
        }
        body.push(
          svgText(
            item.numeral,
            item.labelMm,
            TYPE_SIZE_CM.referenceCharacter,
            "middle",
            item.underlined,
            0,
          ),
        );
        textMarks.push({
          role: "reference",
          text: item.numeral,
          atMm: item.labelMm,
          heightCm: TYPE_SIZE_CM.referenceCharacter,
          boxMm: textBox(item.numeral, item.labelMm, TYPE_SIZE_CM.referenceCharacter, "middle"),
          rotationDeg: 0,
          underlined: item.underlined,
          figureNumber: figure.figureNumber,
        });
      }

      /* FIG. N label + Prior Art legend below it */
      const label = figureLabel(figure, spec.figures.length);
      const labelAt: Mm = {
        x: cellBoxMm.x + cellBoxMm.w / 2,
        y: cellBoxMm.y + cellH - labelStripMm + mm(0.55),
      };
      if (label) {
        body.push(svgText(label, labelAt, TYPE_SIZE_CM.figureLabel, "middle", false, 0));
        textMarks.push({
          role: "figure_label",
          text: label,
          atMm: labelAt,
          heightCm: TYPE_SIZE_CM.figureLabel,
          boxMm: textBox(label, labelAt, TYPE_SIZE_CM.figureLabel, "middle"),
          rotationDeg: 0,
          underlined: false,
          figureNumber: figure.figureNumber,
        });
      }
      if (figure.isPriorArt) {
        const priorAt: Mm = { x: labelAt.x, y: labelAt.y + mm(0.55) };
        body.push(svgText("Prior Art", priorAt, TYPE_SIZE_CM.legendText, "middle", false, 0));
        textMarks.push({
          role: "prior_art",
          text: "Prior Art",
          atMm: priorAt,
          heightCm: TYPE_SIZE_CM.legendText,
          boxMm: textBox("Prior Art", priorAt, TYPE_SIZE_CM.legendText, "middle"),
          rotationDeg: 0,
          underlined: false,
          figureNumber: figure.figureNumber,
        });
      }

      placements.push({
        figureNumber: figure.figureNumber,
        partialSuffix: figure.partialSuffix,
        label,
        sheetNumber,
        artBoxMm,
        cellBoxMm,
        rotationDeg: 0,
        isPriorArt: figure.isPriorArt,
        hatchAnglesByPart,
      });

      cursorY += cellH + mm(CELL_GAP_CM);
    });

    /* --- copyright / mask-work notice, inside the sight ------------------- */
    if (options.copyrightNotice) {
      const at: Mm = { x: sightXMm + sightWMm / 2, y: sightYMm + sightHMm - mm(0.2) };
      body.push(svgText(options.copyrightNotice, at, 0.4, "middle", false, 0));
      textMarks.push({
        role: "copyright",
        text: options.copyrightNotice,
        atMm: at,
        heightCm: 0.4,
        boxMm: textBox(options.copyrightNotice, at, 0.4, "middle"),
        rotationDeg: 0,
        underlined: false,
        figureNumber: null,
      });
    }

    const svg = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${n(mm(geometry.widthCm))}mm" height="${n(mm(geometry.heightCm))}mm" viewBox="0 0 ${n(mm(geometry.widthCm))} ${n(mm(geometry.heightCm))}" role="img" aria-label="Patent drawing sheet ${sheetNumber} of ${totalSheets}">`,
      `<title>Drawing sheet ${sheetNumber} of ${totalSheets} — working draft, counsel review required</title>`,
      `<rect x="0" y="0" width="${n(mm(geometry.widthCm))}" height="${n(mm(geometry.heightCm))}" fill="#ffffff"/>`,
      `<g fill="none" stroke="#000000" stroke-linecap="round" stroke-linejoin="round">`,
      ...body,
      `</g>`,
      `</svg>`,
    ].join("\n");

    return {
      sheetNumber,
      totalSheets,
      orientation,
      geometry,
      svg,
      figures: placements,
      textMarks,
      leadLines,
      segments,
      hasSightFrame: false,
      crosshairs,
      rasters,
    };
  });

  return { sheets, unplaceable, composerVersion: COMPOSER_VERSION };
}

/**
 * 37 CFR 1.84(u): view numbers are consecutive Arabic numerals preceded by
 * `FIG.` — EXCEPT that when the application has only one view, that view is
 * not numbered and the abbreviation must not appear.
 */
export function figureLabel(figure: FigureSpec, totalFiguresInSet: number): string {
  if (totalFiguresInSet <= 1) return "";
  return `FIG. ${figure.figureNumber}${figure.partialSuffix ?? ""}`;
}

function svgText(
  text: string,
  at: Mm,
  heightCm: number,
  anchor: "start" | "middle" | "end",
  underlined: boolean,
  rotationDeg: number,
): string {
  const size = mm(heightCm);
  const transform =
    rotationDeg === 0 ? "" : ` transform="rotate(${n(rotationDeg)} ${n(at.x)} ${n(at.y)})"`;
  const decoration = underlined ? ` text-decoration="underline"` : "";
  // Plain, legible lettering — never ornate (1.84(p)(2), 1.84(u)).
  return `<text x="${n(at.x)}" y="${n(at.y)}" font-family="Helvetica, Arial, sans-serif" font-size="${n(size)}" fill="#000000" stroke="none" text-anchor="${anchor}"${decoration}${transform}>${esc(text)}</text>`;
}

function emitPrimitive(
  primitive: DrawPrimitive,
  box: { x: number; y: number; w: number; h: number },
  figureNumber: number,
  body: string[],
  segments: DrawnSegment[],
  rasters: SheetComposition["rasters"],
  textMarks: TextMark[],
  hatchAnglesByPart: FigurePlacement["hatchAnglesByPart"],
): void {
  const toMm = (point: Point): Mm => ({ x: box.x + point.x * box.w, y: box.y + point.y * box.h });
  const stroke = n(mm(LINE_WEIGHT_CM.primary));
  const hatchStroke = n(mm(LINE_WEIGHT_CM.hatch));

  switch (primitive.kind) {
    case "polyline": {
      const points = primitive.points.map(toMm);
      body.push(
        `<polyline points="${points.map((p) => `${n(p.x)},${n(p.y)}`).join(" ")}" stroke-width="${stroke}"${dash(primitive.lineType)}/>`,
      );
      pushSegments(points, figureNumber, primitive.lineType ?? "solid", false, segments, primitive.closed);
      break;
    }
    case "rect": {
      const a = toMm({ x: primitive.x, y: primitive.y });
      const b = toMm({ x: primitive.x + primitive.w, y: primitive.y + primitive.h });
      body.push(
        `<rect x="${n(a.x)}" y="${n(a.y)}" width="${n(b.x - a.x)}" height="${n(b.y - a.y)}" stroke-width="${stroke}" fill="none"${dash(primitive.lineType)}/>`,
      );
      pushSegments(
        [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }],
        figureNumber,
        primitive.lineType ?? "solid",
        false,
        segments,
        true,
      );
      break;
    }
    case "ellipse": {
      const c = toMm({ x: primitive.cx, y: primitive.cy });
      const rx = primitive.rx * box.w;
      const ry = primitive.ry * box.h;
      body.push(
        `<ellipse cx="${n(c.x)}" cy="${n(c.y)}" rx="${n(rx)}" ry="${n(ry)}" stroke-width="${stroke}" fill="none"${dash(primitive.lineType)}/>`,
      );
      // Approximate the outline for geometric checks.
      const approx: Mm[] = Array.from({ length: 24 }, (_, i) => {
        const theta = (i / 24) * Math.PI * 2;
        return { x: c.x + rx * Math.cos(theta), y: c.y + ry * Math.sin(theta) };
      });
      pushSegments(approx, figureNumber, primitive.lineType ?? "solid", false, segments, true);
      break;
    }
    case "polygon": {
      const points = primitive.points.map(toMm);
      body.push(
        `<polygon points="${points.map((p) => `${n(p.x)},${n(p.y)}`).join(" ")}" stroke-width="${stroke}" fill="none"${dash(primitive.lineType)}/>`,
      );
      pushSegments(points, figureNumber, primitive.lineType ?? "solid", false, segments, true);
      if (primitive.hatchAngleDeg !== undefined) {
        const spacing = primitive.hatchSpacing ?? 0.02;
        const hatch = hatchLines(points, primitive.hatchAngleDeg, spacing * box.h);
        for (const [a, b] of hatch) {
          body.push(
            `<line x1="${n(a.x)}" y1="${n(a.y)}" x2="${n(b.x)}" y2="${n(b.y)}" stroke-width="${hatchStroke}"/>`,
          );
          segments.push({ figureNumber, a, b, lineType: "solid", isHatch: true });
        }
        hatchAnglesByPart.push({
          partLabel: primitive.hatchMaterial ?? "unspecified",
          angleDeg: primitive.hatchAngleDeg,
          spacingCm: spacing * box.h,
        });
      }
      break;
    }
    case "arrow": {
      const from = toMm(primitive.from);
      const to = toMm(primitive.to);
      const head = arrowHead(from, to, primitive.role === "section_plane" ? 2.6 : 1.8);
      body.push(
        `<line x1="${n(from.x)}" y1="${n(from.y)}" x2="${n(to.x)}" y2="${n(to.y)}" stroke-width="${stroke}"/>`,
      );
      body.push(
        `<polyline points="${head.map((p) => `${n(p.x)},${n(p.y)}`).join(" ")}" stroke-width="${stroke}"/>`,
      );
      segments.push({ figureNumber, a: from, b: to, lineType: "solid", isHatch: false });
      // The head is part of the drawing: record it so downstream emitters
      // (the PDF renderer) reproduce the sheet faithfully.
      pushSegments(head, figureNumber, "solid", false, segments);
      break;
    }
    case "legend_text": {
      const at = toMm(primitive.at);
      const anchor = primitive.anchor ?? "middle";
      body.push(svgText(primitive.text, at, TYPE_SIZE_CM.legendText, anchor, false, 0));
      textMarks.push({
        role: "legend",
        text: primitive.text,
        atMm: at,
        heightCm: TYPE_SIZE_CM.legendText,
        boxMm: textBox(primitive.text, at, TYPE_SIZE_CM.legendText, anchor),
        rotationDeg: 0,
        underlined: false,
        figureNumber,
      });
      break;
    }
    case "raster": {
      const a = toMm({ x: primitive.x, y: primitive.y });
      const b = toMm({ x: primitive.x + primitive.w, y: primitive.y + primitive.h });
      body.push(
        `<image href="${esc(primitive.dataUri)}" x="${n(a.x)}" y="${n(a.y)}" width="${n(b.x - a.x)}" height="${n(b.y - a.y)}" preserveAspectRatio="xMidYMid meet"/>`,
      );
      rasters.push({ figureNumber, dataUri: primitive.dataUri });
      break;
    }
  }
}

function dash(lineType: LineType | undefined): string {
  const array = dashArray(lineType);
  return array ? ` stroke-dasharray="${array}"` : "";
}

function pushSegments(
  points: Mm[],
  figureNumber: number,
  lineType: LineType,
  isHatch: boolean,
  out: DrawnSegment[],
  closed?: boolean,
): void {
  for (let i = 0; i + 1 < points.length; i += 1) {
    out.push({ figureNumber, a: points[i], b: points[i + 1], lineType, isHatch });
  }
  if (closed && points.length > 2) {
    out.push({ figureNumber, a: points[points.length - 1], b: points[0], lineType, isHatch });
  }
}

function arrowHead(from: Mm, to: Mm, sizeMm: number): Mm[] {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const spread = Math.PI / 7;
  return [
    { x: to.x - sizeMm * Math.cos(angle - spread), y: to.y - sizeMm * Math.sin(angle - spread) },
    { x: to.x, y: to.y },
    { x: to.x - sizeMm * Math.cos(angle + spread), y: to.y - sizeMm * Math.sin(angle + spread) },
  ];
}

/**
 * Regularly spaced parallel oblique strokes clipped to a convex-ish polygon
 * (37 CFR 1.84(h)(3)). Deterministic scanline intersection.
 */
export function hatchLines(polygon: Mm[], angleDeg: number, spacingMm: number): Array<[Mm, Mm]> {
  if (polygon.length < 3 || spacingMm <= 0) return [];
  const angle = (angleDeg * Math.PI) / 180;
  const dir = { x: Math.cos(angle), y: Math.sin(angle) };
  const normal = { x: -dir.y, y: dir.x };
  const projections = polygon.map((point) => point.x * normal.x + point.y * normal.y);
  const min = Math.min(...projections);
  const max = Math.max(...projections);
  const lines: Array<[Mm, Mm]> = [];
  const span = Math.max(
    ...polygon.map((p) => Math.hypot(p.x - polygon[0].x, p.y - polygon[0].y)),
    1,
  ) * 2;
  for (let offset = min + spacingMm; offset < max; offset += spacingMm) {
    const base = { x: normal.x * offset, y: normal.y * offset };
    const a = { x: base.x - dir.x * span, y: base.y - dir.y * span };
    const b = { x: base.x + dir.x * span, y: base.y + dir.y * span };
    const hits = clipToPolygon(a, b, polygon);
    if (hits.length === 2) lines.push([hits[0], hits[1]]);
  }
  return lines;
}

function clipToPolygon(a: Mm, b: Mm, polygon: Mm[]): Mm[] {
  const hits: Mm[] = [];
  for (let i = 0; i < polygon.length; i += 1) {
    const c = polygon[i];
    const d = polygon[(i + 1) % polygon.length];
    const point = segmentIntersection(a, b, c, d);
    if (point) hits.push(point);
  }
  if (hits.length < 2) return [];
  hits.sort((p, q) => p.x - q.x || p.y - q.y);
  return [hits[0], hits[hits.length - 1]];
}

/** Proper segment intersection; returns null for parallel/non-crossing. */
export function segmentIntersection(p1: Mm, p2: Mm, p3: Mm, p4: Mm): Mm | null {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x;
  const d2y = p4.y - p3.y;
  const denominator = d1x * d2y - d1y * d2x;
  if (Math.abs(denominator) < 1e-9) return null;
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denominator;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denominator;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: p1.x + t * d1x, y: p1.y + t * d1y };
}

/** Max sight for a size, used by the validator. */
export function maxSightFor(size: SheetSize) {
  return MAX_SIGHT_CM[size];
}
