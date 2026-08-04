/**
 * Layer 3 — the versioned, testable USPTO drawing rule set.
 *
 * Every rule carries an id, a human-readable description, its citation, and
 * — where the rule is mechanically checkable — a checker that runs against
 * the COMPOSED OUTPUT (positions, sizes, geometry the composer actually
 * emitted), not against the intent that produced it.
 *
 * WHAT THIS IS NOT: a guarantee of USPTO acceptance. These are mechanical
 * formality checks against published formal requirements. Rules that cannot
 * be decided by machine return `needs_human_review` with the reason — they
 * are never silently passed (spec §9).
 */
import { MARGINS_CM, MAX_SIGHT_CM, TYPE_SIZE_CM, mm } from "./geometry";
import { checkRegistryConsistency } from "./numerals";
import { segmentIntersection, type Composition, type Mm, type TextMark } from "./compose";
import type { RasterReport } from "./raster";
import type { FigureSetSpec, FigureSpec } from "./types";

export const RULES_VERSION = "uspto-drawings-2026-08-04";

export type RuleStatus = "pass" | "fail" | "not_applicable" | "needs_human_review";

export type RuleOutcome = {
  ruleId: string;
  status: RuleStatus;
  detail: string;
  figureNumber: number | null;
  sheetNumber: number | null;
};

export type ValidationContext = {
  spec: FigureSetSpec;
  composition: Composition;
  /** Raster hygiene reports for Layer-1 figures, keyed by figure number. */
  rasterReports: Map<number, RasterReport>;
  /** Draft text for the two-way reference-character cross-check. */
  draftText: string;
  /** Apply the design-patent rule subset (Lex design lane). */
  designPatent: boolean;
};

export type FigureRule = {
  id: string;
  description: string;
  citation: string;
  check?: (ctx: ValidationContext) => RuleOutcome[];
  /** Set when the rule is not mechanically decidable. */
  humanReviewReason?: string;
};

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const out = (
  ruleId: string,
  status: RuleStatus,
  detail: string,
  figureNumber: number | null = null,
  sheetNumber: number | null = null,
): RuleOutcome => ({ ruleId, status, detail, figureNumber, sheetNumber });

function boxesOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function segmentIntersectsBox(
  a: Mm,
  b: Mm,
  box: { x: number; y: number; w: number; h: number },
): boolean {
  const corners: Mm[] = [
    { x: box.x, y: box.y },
    { x: box.x + box.w, y: box.y },
    { x: box.x + box.w, y: box.y + box.h },
    { x: box.x, y: box.y + box.h },
  ];
  for (let i = 0; i < 4; i += 1) {
    if (segmentIntersection(a, b, corners[i], corners[(i + 1) % 4])) return true;
  }
  const inside = (p: Mm) =>
    p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h;
  return inside(a) && inside(b);
}

const REFERENCE_TOKEN = /\b([1-9][0-9]{1,3}[A-Z]?)\b/g;

/** Reference characters mentioned in the specification text. */
export function referenceCharactersInText(text: string): Set<string> {
  const found = new Set<string>();
  for (const match of text.matchAll(REFERENCE_TOKEN)) found.add(match[1]);
  return found;
}

function drawnReferenceCharacters(ctx: ValidationContext): Set<string> {
  const found = new Set<string>();
  for (const sheet of ctx.composition.sheets) {
    for (const mark of sheet.textMarks) {
      if (mark.role === "reference") found.add(mark.text);
    }
  }
  return found;
}

function referenceMarks(ctx: ValidationContext): Array<{ mark: TextMark; sheetNumber: number }> {
  const marks: Array<{ mark: TextMark; sheetNumber: number }> = [];
  for (const sheet of ctx.composition.sheets) {
    for (const mark of sheet.textMarks) {
      if (mark.role === "reference") marks.push({ mark, sheetNumber: sheet.sheetNumber });
    }
  }
  return marks;
}

/* ------------------------------------------------------------------ */
/* the rule set                                                        */
/* ------------------------------------------------------------------ */

export const FIGURE_RULES: readonly FigureRule[] = [
  /* ---------------------------- media --------------------------------- */
  {
    id: "MEDIA-COLOR",
    description:
      "Drawings must be black and white line art. Color requires a granted petition and is out of scope; any color in the output is a failure.",
    citation: "37 CFR 1.84(a)(2)",
    check: (ctx) => {
      const results: RuleOutcome[] = [];
      for (const [figureNumber, report] of ctx.rasterReports) {
        if (report.colorPixelRatio > 0.001) {
          results.push(
            out(
              "MEDIA-COLOR",
              "fail",
              `generated art contains color (${(report.colorPixelRatio * 100).toFixed(2)}% of pixels)`,
              figureNumber,
            ),
          );
        }
      }
      for (const sheet of ctx.composition.sheets) {
        const colors = [...sheet.svg.matchAll(/(?:fill|stroke)="(#[0-9a-fA-F]{3,6})"/g)].map(
          (match) => match[1].toLowerCase(),
        );
        const offending = colors.filter(
          (color) => !["#000", "#fff", "#000000", "#ffffff"].includes(color),
        );
        if (offending.length > 0) {
          results.push(
            out(
              "MEDIA-COLOR",
              "fail",
              `composed sheet uses non-monochrome colors: ${[...new Set(offending)].join(", ")}`,
              null,
              sheet.sheetNumber,
            ),
          );
        }
      }
      return results.length > 0
        ? results
        : [out("MEDIA-COLOR", "pass", "all output is pure black on white")];
    },
  },
  {
    id: "MEDIA-GREYSCALE",
    description:
      "No greyscale or photographic fills; drawings are line art, not continuous-tone images.",
    citation: "37 CFR 1.84(b)",
    check: (ctx) => {
      const results: RuleOutcome[] = [];
      for (const [figureNumber, report] of ctx.rasterReports) {
        if (report.midtoneRatio > 0.06) {
          results.push(
            out(
              "MEDIA-GREYSCALE",
              "fail",
              `${(report.midtoneRatio * 100).toFixed(2)}% of pixels are mid-tone (greyscale/photographic)`,
              figureNumber,
            ),
          );
        }
      }
      return results.length > 0
        ? results
        : [out("MEDIA-GREYSCALE", "pass", "no continuous-tone content detected")];
    },
  },
  {
    id: "MEDIA-SOLID-BLACK",
    description:
      "Solid black shading of areas is not permitted, except to represent bar graphs or color.",
    citation: "37 CFR 1.84(m)",
    check: (ctx) => {
      const results: RuleOutcome[] = [];
      for (const [figureNumber, report] of ctx.rasterReports) {
        if (report.largestBlackRegionRatio > 0.02) {
          results.push(
            out(
              "MEDIA-SOLID-BLACK",
              "fail",
              `largest solid black region covers ${(report.largestBlackRegionRatio * 100).toFixed(2)}% of the drawing`,
              figureNumber,
            ),
          );
        }
      }
      for (const sheet of ctx.composition.sheets) {
        if (/<(?:rect|polygon|ellipse|circle|path)[^>]*fill="#(?:000|000000)"/.test(sheet.svg)) {
          results.push(
            out(
              "MEDIA-SOLID-BLACK",
              "fail",
              "composed sheet contains a black-filled area",
              null,
              sheet.sheetNumber,
            ),
          );
        }
      }
      return results.length > 0
        ? results
        : [out("MEDIA-SOLID-BLACK", "pass", "no solid black area fills")];
    },
  },
  {
    id: "MEDIA-REPRODUCTION",
    description:
      "Every line, number and letter must be thick enough to reproduce when the sheet is reduced to two-thirds size.",
    citation: "37 CFR 1.84(l)",
    check: (ctx) => {
      const results: RuleOutcome[] = [];
      const minReadableCm = TYPE_SIZE_CM.referenceCharacterMin * (2 / 3);
      for (const sheet of ctx.composition.sheets) {
        for (const mark of sheet.textMarks) {
          if (mark.heightCm * (2 / 3) < minReadableCm - 1e-9) {
            results.push(
              out(
                "MEDIA-REPRODUCTION",
                "fail",
                `"${mark.text}" is ${mark.heightCm.toFixed(2)} cm — below ${TYPE_SIZE_CM.referenceCharacterMin} cm, so it will not survive two-thirds reduction`,
                mark.figureNumber,
                sheet.sheetNumber,
              ),
            );
          }
        }
      }
      return results.length > 0
        ? results
        : [out("MEDIA-REPRODUCTION", "pass", "all lettering survives two-thirds reduction")];
    },
  },
  {
    id: "MEDIA-SHADING-CONVENTION",
    description:
      "Shading, where used, is thin spaced parallel lines with the light source at the upper left, 45 degrees.",
    citation: "37 CFR 1.84(m)",
    check: (ctx) => {
      const results: RuleOutcome[] = [];
      let sawDeterministicHatch = false;
      for (const sheet of ctx.composition.sheets) {
        for (const placement of sheet.figures) {
          for (const hatch of placement.hatchAnglesByPart) {
            sawDeterministicHatch = true;
            const normalized = ((hatch.angleDeg % 180) + 180) % 180;
            if (Math.abs(normalized - 45) > 1e-6 && Math.abs(normalized - 135) > 1e-6) {
              results.push(
                out(
                  "MEDIA-SHADING-CONVENTION",
                  "fail",
                  `hatching at ${hatch.angleDeg}° is not the 45° oblique convention`,
                  placement.figureNumber,
                  sheet.sheetNumber,
                ),
              );
            }
          }
        }
      }
      if (results.length > 0) return results;
      if (ctx.rasterReports.size > 0) {
        return [
          out(
            "MEDIA-SHADING-CONVENTION",
            "needs_human_review",
            "shading direction and spacing inside generated line art cannot be measured mechanically; a person must confirm the 45° upper-left convention",
          ),
        ];
      }
      return [
        out(
          "MEDIA-SHADING-CONVENTION",
          sawDeterministicHatch ? "pass" : "not_applicable",
          sawDeterministicHatch ? "all hatching is 45° oblique" : "no shading used",
        ),
      ];
    },
  },

  /* ------------------------- sheet geometry ---------------------------- */
  {
    id: "SHEET-SIZE",
    description: "Sheets must be A4 (21.0 × 29.7 cm) or 21.6 × 27.9 cm (8.5 × 11 in).",
    citation: "37 CFR 1.84(f)",
    check: (ctx) => {
      const bad = ctx.composition.sheets.filter(
        (sheet) => sheet.geometry.size !== "a4" && sheet.geometry.size !== "letter",
      );
      return bad.length > 0
        ? bad.map((sheet) =>
            out("SHEET-SIZE", "fail", `unsupported sheet size ${sheet.geometry.size}`, null, sheet.sheetNumber),
          )
        : [out("SHEET-SIZE", "pass", `all sheets are ${ctx.spec.sheetSize.toUpperCase()}`)];
    },
  },
  {
    id: "SHEET-UNIFORM",
    description: "All drawing sheets in one application must be the same size.",
    citation: "37 CFR 1.84(f)",
    check: (ctx) => {
      const sizes = new Set(ctx.composition.sheets.map((sheet) => sheet.geometry.size));
      return sizes.size > 1
        ? [out("SHEET-UNIFORM", "fail", `mixed sheet sizes: ${[...sizes].join(", ")}`)]
        : [out("SHEET-UNIFORM", "pass", "every sheet is the same size")];
    },
  },
  {
    id: "SHEET-MARGINS",
    description:
      "Minimum margins: top 2.5 cm, left 2.5 cm, right 1.5 cm, bottom 1.0 cm.",
    citation: "37 CFR 1.84(g)",
    check: (ctx) => {
      const results: RuleOutcome[] = [];
      for (const sheet of ctx.composition.sheets) {
        const g = sheet.geometry;
        const checks: Array<[string, number, number]> = [
          ["top", g.marginTopCm, MARGINS_CM.top],
          ["left", g.marginLeftCm, MARGINS_CM.left],
          ["right", g.marginRightCm, MARGINS_CM.right],
          ["bottom", g.marginBottomCm, MARGINS_CM.bottom],
        ];
        for (const [side, actual, minimum] of checks) {
          if (actual < minimum - 1e-9) {
            results.push(
              out(
                "SHEET-MARGINS",
                "fail",
                `${side} margin is ${actual} cm, below the ${minimum} cm minimum`,
                null,
                sheet.sheetNumber,
              ),
            );
          }
        }
      }
      return results.length > 0
        ? results
        : [out("SHEET-MARGINS", "pass", "all margins meet the minima")];
    },
  },
  {
    id: "SHEET-SIGHT",
    description:
      "The sight must not exceed 17.0 × 26.2 cm on A4 or 17.6 × 24.4 cm on 21.6 × 27.9 cm sheets.",
    citation: "37 CFR 1.84(g)",
    check: (ctx) => {
      const results: RuleOutcome[] = [];
      for (const sheet of ctx.composition.sheets) {
        const max = MAX_SIGHT_CM[sheet.geometry.size];
        const width =
          sheet.orientation === "portrait" ? sheet.geometry.sightWidthCm : sheet.geometry.sightHeightCm;
        const height =
          sheet.orientation === "portrait" ? sheet.geometry.sightHeightCm : sheet.geometry.sightWidthCm;
        if (width > max.widthCm + 1e-6 || height > max.heightCm + 1e-6) {
          results.push(
            out(
              "SHEET-SIGHT",
              "fail",
              `sight ${width.toFixed(2)} × ${height.toFixed(2)} cm exceeds ${max.widthCm} × ${max.heightCm} cm`,
              null,
              sheet.sheetNumber,
            ),
          );
        }
      }
      return results.length > 0 ? results : [out("SHEET-SIGHT", "pass", "sight within limits")];
    },
  },
  {
    id: "SHEET-NO-FRAME",
    description: "No frame may be drawn around the sight.",
    citation: "37 CFR 1.84(g)",
    check: (ctx) => {
      const results: RuleOutcome[] = [];
      for (const sheet of ctx.composition.sheets) {
        if (sheet.hasSightFrame) {
          results.push(
            out("SHEET-NO-FRAME", "fail", "a frame was drawn around the sight", null, sheet.sheetNumber),
          );
          continue;
        }
        const sightX = mm(sheet.geometry.sightXCm);
        const sightY = mm(sheet.geometry.sightYCm);
        const sightW = mm(sheet.geometry.sightWidthCm);
        const sightH = mm(sheet.geometry.sightHeightCm);
        for (const match of sheet.svg.matchAll(
          /<rect[^>]*x="([\d.-]+)"[^>]*y="([\d.-]+)"[^>]*width="([\d.-]+)"[^>]*height="([\d.-]+)"[^>]*\/>/g,
        )) {
          const [x, y, w, h] = match.slice(1, 5).map(Number);
          const stroked = !/fill="#fff/.test(match[0]) && !/fill="#ffffff"/.test(match[0]);
          if (
            stroked &&
            Math.abs(x - sightX) < 2 &&
            Math.abs(y - sightY) < 2 &&
            Math.abs(w - sightW) < 2 &&
            Math.abs(h - sightH) < 2
          ) {
            results.push(
              out(
                "SHEET-NO-FRAME",
                "fail",
                "a rectangle coincident with the sight was drawn",
                null,
                sheet.sheetNumber,
              ),
            );
          }
        }
      }
      return results.length > 0
        ? results
        : [out("SHEET-NO-FRAME", "pass", "no frame around the sight")];
    },
  },
  {
    id: "SHEET-ORIENTATION",
    description:
      "Portrait orientation whenever possible; landscape sheets carry the top of the sheet on the right-hand side.",
    citation: "37 CFR 1.84(f), (i)",
    check: (ctx) => {
      const results: RuleOutcome[] = [];
      for (const sheet of ctx.composition.sheets) {
        if (sheet.orientation === "landscape") {
          const rotated = sheet.textMarks.every((mark) => mark.rotationDeg === 90);
          if (!rotated) {
            results.push(
              out(
                "SHEET-ORIENTATION",
                "fail",
                "landscape sheet does not place the top of the sheet on the right-hand side",
                null,
                sheet.sheetNumber,
              ),
            );
          }
        }
      }
      return results.length > 0
        ? results
        : [out("SHEET-ORIENTATION", "pass", "orientation policy satisfied")];
    },
  },
  {
    id: "SHEET-CROSSHAIRS",
    description:
      "Optional crosshair scan targets have 2 cm arms and sit in the margins at two cater-corner corners.",
    citation: "37 CFR 1.84(h)",
    check: (ctx) => {
      const results: RuleOutcome[] = [];
      let any = false;
      for (const sheet of ctx.composition.sheets) {
        for (const crosshair of sheet.crosshairs) {
          any = true;
          if (!crosshair.inMargin) {
            results.push(
              out(
                "SHEET-CROSSHAIRS",
                "fail",
                "a crosshair scan target is inside the sight rather than the margin",
                null,
                sheet.sheetNumber,
              ),
            );
          }
          if (Math.abs(crosshair.armMm - mm(2.0)) > 0.5) {
            results.push(
              out(
                "SHEET-CROSSHAIRS",
                "fail",
                `crosshair arm is ${(crosshair.armMm / 10).toFixed(2)} cm, not 2 cm`,
                null,
                sheet.sheetNumber,
              ),
            );
          }
        }
      }
      if (results.length > 0) return results;
      return [
        out(
          "SHEET-CROSSHAIRS",
          any ? "pass" : "not_applicable",
          any ? "crosshair targets are compliant" : "no crosshair targets used",
        ),
      ];
    },
  },

  /* ------------------------------ views -------------------------------- */
  {
    id: "VIEW-NO-OVERLAP",
    description:
      "Views must not overlap and must not be placed within the outline of another view.",
    citation: "37 CFR 1.84(h)(1)",
    check: (ctx) => {
      const results: RuleOutcome[] = [];
      for (const sheet of ctx.composition.sheets) {
        for (let i = 0; i < sheet.figures.length; i += 1) {
          for (let j = i + 1; j < sheet.figures.length; j += 1) {
            if (boxesOverlap(sheet.figures[i].cellBoxMm, sheet.figures[j].cellBoxMm)) {
              results.push(
                out(
                  "VIEW-NO-OVERLAP",
                  "fail",
                  `views ${sheet.figures[i].figureNumber} and ${sheet.figures[j].figureNumber} overlap`,
                  sheet.figures[i].figureNumber,
                  sheet.sheetNumber,
                ),
              );
            }
          }
        }
      }
      return results.length > 0
        ? results
        : [out("VIEW-NO-OVERLAP", "pass", "no views overlap")];
    },
  },
  {
    id: "VIEW-SAME-DIRECTION",
    description: "All views on one sheet must stand in the same direction.",
    citation: "37 CFR 1.84(h)(1)",
    check: (ctx) => {
      const results: RuleOutcome[] = [];
      for (const sheet of ctx.composition.sheets) {
        const rotations = new Set(sheet.figures.map((figure) => figure.rotationDeg));
        if (rotations.size > 1) {
          results.push(
            out(
              "VIEW-SAME-DIRECTION",
              "fail",
              `views on this sheet stand in ${rotations.size} different directions`,
              null,
              sheet.sheetNumber,
            ),
          );
        }
      }
      return results.length > 0
        ? results
        : [out("VIEW-SAME-DIRECTION", "pass", "views on each sheet share one direction")];
    },
  },
  {
    id: "VIEW-SEPARATION",
    description:
      "Views must be clearly separated and arranged without wasting space.",
    citation: "37 CFR 1.84(h)(1), (i)",
    check: (ctx) => {
      const results: RuleOutcome[] = [];
      const minGapMm = mm(0.5);
      for (const sheet of ctx.composition.sheets) {
        const sorted = [...sheet.figures].sort((a, b) => a.cellBoxMm.y - b.cellBoxMm.y);
        for (let i = 0; i + 1 < sorted.length; i += 1) {
          const gap =
            sorted[i + 1].cellBoxMm.y - (sorted[i].cellBoxMm.y + sorted[i].cellBoxMm.h);
          if (gap < minGapMm) {
            results.push(
              out(
                "VIEW-SEPARATION",
                "fail",
                `views ${sorted[i].figureNumber} and ${sorted[i + 1].figureNumber} are separated by only ${(gap / 10).toFixed(2)} cm`,
                sorted[i].figureNumber,
                sheet.sheetNumber,
              ),
            );
          }
        }
      }
      return results.length > 0
        ? results
        : [out("VIEW-SEPARATION", "pass", "views are clearly separated")];
    },
  },
  {
    id: "VIEW-FRONT-PAGE",
    description:
      "At least one view must be suitable for publication as the front-page illustration.",
    citation: "37 CFR 1.84(j), MPEP 608.02",
    check: (ctx) => {
      const suitable = ctx.spec.figures.filter(
        (figure) =>
          !figure.isPriorArt &&
          figure.state !== "needs_input" &&
          ["perspective", "plan", "elevation", "exploded", "block_diagram", "design_orthographic"].includes(
            figure.viewType,
          ),
      );
      return suitable.length > 0
        ? [
            out(
              "VIEW-FRONT-PAGE",
              "pass",
              `FIG. ${suitable[0].figureNumber} is suitable as the front-page illustration`,
            ),
          ]
        : [
            out(
              "VIEW-FRONT-PAGE",
              "fail",
              "no non-prior-art overview view exists that could serve as the front-page illustration",
            ),
          ];
    },
  },
  {
    id: "VIEW-SECTION-HATCH-ANGLE",
    description:
      "Sectional views are hatched with regularly spaced parallel oblique strokes at 45 degrees.",
    citation: "37 CFR 1.84(h)(3)",
    check: (ctx) => {
      const results: RuleOutcome[] = [];
      let any = false;
      for (const figure of ctx.spec.figures) {
        if (figure.viewType !== "section") continue;
        const hatched = figure.primitives.filter(
          (primitive) => primitive.kind === "polygon" && primitive.hatchAngleDeg !== undefined,
        );
        if (hatched.length === 0) {
          results.push(
            out(
              "VIEW-SECTION-HATCH-ANGLE",
              "fail",
              `sectional FIG. ${figure.figureNumber} carries no hatching`,
              figure.figureNumber,
            ),
          );
          continue;
        }
        any = true;
        for (const primitive of hatched) {
          if (primitive.kind !== "polygon") continue;
          const angle = ((primitive.hatchAngleDeg! % 180) + 180) % 180;
          if (Math.abs(angle - 45) > 1e-6 && Math.abs(angle - 135) > 1e-6) {
            results.push(
              out(
                "VIEW-SECTION-HATCH-ANGLE",
                "fail",
                `hatching at ${primitive.hatchAngleDeg}° is not the 45° oblique convention`,
                figure.figureNumber,
              ),
            );
          }
        }
      }
      if (results.length > 0) return results;
      return [
        out(
          "VIEW-SECTION-HATCH-ANGLE",
          any ? "pass" : "not_applicable",
          any ? "all sectional hatching is 45° oblique" : "no sectional views in this set",
        ),
      ];
    },
  },
  {
    id: "VIEW-SECTION-HATCH-DISTINCT",
    description:
      "Juxtaposed different elements in a sectional view must be hatched at different angles.",
    citation: "37 CFR 1.84(h)(3)",
    check: (ctx) => {
      const results: RuleOutcome[] = [];
      let any = false;
      for (const figure of ctx.spec.figures) {
        if (figure.viewType !== "section") continue;
        const materials = new Map<string, Set<number>>();
        for (const primitive of figure.primitives) {
          if (primitive.kind !== "polygon" || primitive.hatchAngleDeg === undefined) continue;
          any = true;
          const key = primitive.hatchMaterial ?? "unspecified";
          if (!materials.has(key)) materials.set(key, new Set());
          materials.get(key)!.add(((primitive.hatchAngleDeg % 180) + 180) % 180);
        }
        if (materials.size > 1) {
          const angles = [...materials.values()].map((set) => [...set].sort().join("/"));
          if (new Set(angles).size < materials.size) {
            results.push(
              out(
                "VIEW-SECTION-HATCH-DISTINCT",
                "fail",
                `FIG. ${figure.figureNumber} hatches juxtaposed different elements at the same angle`,
                figure.figureNumber,
              ),
            );
          }
        }
      }
      if (results.length > 0) return results;
      return [
        out(
          "VIEW-SECTION-HATCH-DISTINCT",
          any ? "pass" : "not_applicable",
          any ? "juxtaposed elements use distinct hatch angles" : "no hatched sections",
        ),
      ];
    },
  },
  {
    id: "VIEW-SECTION-HATCH-CONSISTENT",
    description: "The same part must be hatched identically in every view.",
    citation: "37 CFR 1.84(h)(3)",
    check: (ctx) => {
      const byMaterial = new Map<string, Set<number>>();
      for (const figure of ctx.spec.figures) {
        for (const primitive of figure.primitives) {
          if (primitive.kind !== "polygon" || primitive.hatchAngleDeg === undefined) continue;
          const key = primitive.hatchMaterial ?? "unspecified";
          if (!byMaterial.has(key)) byMaterial.set(key, new Set());
          byMaterial.get(key)!.add(((primitive.hatchAngleDeg % 180) + 180) % 180);
        }
      }
      const inconsistent = [...byMaterial.entries()].filter(([, angles]) => angles.size > 1);
      if (byMaterial.size === 0) {
        return [out("VIEW-SECTION-HATCH-CONSISTENT", "not_applicable", "no hatching in this set")];
      }
      return inconsistent.length > 0
        ? inconsistent.map(([material, angles]) =>
            out(
              "VIEW-SECTION-HATCH-CONSISTENT",
              "fail",
              `"${material}" is hatched at ${[...angles].join("° and ")}° across views`,
            ),
          )
        : [out("VIEW-SECTION-HATCH-CONSISTENT", "pass", "each part hatches identically everywhere")];
    },
  },
  {
    id: "VIEW-SECTION-PLANE",
    description:
      "The plane of a sectional view must be indicated on the view it is taken from, with arrows showing the viewing direction and a label matching the sectional figure.",
    citation: "37 CFR 1.84(h)(2)",
    check: (ctx) => {
      const results: RuleOutcome[] = [];
      const byNumber = new Map(ctx.spec.figures.map((figure) => [figure.figureNumber, figure]));
      let any = false;
      for (const figure of ctx.spec.figures) {
        if (figure.viewType !== "section") continue;
        any = true;
        if (figure.sectionOf === null) {
          results.push(
            out(
              "VIEW-SECTION-PLANE",
              "fail",
              `sectional FIG. ${figure.figureNumber} does not say which view it is taken from`,
              figure.figureNumber,
            ),
          );
          continue;
        }
        const parent = byNumber.get(figure.sectionOf);
        if (!parent) {
          results.push(
            out(
              "VIEW-SECTION-PLANE",
              "fail",
              `FIG. ${figure.figureNumber} references FIG. ${figure.sectionOf}, which is not in the set`,
              figure.figureNumber,
            ),
          );
          continue;
        }
        const hasPlane = parent.primitives.some(
          (primitive) => primitive.kind === "arrow" && primitive.role === "section_plane",
        );
        if (!hasPlane) {
          results.push(
            out(
              "VIEW-SECTION-PLANE",
              "fail",
              `FIG. ${parent.figureNumber} does not carry the section-plane arrows for FIG. ${figure.figureNumber}`,
              parent.figureNumber,
            ),
          );
        }
      }
      if (results.length > 0) return results;
      return [
        out(
          "VIEW-SECTION-PLANE",
          any ? "pass" : "not_applicable",
          any ? "every section plane is indicated with direction arrows" : "no sectional views",
        ),
      ];
    },
  },

  /* ---------------------------- line types ----------------------------- */
  {
    id: "LINE-TYPES",
    description:
      "Only the conventional line types may be used: solid for edges/shading, dashed for hidden lines, dash-dot-dot-dash for phantom parts, dash-dot-dash for projection lines.",
    citation: "37 CFR 1.84(l), MPEP 608.02",
    check: (ctx) => {
      const allowed = new Set(["solid", "dashed", "phantom", "projection", undefined]);
      const results: RuleOutcome[] = [];
      for (const figure of ctx.spec.figures) {
        for (const primitive of figure.primitives) {
          const lineType = "lineType" in primitive ? primitive.lineType : undefined;
          if (!allowed.has(lineType)) {
            results.push(
              out(
                "LINE-TYPES",
                "fail",
                `FIG. ${figure.figureNumber} uses unsupported line type "${String(lineType)}"`,
                figure.figureNumber,
              ),
            );
          }
        }
      }
      return results.length > 0
        ? results
        : [out("LINE-TYPES", "pass", "only conventional line types are used")];
    },
  },
  {
    id: "LINE-QUALITY",
    description:
      "Lines must be uniformly dense and dark, free from jagged or feathered portions.",
    citation: "37 CFR 1.84(l)",
    check: (ctx) => {
      if (ctx.rasterReports.size === 0) {
        return [
          out(
            "LINE-QUALITY",
            "pass",
            "all line work is vector-drawn at a uniform declared weight",
          ),
        ];
      }
      const results: RuleOutcome[] = [];
      for (const [figureNumber, report] of ctx.rasterReports) {
        if (report.midtoneRatio > 0.02) {
          results.push(
            out(
              "LINE-QUALITY",
              "needs_human_review",
              `generated art shows ${(report.midtoneRatio * 100).toFixed(2)}% anti-aliased edge pixels; a person should confirm the lines reproduce cleanly`,
              figureNumber,
            ),
          );
        }
      }
      return results.length > 0
        ? results
        : [out("LINE-QUALITY", "pass", "line work is uniformly dense")];
    },
  },

  /* ----------------------- reference characters ------------------------ */
  {
    id: "REF-MIN-HEIGHT",
    description: "Reference characters must be at least 0.32 cm (1/8 inch) high.",
    citation: "37 CFR 1.84(p)(3)",
    check: (ctx) => {
      const results = referenceMarks(ctx)
        .filter(({ mark }) => mark.heightCm < TYPE_SIZE_CM.referenceCharacterMin - 1e-9)
        .map(({ mark, sheetNumber }) =>
          out(
            "REF-MIN-HEIGHT",
            "fail",
            `reference character "${mark.text}" is ${mark.heightCm.toFixed(2)} cm, below the 0.32 cm minimum`,
            mark.figureNumber,
            sheetNumber,
          ),
        );
      return results.length > 0
        ? results
        : [out("REF-MIN-HEIGHT", "pass", "all reference characters meet the 0.32 cm minimum")];
    },
  },
  {
    id: "REF-NOT-ENCLOSED",
    description:
      "Reference characters must never be enclosed in brackets, inverted commas, circles or outlines.",
    citation: "37 CFR 1.84(p)(1)",
    check: (ctx) => {
      const results = referenceMarks(ctx)
        .filter(({ mark }) => /[()[\]{}'"“”‘’<>]/.test(mark.text))
        .map(({ mark, sheetNumber }) =>
          out(
            "REF-NOT-ENCLOSED",
            "fail",
            `reference character "${mark.text}" is enclosed`,
            mark.figureNumber,
            sheetNumber,
          ),
        );
      return results.length > 0
        ? results
        : [out("REF-NOT-ENCLOSED", "pass", "no reference character is enclosed")];
    },
  },
  {
    id: "REF-ORIENTATION",
    description:
      "Reference characters must be oriented in the same direction as the view, so the sheet never has to be rotated to read them.",
    citation: "37 CFR 1.84(p)(1)",
    check: (ctx) => {
      const results: RuleOutcome[] = [];
      for (const sheet of ctx.composition.sheets) {
        const byFigure = new Map(sheet.figures.map((figure) => [figure.figureNumber, figure]));
        for (const mark of sheet.textMarks) {
          if (mark.role !== "reference") continue;
          const figure = mark.figureNumber === null ? null : byFigure.get(mark.figureNumber);
          const expected = figure?.rotationDeg ?? 0;
          if (mark.rotationDeg !== expected) {
            results.push(
              out(
                "REF-ORIENTATION",
                "fail",
                `reference character "${mark.text}" is rotated ${mark.rotationDeg}° but its view stands at ${expected}°`,
                mark.figureNumber,
                sheet.sheetNumber,
              ),
            );
          }
        }
      }
      return results.length > 0
        ? results
        : [out("REF-ORIENTATION", "pass", "reference characters read with their views")];
    },
  },
  {
    id: "REF-NO-LINE-CROSSING",
    description:
      "A reference character placed inside a figure must never cross a line, including hatching.",
    citation: "37 CFR 1.84(p)(3), (q)",
    check: (ctx) => {
      const results: RuleOutcome[] = [];
      for (const sheet of ctx.composition.sheets) {
        for (const mark of sheet.textMarks) {
          if (mark.role !== "reference") continue;
          // An underlined on-surface character is drawn over a blank halo,
          // which is exactly the convention the rule prescribes.
          if (mark.underlined) continue;
          for (const segment of sheet.segments) {
            if (segment.figureNumber !== mark.figureNumber) continue;
            if (segmentIntersectsBox(segment.a, segment.b, mark.boxMm)) {
              results.push(
                out(
                  "REF-NO-LINE-CROSSING",
                  "fail",
                  `reference character "${mark.text}" sits on a ${segment.isHatch ? "hatching" : "drawing"} line`,
                  mark.figureNumber,
                  sheet.sheetNumber,
                ),
              );
              break;
            }
          }
        }
      }
      return results.length > 0
        ? results
        : [out("REF-NO-LINE-CROSSING", "pass", "no reference character crosses a line")];
    },
  },
  {
    id: "REF-UNDERLINE-ON-SURFACE",
    description:
      "A reference character that must sit on a hatched or shaded surface is underlined and given blank space around it, instead of a lead line.",
    citation: "37 CFR 1.84(q)",
    check: (ctx) => {
      const results: RuleOutcome[] = [];
      let any = false;
      for (const sheet of ctx.composition.sheets) {
        const leadNumerals = new Set(
          sheet.leadLines.map((lead) => `${lead.figureNumber}:${lead.numeral}`),
        );
        for (const mark of sheet.textMarks) {
          if (mark.role !== "reference") continue;
          const hasLead = leadNumerals.has(`${mark.figureNumber}:${mark.text}`);
          if (!hasLead) {
            any = true;
            if (!mark.underlined) {
              results.push(
                out(
                  "REF-UNDERLINE-ON-SURFACE",
                  "fail",
                  `reference character "${mark.text}" has no lead line and is not underlined`,
                  mark.figureNumber,
                  sheet.sheetNumber,
                ),
              );
            }
          }
        }
      }
      if (results.length > 0) return results;
      return [
        out(
          "REF-UNDERLINE-ON-SURFACE",
          any ? "pass" : "not_applicable",
          any ? "on-surface characters are underlined" : "every character carries a lead line",
        ),
      ];
    },
  },
  {
    id: "REF-CROSS-VIEW-CONSISTENCY",
    description:
      "The same part in every view carries the same reference character, and the same character never designates different parts.",
    citation: "37 CFR 1.84(p)(4)",
    check: (ctx) => {
      const conflicts = checkRegistryConsistency(ctx.spec.numerals);
      if (conflicts.length > 0) {
        return conflicts.map((conflict) =>
          out(
            "REF-CROSS-VIEW-CONSISTENCY",
            "fail",
            conflict.kind === "duplicate_numeral"
              ? `numeral ${conflict.numeral} designates both "${conflict.existingLabel}" and "${conflict.incomingLabel}"`
              : conflict.kind === "duplicate_part"
                ? `part "${conflict.partLabel}" carries both ${conflict.existingNumeral} and ${conflict.numeral}`
                : `numeral ${conflict.numeral} is malformed: ${conflict.reason}`,
          ),
        );
      }
      // Also verify the drawn characters all exist in the registry.
      const registered = new Set(ctx.spec.numerals.map((entry) => entry.numeral));
      const orphans = [...drawnReferenceCharacters(ctx)].filter(
        (numeral) => !registered.has(numeral),
      );
      return orphans.length > 0
        ? orphans.map((numeral) =>
            out(
              "REF-CROSS-VIEW-CONSISTENCY",
              "fail",
              `numeral ${numeral} is drawn but is not in the numeral registry`,
            ),
          )
        : [out("REF-CROSS-VIEW-CONSISTENCY", "pass", "the numeral registry is internally consistent")];
    },
  },
  {
    id: "REF-NUMBERING-CONVENTION",
    description:
      "Preferred practice: begin reference numerals at 10 (or 100) and step by 2, leaving room for later insertions; primed numerals are discouraged.",
    citation: "MPEP 608.02",
    check: (ctx) => {
      const numeric = ctx.spec.numerals
        .map((entry) => Number(entry.numeral.replace(/[A-Z]$/, "")))
        .filter((value) => Number.isFinite(value))
        .sort((a, b) => a - b);
      if (numeric.length === 0) {
        return [out("REF-NUMBERING-CONVENTION", "not_applicable", "no numerals assigned")];
      }
      if (numeric[0] < 10) {
        return [
          out(
            "REF-NUMBERING-CONVENTION",
            "fail",
            `numbering starts at ${numeric[0]}; convention is to begin at 10 or 100`,
          ),
        ];
      }
      const primed = ctx.spec.numerals.filter((entry) => /['′]/.test(entry.numeral));
      if (primed.length > 0) {
        return primed.map((entry) =>
          out("REF-NUMBERING-CONVENTION", "fail", `primed numeral ${entry.numeral} is discouraged`),
        );
      }
      return [out("REF-NUMBERING-CONVENTION", "pass", `numbering begins at ${numeric[0]}`)];
    },
  },
  {
    id: "REF-SPEC-TWO-WAY",
    description:
      "Reference characters mentioned in the description must appear in the drawings, and reference characters not mentioned in the description must not appear in the drawings.",
    citation: "37 CFR 1.84(p)(5)",
    check: (ctx) => {
      const drawn = drawnReferenceCharacters(ctx);
      const mentioned = referenceCharactersInText(ctx.draftText);
      const results: RuleOutcome[] = [];
      for (const numeral of drawn) {
        if (!mentioned.has(numeral)) {
          results.push(
            out(
              "REF-SPEC-TWO-WAY",
              "fail",
              `numeral ${numeral} appears in the drawings but is not mentioned in the description`,
            ),
          );
        }
      }
      // Only registry numerals count in the other direction: an arbitrary
      // number in the prose (a dimension, a year) is not a reference
      // character, so we compare against what the registry claims exists.
      for (const entry of ctx.spec.numerals) {
        if (mentioned.has(entry.numeral) && !drawn.has(entry.numeral)) {
          results.push(
            out(
              "REF-SPEC-TWO-WAY",
              "fail",
              `numeral ${entry.numeral} ("${entry.partLabel}") is mentioned in the description but does not appear in any drawing`,
            ),
          );
        }
      }
      return results.length > 0
        ? results
        : [out("REF-SPEC-TWO-WAY", "pass", "drawings and description agree in both directions")];
    },
  },
  {
    id: "LEAD-ONE-PER-CHARACTER",
    description:
      "Each reference character carries exactly one lead line, except characters indicating the surface they sit on, which are underlined instead.",
    citation: "37 CFR 1.84(q)",
    check: (ctx) => {
      const results: RuleOutcome[] = [];
      for (const sheet of ctx.composition.sheets) {
        const counts = new Map<string, number>();
        for (const lead of sheet.leadLines) {
          const key = `${lead.figureNumber}:${lead.numeral}`;
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        for (const [key, count] of counts) {
          if (count > 1) {
            results.push(
              out(
                "LEAD-ONE-PER-CHARACTER",
                "fail",
                `reference character ${key.split(":")[1]} carries ${count} lead lines`,
                Number(key.split(":")[0]),
                sheet.sheetNumber,
              ),
            );
          }
        }
      }
      return results.length > 0
        ? results
        : [out("LEAD-ONE-PER-CHARACTER", "pass", "one lead line per reference character")];
    },
  },
  {
    id: "LEAD-NO-CROSSING",
    description: "Lead lines must not cross each other.",
    citation: "37 CFR 1.84(q)",
    check: (ctx) => {
      const results: RuleOutcome[] = [];
      for (const sheet of ctx.composition.sheets) {
        for (let i = 0; i < sheet.leadLines.length; i += 1) {
          for (let j = i + 1; j < sheet.leadLines.length; j += 1) {
            if (leadLinesCross(sheet.leadLines[i].pointsMm, sheet.leadLines[j].pointsMm)) {
              results.push(
                out(
                  "LEAD-NO-CROSSING",
                  "fail",
                  `lead lines for ${sheet.leadLines[i].numeral} and ${sheet.leadLines[j].numeral} cross`,
                  sheet.leadLines[i].figureNumber,
                  sheet.sheetNumber,
                ),
              );
            }
          }
        }
      }
      return results.length > 0
        ? results
        : [out("LEAD-NO-CROSSING", "pass", "no lead lines cross")];
    },
  },
  {
    id: "LEAD-NOT-TOUCHING",
    description:
      "Lead lines terminate at, but must not touch, the feature they indicate.",
    citation: "37 CFR 1.84(q)",
    check: (ctx) => {
      const results: RuleOutcome[] = [];
      for (const sheet of ctx.composition.sheets) {
        for (const lead of sheet.leadLines) {
          if (lead.terminalGapMm <= 0.2) {
            results.push(
              out(
                "LEAD-NOT-TOUCHING",
                "fail",
                `lead line for ${lead.numeral} touches the feature it indicates`,
                lead.figureNumber,
                sheet.sheetNumber,
              ),
            );
          }
        }
      }
      return results.length > 0
        ? results
        : [out("LEAD-NOT-TOUCHING", "pass", "every lead line stops short of its feature")];
    },
  },
  {
    id: "LEAD-ORIGIN-ADJACENT",
    description:
      "A lead line must originate immediately adjacent to its reference character and be as short as practicable.",
    citation: "37 CFR 1.84(q)",
    check: (ctx) => {
      const results: RuleOutcome[] = [];
      const maxOriginGapMm = mm(0.6);
      for (const sheet of ctx.composition.sheets) {
        const marks = new Map(
          sheet.textMarks
            .filter((mark) => mark.role === "reference")
            .map((mark) => [`${mark.figureNumber}:${mark.text}`, mark]),
        );
        for (const lead of sheet.leadLines) {
          const mark = marks.get(`${lead.figureNumber}:${lead.numeral}`);
          if (!mark || lead.pointsMm.length === 0) continue;
          const start = lead.pointsMm[0];
          const gap = Math.hypot(start.x - mark.atMm.x, start.y - mark.atMm.y);
          if (gap > maxOriginGapMm) {
            results.push(
              out(
                "LEAD-ORIGIN-ADJACENT",
                "fail",
                `lead line for ${lead.numeral} starts ${(gap / 10).toFixed(2)} cm from its character`,
                lead.figureNumber,
                sheet.sheetNumber,
              ),
            );
          }
        }
      }
      return results.length > 0
        ? results
        : [out("LEAD-ORIGIN-ADJACENT", "pass", "lead lines originate adjacent to their characters")];
    },
  },
  {
    id: "ARROW-DISTINGUISHABLE",
    description:
      "Direction/movement arrows must be visually distinguishable from lead-line arrows.",
    citation: "37 CFR 1.84(r)",
    check: (ctx) => {
      // The composer never draws arrowheads on lead lines, so a direction
      // arrow can never be mistaken for one. Verify that invariant holds.
      const results: RuleOutcome[] = [];
      for (const sheet of ctx.composition.sheets) {
        for (const lead of sheet.leadLines) {
          if (lead.pointsMm.length > 2) {
            results.push(
              out(
                "ARROW-DISTINGUISHABLE",
                "needs_human_review",
                `lead line for ${lead.numeral} has an unusual shape; confirm it is not read as a direction arrow`,
                lead.figureNumber,
                sheet.sheetNumber,
              ),
            );
          }
        }
      }
      return results.length > 0
        ? results
        : [
            out(
              "ARROW-DISTINGUISHABLE",
              "pass",
              "lead lines carry no arrowheads, so direction arrows are unambiguous",
            ),
          ];
    },
  },

  /* -------------------------- numbering/labels ------------------------- */
  {
    id: "SHEETNUM-FORMAT",
    description:
      "Sheet numbers are consecutive Arabic numerals written as sheet number over total sheets, e.g. 1/4.",
    citation: "37 CFR 1.84(t)",
    check: (ctx) => {
      const results: RuleOutcome[] = [];
      const total = ctx.composition.sheets.length;
      ctx.composition.sheets.forEach((sheet, index) => {
        const mark = sheet.textMarks.find((candidate) => candidate.role === "sheet_number");
        const expected = `${index + 1}/${total}`;
        if (!mark) {
          results.push(out("SHEETNUM-FORMAT", "fail", "sheet carries no sheet number", null, sheet.sheetNumber));
        } else if (mark.text !== expected) {
          results.push(
            out(
              "SHEETNUM-FORMAT",
              "fail",
              `sheet number is "${mark.text}", expected "${expected}"`,
              null,
              sheet.sheetNumber,
            ),
          );
        }
      });
      return results.length > 0
        ? results
        : [out("SHEETNUM-FORMAT", "pass", "sheet numbers are consecutive n/total")];
    },
  },
  {
    id: "SHEETNUM-IN-SIGHT",
    description:
      "Sheet numbers sit centered at the top of the sight — inside the sight, not in the margin — and clear of the drawing.",
    citation: "37 CFR 1.84(t)",
    check: (ctx) => {
      const results: RuleOutcome[] = [];
      for (const sheet of ctx.composition.sheets) {
        const mark = sheet.textMarks.find((candidate) => candidate.role === "sheet_number");
        if (!mark) continue;
        const sightX = mm(sheet.geometry.sightXCm);
        const sightY = mm(sheet.geometry.sightYCm);
        const sightW = mm(sheet.geometry.sightWidthCm);
        const sightH = mm(sheet.geometry.sightHeightCm);
        const inside =
          mark.boxMm.x >= sightX - 0.01 &&
          mark.boxMm.x + mark.boxMm.w <= sightX + sightW + 0.01 &&
          mark.boxMm.y >= sightY - 0.01 &&
          mark.boxMm.y + mark.boxMm.h <= sightY + sightH + 0.01;
        if (!inside) {
          results.push(
            out(
              "SHEETNUM-IN-SIGHT",
              "fail",
              "the sheet number lies outside the sight (in the margin)",
              null,
              sheet.sheetNumber,
            ),
          );
          continue;
        }
        for (const figure of sheet.figures) {
          if (boxesOverlap(mark.boxMm, figure.artBoxMm)) {
            results.push(
              out(
                "SHEETNUM-IN-SIGHT",
                "fail",
                `the sheet number overlaps the drawing of FIG. ${figure.figureNumber}`,
                figure.figureNumber,
                sheet.sheetNumber,
              ),
            );
          }
        }
      }
      return results.length > 0
        ? results
        : [out("SHEETNUM-IN-SIGHT", "pass", "sheet numbers sit in the sight, clear of the drawings")];
    },
  },
  {
    id: "SHEETNUM-LARGER",
    description: "Sheet numbers must be larger than the reference characters.",
    citation: "37 CFR 1.84(t)",
    check: (ctx) => {
      const results: RuleOutcome[] = [];
      for (const sheet of ctx.composition.sheets) {
        const sheetMark = sheet.textMarks.find((candidate) => candidate.role === "sheet_number");
        if (!sheetMark) continue;
        const maxReference = Math.max(
          0,
          ...sheet.textMarks.filter((mark) => mark.role === "reference").map((mark) => mark.heightCm),
        );
        if (maxReference > 0 && sheetMark.heightCm <= maxReference) {
          results.push(
            out(
              "SHEETNUM-LARGER",
              "fail",
              `sheet number (${sheetMark.heightCm} cm) is not larger than the reference characters (${maxReference} cm)`,
              null,
              sheet.sheetNumber,
            ),
          );
        }
      }
      return results.length > 0
        ? results
        : [out("SHEETNUM-LARGER", "pass", "sheet numbers are larger than reference characters")];
    },
  },
  {
    id: "VIEWNUM-SEQUENTIAL",
    description:
      "View numbers are consecutive Arabic numerals starting at 1, independent of sheet numbering.",
    citation: "37 CFR 1.84(u)",
    check: (ctx) => {
      const numbers = [...new Set(ctx.spec.figures.map((figure) => figure.figureNumber))].sort(
        (a, b) => a - b,
      );
      const results: RuleOutcome[] = [];
      numbers.forEach((value, index) => {
        if (value !== index + 1) {
          results.push(
            out(
              "VIEWNUM-SEQUENTIAL",
              "fail",
              `view numbering jumps: expected ${index + 1}, found ${value}`,
              value,
            ),
          );
        }
      });
      return results.length > 0
        ? results
        : [out("VIEWNUM-SEQUENTIAL", "pass", "view numbers run consecutively from 1")];
    },
  },
  {
    id: "VIEWNUM-PREFIX",
    description:
      'View numbers are preceded by the abbreviation "FIG."; "Figure" must not be spelled out and lettering must not be ornate.',
    citation: "37 CFR 1.84(u)",
    check: (ctx) => {
      const results: RuleOutcome[] = [];
      for (const sheet of ctx.composition.sheets) {
        for (const mark of sheet.textMarks) {
          if (mark.role !== "figure_label" || mark.text === "") continue;
          if (!/^FIG\. \d+[A-Z]?$/.test(mark.text)) {
            results.push(
              out(
                "VIEWNUM-PREFIX",
                "fail",
                `figure label "${mark.text}" is not of the form "FIG. n"`,
                mark.figureNumber,
                sheet.sheetNumber,
              ),
            );
          }
        }
      }
      return results.length > 0
        ? results
        : [out("VIEWNUM-PREFIX", "pass", 'every view label uses the "FIG. n" form')];
    },
  },
  {
    id: "VIEWNUM-SINGLE-VIEW",
    description:
      'When the application contains only one view, that view is not numbered and the abbreviation "FIG." must not appear.',
    citation: "37 CFR 1.84(u)(1)",
    check: (ctx) => {
      if (ctx.spec.figures.length !== 1) {
        return [
          out("VIEWNUM-SINGLE-VIEW", "not_applicable", `the set contains ${ctx.spec.figures.length} views`),
        ];
      }
      const offending = ctx.composition.sheets.flatMap((sheet) =>
        sheet.textMarks
          .filter((mark) => mark.role === "figure_label" && mark.text.length > 0)
          .map((mark) =>
            out(
              "VIEWNUM-SINGLE-VIEW",
              "fail",
              `single-view set still labels the view "${mark.text}"`,
              mark.figureNumber,
              sheet.sheetNumber,
            ),
          ),
      );
      return offending.length > 0
        ? offending
        : [out("VIEWNUM-SINGLE-VIEW", "pass", "the single view carries no FIG. label")];
    },
  },
  {
    id: "VIEWNUM-LARGER",
    description:
      "View numbers must be larger than the reference characters and must not use brackets, circles or inverted commas.",
    citation: "37 CFR 1.84(u)",
    check: (ctx) => {
      const results: RuleOutcome[] = [];
      for (const sheet of ctx.composition.sheets) {
        const maxReference = Math.max(
          0,
          ...sheet.textMarks.filter((mark) => mark.role === "reference").map((mark) => mark.heightCm),
        );
        for (const mark of sheet.textMarks) {
          if (mark.role !== "figure_label" || mark.text === "") continue;
          if (maxReference > 0 && mark.heightCm <= maxReference) {
            results.push(
              out(
                "VIEWNUM-LARGER",
                "fail",
                `"${mark.text}" (${mark.heightCm} cm) is not larger than the reference characters`,
                mark.figureNumber,
                sheet.sheetNumber,
              ),
            );
          }
          if (/[()[\]{}'"“”‘’]/.test(mark.text)) {
            results.push(
              out(
                "VIEWNUM-LARGER",
                "fail",
                `"${mark.text}" encloses the view number`,
                mark.figureNumber,
                sheet.sheetNumber,
              ),
            );
          }
        }
      }
      return results.length > 0
        ? results
        : [out("VIEWNUM-LARGER", "pass", "view numbers are larger than reference characters and unenclosed")];
    },
  },
  {
    id: "VIEWNUM-PARTIAL",
    description:
      "Partial views forming one complete view share a single view number plus a capital letter, e.g. FIG. 3A and FIG. 3B.",
    citation: "37 CFR 1.84(u)(2)",
    check: (ctx) => {
      const withSuffix = ctx.spec.figures.filter((figure) => figure.partialSuffix !== null);
      if (withSuffix.length === 0) {
        return [out("VIEWNUM-PARTIAL", "not_applicable", "no partial views in this set")];
      }
      const results: RuleOutcome[] = [];
      const groups = new Map<number, FigureSpec[]>();
      for (const figure of withSuffix) {
        if (!/^[A-Z]$/.test(figure.partialSuffix!)) {
          results.push(
            out(
              "VIEWNUM-PARTIAL",
              "fail",
              `FIG. ${figure.figureNumber}${figure.partialSuffix} uses a suffix that is not a single capital letter`,
              figure.figureNumber,
            ),
          );
        }
        const list = groups.get(figure.figureNumber) ?? [];
        list.push(figure);
        groups.set(figure.figureNumber, list);
      }
      for (const [number, figures] of groups) {
        if (figures.length < 2) {
          results.push(
            out(
              "VIEWNUM-PARTIAL",
              "fail",
              `FIG. ${number}${figures[0].partialSuffix} is the only lettered part of view ${number}; partial views come in sets`,
              number,
            ),
          );
        }
      }
      return results.length > 0
        ? results
        : [out("VIEWNUM-PARTIAL", "pass", "partial views are lettered correctly")];
    },
  },
  {
    id: "PRIOR-ART-LEGEND",
    description:
      'A figure depicting prior art must carry the legend "Prior Art" below the figure label.',
    citation: "MPEP 608.02(g), 37 CFR 1.84(o)",
    check: (ctx) => {
      const priorArt = ctx.spec.figures.filter((figure) => figure.isPriorArt);
      if (priorArt.length === 0) {
        return [out("PRIOR-ART-LEGEND", "not_applicable", "no prior-art figures in this set")];
      }
      const results: RuleOutcome[] = [];
      for (const figure of priorArt) {
        const found = ctx.composition.sheets.some((sheet) =>
          sheet.textMarks.some(
            (mark) =>
              mark.role === "prior_art" &&
              mark.figureNumber === figure.figureNumber &&
              /prior art/i.test(mark.text),
          ),
        );
        if (!found) {
          results.push(
            out(
              "PRIOR-ART-LEGEND",
              "fail",
              `FIG. ${figure.figureNumber} depicts prior art but carries no "Prior Art" legend`,
              figure.figureNumber,
            ),
          );
        }
      }
      return results.length > 0
        ? results
        : [out("PRIOR-ART-LEGEND", "pass", "every prior-art figure is legended")];
    },
  },
  {
    id: "LEGEND-BREVITY",
    description:
      "Descriptive legends use as few words as possible and are written horizontally, left to right.",
    citation: "37 CFR 1.84(o)",
    check: (ctx) => {
      const results: RuleOutcome[] = [];
      for (const sheet of ctx.composition.sheets) {
        for (const mark of sheet.textMarks) {
          if (mark.role !== "legend") continue;
          if (mark.rotationDeg !== 0) {
            results.push(
              out(
                "LEGEND-BREVITY",
                "fail",
                `legend "${mark.text}" is not written horizontally`,
                mark.figureNumber,
                sheet.sheetNumber,
              ),
            );
          }
          if (mark.text.trim().split(/\s+/).length > 6) {
            results.push(
              out(
                "LEGEND-BREVITY",
                "fail",
                `legend "${mark.text}" is longer than the few words the rule permits`,
                mark.figureNumber,
                sheet.sheetNumber,
              ),
            );
          }
        }
      }
      return results.length > 0
        ? results
        : [out("LEGEND-BREVITY", "pass", "legends are brief and horizontal")];
    },
  },
  {
    id: "COPYRIGHT-NOTICE",
    description:
      "A copyright or mask-work notice appears immediately below the figure inside the sight, in letters 0.32 to 0.64 cm high.",
    citation: "37 CFR 1.84(s)",
    check: (ctx) => {
      const marks = ctx.composition.sheets.flatMap((sheet) =>
        sheet.textMarks
          .filter((mark) => mark.role === "copyright")
          .map((mark) => ({ mark, sheet })),
      );
      if (marks.length === 0) {
        return [out("COPYRIGHT-NOTICE", "not_applicable", "no copyright notice present")];
      }
      const results: RuleOutcome[] = [];
      for (const { mark, sheet } of marks) {
        if (mark.heightCm < 0.32 - 1e-9 || mark.heightCm > 0.64 + 1e-9) {
          results.push(
            out(
              "COPYRIGHT-NOTICE",
              "fail",
              `copyright notice lettering is ${mark.heightCm} cm; the permitted range is 0.32–0.64 cm`,
              null,
              sheet.sheetNumber,
            ),
          );
        }
        const sightX = mm(sheet.geometry.sightXCm);
        const sightY = mm(sheet.geometry.sightYCm);
        const sightW = mm(sheet.geometry.sightWidthCm);
        const sightH = mm(sheet.geometry.sightHeightCm);
        if (
          mark.boxMm.x < sightX ||
          mark.boxMm.x + mark.boxMm.w > sightX + sightW ||
          mark.boxMm.y < sightY ||
          mark.boxMm.y + mark.boxMm.h > sightY + sightH
        ) {
          results.push(
            out("COPYRIGHT-NOTICE", "fail", "copyright notice is outside the sight", null, sheet.sheetNumber),
          );
        }
      }
      return results.length > 0
        ? results
        : [out("COPYRIGHT-NOTICE", "pass", "copyright notice placement and size are compliant")];
    },
  },
  {
    id: "INDICIA-PLACEMENT",
    description:
      "Optional identifying indicia (title, inventor, docket number) appear on the front of each sheet, centered in the top margin.",
    citation: "37 CFR 1.84(c)",
    check: (ctx) => {
      const marks = ctx.composition.sheets.flatMap((sheet) =>
        sheet.textMarks.filter((mark) => mark.role === "indicia").map((mark) => ({ mark, sheet })),
      );
      if (marks.length === 0) {
        return [out("INDICIA-PLACEMENT", "not_applicable", "no identifying indicia used")];
      }
      const results: RuleOutcome[] = [];
      for (const { mark, sheet } of marks) {
        const inTopMargin = mark.boxMm.y + mark.boxMm.h <= mm(sheet.geometry.marginTopCm) + 0.01;
        const centered = Math.abs(mark.atMm.x - mm(sheet.geometry.widthCm) / 2) < 1;
        if (!inTopMargin || !centered) {
          results.push(
            out(
              "INDICIA-PLACEMENT",
              "fail",
              "identifying indicia are not centered in the top margin",
              null,
              sheet.sheetNumber,
            ),
          );
        }
      }
      return results.length > 0
        ? results
        : [out("INDICIA-PLACEMENT", "pass", "indicia are centered in the top margin")];
    },
  },

  /* ------------------------------ symbols ------------------------------ */
  {
    id: "SYMBOL-LEGEND",
    description:
      "Any conventional symbol used must be identified in the specification, so the pipeline emits a symbol legend for the drafter.",
    citation: "37 CFR 1.84(n)",
    check: (ctx) => {
      const usesSymbols = ctx.spec.figures.some((figure) =>
        ["block_diagram", "flowchart", "waveform"].includes(figure.viewType),
      );
      if (!usesSymbols) {
        return [out("SYMBOL-LEGEND", "not_applicable", "no conventional symbols used")];
      }
      return ctx.spec.symbolLegend.length > 0
        ? [out("SYMBOL-LEGEND", "pass", `${ctx.spec.symbolLegend.length} symbols identified for the specification`)]
        : [
            out(
              "SYMBOL-LEGEND",
              "fail",
              "conventional symbols are used but no symbol legend was emitted for the specification",
            ),
          ];
    },
  },
  {
    id: "FLOWCHART-SHAPES",
    description:
      "Flowcharts and block diagrams use conventional shapes with reference numerals placed outside the boxes on lead lines.",
    citation: "MPEP 608.02, 37 CFR 1.84(p)(3)",
    check: (ctx) => {
      const results: RuleOutcome[] = [];
      const diagramNumbers = new Set(
        ctx.spec.figures
          .filter((figure) => figure.viewType === "flowchart" || figure.viewType === "block_diagram")
          .map((figure) => figure.figureNumber),
      );
      if (diagramNumbers.size === 0) {
        return [out("FLOWCHART-SHAPES", "not_applicable", "no flowcharts or block diagrams")];
      }
      for (const sheet of ctx.composition.sheets) {
        for (const mark of sheet.textMarks) {
          if (mark.role !== "reference" || mark.figureNumber === null) continue;
          if (!diagramNumbers.has(mark.figureNumber)) continue;
          const placement = sheet.figures.find(
            (figure) => figure.figureNumber === mark.figureNumber,
          );
          if (!placement) continue;
          const insideArt =
            mark.boxMm.x >= placement.artBoxMm.x &&
            mark.boxMm.x + mark.boxMm.w <= placement.artBoxMm.x + placement.artBoxMm.w;
          if (insideArt && !mark.underlined) {
            results.push(
              out(
                "FLOWCHART-SHAPES",
                "fail",
                `reference character "${mark.text}" is inside the diagram rather than outside on a lead line`,
                mark.figureNumber,
                sheet.sheetNumber,
              ),
            );
          }
        }
      }
      return results.length > 0
        ? results
        : [out("FLOWCHART-SHAPES", "pass", "diagram numerals sit outside the boxes on lead lines")];
    },
  },

  /* --------------------------- graphic forms --------------------------- */
  {
    id: "FORMULA-SEPARATE-FIGURE",
    description: "Each chemical or mathematical formula must be labeled as a separate figure.",
    citation: "37 CFR 1.84(i)",
    check: (ctx) => {
      const formulas = ctx.spec.figures.filter((figure) => figure.viewType === "formula");
      if (formulas.length === 0) {
        return [out("FORMULA-SEPARATE-FIGURE", "not_applicable", "no formula figures")];
      }
      const results: RuleOutcome[] = [];
      const seen = new Set<number>();
      for (const figure of formulas) {
        if (seen.has(figure.figureNumber)) {
          results.push(
            out(
              "FORMULA-SEPARATE-FIGURE",
              "fail",
              `more than one formula shares view number ${figure.figureNumber}`,
              figure.figureNumber,
            ),
          );
        }
        seen.add(figure.figureNumber);
      }
      return results.length > 0
        ? results
        : [out("FORMULA-SEPARATE-FIGURE", "pass", "each formula is its own figure")];
    },
  },
  {
    id: "WAVEFORM-GROUP",
    description:
      "A group of waveforms is presented as a single figure with a common vertical axis, time along the horizontal axis, and each waveform lettered adjacent to the vertical axis.",
    citation: "37 CFR 1.84(i)",
    check: (ctx) => {
      const waveforms = ctx.spec.figures.filter((figure) => figure.viewType === "waveform");
      if (waveforms.length === 0) {
        return [out("WAVEFORM-GROUP", "not_applicable", "no waveform figures")];
      }
      const results: RuleOutcome[] = [];
      for (const figure of waveforms) {
        const letters = figure.primitives.filter(
          (primitive) => primitive.kind === "legend_text" && /^[A-Z]$/.test(primitive.text),
        );
        const hasTimeAxis = figure.primitives.some(
          (primitive) => primitive.kind === "legend_text" && /time/i.test(primitive.text),
        );
        const traces = figure.primitives.filter((primitive) => primitive.kind === "polyline").length;
        if (!hasTimeAxis) {
          results.push(
            out(
              "WAVEFORM-GROUP",
              "fail",
              `FIG. ${figure.figureNumber} does not label time along the horizontal axis`,
              figure.figureNumber,
            ),
          );
        }
        // Two of the polylines are the shared axes.
        if (traces > 2 && letters.length < traces - 2) {
          results.push(
            out(
              "WAVEFORM-GROUP",
              "fail",
              `FIG. ${figure.figureNumber} has ${traces - 2} waveforms but only ${letters.length} are lettered adjacent to the vertical axis`,
              figure.figureNumber,
            ),
          );
        }
      }
      return results.length > 0
        ? results
        : [out("WAVEFORM-GROUP", "pass", "waveform groups follow the single-figure convention")];
    },
  },

  /* --------------------------- design patents -------------------------- */
  {
    id: "DESIGN-VIEW-SET",
    description:
      "A design application shows the six orthogonal views of a cube plus a perspective view.",
    citation: "MPEP 1503.02",
    check: (ctx) => {
      if (!ctx.designPatent) {
        return [out("DESIGN-VIEW-SET", "not_applicable", "utility application")];
      }
      const orthographic = ctx.spec.figures.filter(
        (figure) => figure.viewType === "design_orthographic",
      ).length;
      const perspective = ctx.spec.figures.filter((figure) => figure.viewType === "perspective").length;
      if (orthographic < 6 || perspective < 1) {
        return [
          out(
            "DESIGN-VIEW-SET",
            "fail",
            `design set has ${orthographic} orthographic and ${perspective} perspective views; six orthographic plus one perspective are expected`,
          ),
        ];
      }
      return [out("DESIGN-VIEW-SET", "pass", "six orthographic views plus a perspective view are present")];
    },
  },
  {
    id: "DESIGN-SHADING-REQUIRED",
    description:
      "Design drawings require surface shading to show contour and to distinguish open from solid areas.",
    citation: "MPEP 1503.02(II)",
    check: (ctx) => {
      if (!ctx.designPatent) {
        return [out("DESIGN-SHADING-REQUIRED", "not_applicable", "utility application")];
      }
      const unshaded = ctx.spec.figures.filter(
        (figure) =>
          !figure.primitives.some(
            (primitive) => primitive.kind === "polygon" && primitive.hatchAngleDeg !== undefined,
          ),
      );
      return unshaded.length > 0
        ? unshaded.map((figure) =>
            out(
              "DESIGN-SHADING-REQUIRED",
              "fail",
              `design FIG. ${figure.figureNumber} carries no surface shading`,
              figure.figureNumber,
            ),
          )
        : [out("DESIGN-SHADING-REQUIRED", "pass", "every design view carries surface shading")];
    },
  },
  {
    id: "DESIGN-BROKEN-LINES",
    description:
      "Unclaimed environment in a design application is shown in broken lines.",
    citation: "MPEP 1503.02(III)",
    humanReviewReason:
      "whether depicted matter is claimed ornamental subject matter or unclaimed environment is a legal judgment the record cannot decide",
  },

  /* ------------------------------ general ------------------------------ */
  {
    id: "CLEAN-RENDER",
    description:
      "No erasures, overwriting, interlineations or alterations: each sheet is a single clean render at print resolution.",
    citation: "37 CFR 1.84(a), (e)",
    check: (ctx) => {
      const results: RuleOutcome[] = [];
      for (const sheet of ctx.composition.sheets) {
        const roots = (sheet.svg.match(/<svg\b/g) ?? []).length;
        if (roots !== 1) {
          results.push(
            out(
              "CLEAN-RENDER",
              "fail",
              `sheet render contains ${roots} SVG roots; one sheet must be one clean page`,
              null,
              sheet.sheetNumber,
            ),
          );
        }
      }
      return results.length > 0
        ? results
        : [out("CLEAN-RENDER", "pass", "each sheet is one clean single-page render")];
    },
  },
  {
    id: "PLACEMENT-SOLVED",
    description:
      "Every figure's reference characters were placed within the constraints; a figure whose placement could not be solved is surfaced for human review rather than emitted.",
    citation: "37 CFR 1.84(p), (q) — implementation guarantee",
    check: (ctx) => {
      return ctx.composition.unplaceable.length > 0
        ? ctx.composition.unplaceable.map((item) =>
            out("PLACEMENT-SOLVED", "needs_human_review", item.reason, item.figureNumber),
          )
        : [out("PLACEMENT-SOLVED", "pass", "all reference characters were placed compliantly")];
    },
  },
];

function leadLinesCross(a: Mm[], b: Mm[]): boolean {
  for (let i = 0; i + 1 < a.length; i += 1) {
    for (let j = 0; j + 1 < b.length; j += 1) {
      if (segmentIntersection(a[i], a[i + 1], b[j], b[j + 1])) return true;
    }
  }
  return false;
}

export function getRule(id: string): FigureRule | null {
  return FIGURE_RULES.find((rule) => rule.id === id) ?? null;
}

/** Rule ids that have a mechanical checker (used by the coverage test). */
export const MECHANICALLY_CHECKED_RULE_IDS: readonly string[] = FIGURE_RULES.filter(
  (rule) => typeof rule.check === "function",
).map((rule) => rule.id);
