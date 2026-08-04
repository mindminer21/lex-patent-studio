/**
 * Sheet geometry per 37 CFR 1.84(f) and (g).
 *
 * All lengths are in CENTIMETRES throughout the composer; SVG user units
 * are set to 1 unit = 1 mm via the viewBox so the emitted document is
 * physically dimensioned and scales without resampling.
 */
import type { Orientation, SheetSize } from "./types";

export type SheetGeometry = {
  size: SheetSize;
  orientation: Orientation;
  /** Physical sheet, cm. */
  widthCm: number;
  heightCm: number;
  marginTopCm: number;
  marginLeftCm: number;
  marginRightCm: number;
  marginBottomCm: number;
  /** Usable sight area, cm. */
  sightWidthCm: number;
  sightHeightCm: number;
  /** Sight origin from the sheet's top-left, cm. */
  sightXCm: number;
  sightYCm: number;
};

/** 37 CFR 1.84(f): the two permitted sheet sizes. */
export const SHEET_DIMENSIONS_CM: Record<SheetSize, { widthCm: number; heightCm: number }> = {
  // A4 — required for PCT/foreign filing, so it is our default.
  a4: { widthCm: 21.0, heightCm: 29.7 },
  letter: { widthCm: 21.6, heightCm: 27.9 },
};

/**
 * 37 CFR 1.84(g) minimum margins. Top and left 2.5 cm, right 1.5 cm,
 * bottom 1.0 cm. We use exactly the minima so the sight is maximal; the
 * validator checks the resulting sight against the regulation's stated
 * maxima (17.0 × 26.2 on A4; 17.6 × 24.4 on letter).
 */
export const MARGINS_CM = {
  top: 2.5,
  left: 2.5,
  right: 1.5,
  bottom: 1.0,
} as const;

/** The regulation's stated maximum sight for each size, portrait. */
export const MAX_SIGHT_CM: Record<SheetSize, { widthCm: number; heightCm: number }> = {
  a4: { widthCm: 17.0, heightCm: 26.2 },
  letter: { widthCm: 17.6, heightCm: 24.4 },
};

export function sheetGeometry(size: SheetSize, orientation: Orientation): SheetGeometry {
  const base = SHEET_DIMENSIONS_CM[size];
  // Landscape is the same physical sheet turned; the regulation's margin
  // minima attach to the sheet edges, and the top of the sheet goes on the
  // right-hand side (1.84(f)). Geometrically that means the long edge is
  // horizontal and the margins rotate with it.
  const widthCm = orientation === "portrait" ? base.widthCm : base.heightCm;
  const heightCm = orientation === "portrait" ? base.heightCm : base.widthCm;

  const marginTopCm = orientation === "portrait" ? MARGINS_CM.top : MARGINS_CM.right;
  const marginLeftCm = orientation === "portrait" ? MARGINS_CM.left : MARGINS_CM.top;
  const marginRightCm = orientation === "portrait" ? MARGINS_CM.right : MARGINS_CM.bottom;
  const marginBottomCm = orientation === "portrait" ? MARGINS_CM.bottom : MARGINS_CM.left;

  return {
    size,
    orientation,
    widthCm,
    heightCm,
    marginTopCm,
    marginLeftCm,
    marginRightCm,
    marginBottomCm,
    sightWidthCm: round4(widthCm - marginLeftCm - marginRightCm),
    sightHeightCm: round4(heightCm - marginTopCm - marginBottomCm),
    sightXCm: marginLeftCm,
    sightYCm: marginTopCm,
  };
}

function round4(v: number): number {
  return Math.round(v * 10_000) / 10_000;
}

/**
 * Type sizes, 37 CFR 1.84(p)(3) and 1.84(t)/(u).
 *
 * Reference characters: minimum 0.32 cm (1/8 in). We draw at 0.35 cm to
 * leave reproduction headroom at two-thirds reduction (1.84(l)).
 * Figure/sheet numbers must be LARGER than reference characters — rule of
 * thumb 5 mm.
 */
export const TYPE_SIZE_CM = {
  referenceCharacterMin: 0.32,
  referenceCharacter: 0.35,
  figureLabel: 0.5,
  sheetNumber: 0.5,
  legendText: 0.32,
} as const;

/** Line weights, cm. Uniform, dense, well-defined (1.84(l)). */
export const LINE_WEIGHT_CM = {
  /** Main object lines. */
  primary: 0.035,
  /** Shading / hatching lines — thin and as few as practicable (1.84(m)). */
  hatch: 0.02,
  /** Lead lines. */
  lead: 0.02,
  /** Design-patent broken-line environment (0.2–0.3 mm). */
  designBroken: 0.025,
} as const;

/** Crosshair scan targets: 2 cm arms, in the margins, cater-corner (1.84(h)). */
export const CROSSHAIR_ARM_CM = 2.0;

export const CM_TO_MM = 10;

/** Convert cm to the SVG user unit (mm). */
export function mm(cm: number): number {
  return Math.round(cm * CM_TO_MM * 1000) / 1000;
}
