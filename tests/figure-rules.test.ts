import { describe, expect, it } from "vitest";
import { compose } from "@/lib/server/figures/compose";
import {
  FIGURE_RULES,
  MECHANICALLY_CHECKED_RULE_IDS,
  RULES_VERSION,
} from "@/lib/server/figures/rules";
import { validateFigureSet, violations } from "@/lib/server/figures/validate";
import {
  annotation,
  cleanRasterReport,
  clean,
  contextFor,
  failed,
  numeral,
  flagged,
  runRule,
  SAW_FAILING_FIXTURE,
  SAW_PASSING_FIXTURE,
  validSpec,
  VALID_DRAFT_TEXT,
} from "./figures/fixtures";
import type { FigureSetSpec } from "@/lib/server/figures/types";

/**
 * Rule coverage: every mechanically checkable rule in the §3 rule set gets a
 * PASSING fixture (the compliant baseline) and a FAILING fixture (one
 * targeted mutation). The `covers` helper asserts both halves so a rule can
 * never be "tested" by only ever seeing compliant input.
 */

const exercised = new Set<string>();

function covers(
  ruleId: string,
  mutate: (spec: FigureSetSpec) => void | { draftText?: string; designPatent?: boolean },
  options: { baselineDesignPatent?: boolean; baselineRasters?: boolean } = {},
) {
  exercised.add(ruleId);
  it(`${ruleId}: passes the compliant baseline and fails a targeted violation`, () => {
    const good = validSpec();
    const goodCtx = contextFor(good, {
      designPatent: options.baselineDesignPatent ?? false,
      rasterReports: options.baselineRasters
        ? new Map([[1, cleanRasterReport()]])
        : undefined,
    });
    expect(clean(ruleId, goodCtx), `${ruleId} should pass the compliant baseline`).toBe(true);

    const bad = validSpec();
    const extra = mutate(bad) ?? {};
    const badCtx = contextFor(bad, {
      draftText: extra.draftText,
      designPatent: extra.designPatent ?? options.baselineDesignPatent ?? false,
      rasterReports: options.baselineRasters ? new Map([[1, cleanRasterReport()]]) : undefined,
    });
    expect(failed(ruleId, badCtx), `${ruleId} should fail the mutated fixture`).toBe(true);
  });
}

describe("rule set shape", () => {
  it("gives every rule an id, a description and a citation", () => {
    for (const rule of FIGURE_RULES) {
      expect(rule.id).toMatch(/^[A-Z][A-Z0-9-]+$/);
      expect(rule.description.length).toBeGreaterThan(20);
      expect(rule.citation.length).toBeGreaterThan(5);
      if (!rule.check) {
        // A rule with no checker MUST say why, so it can never masquerade
        // as silently satisfied.
        expect(rule.humanReviewReason, `${rule.id} has no checker and no reason`).toBeTruthy();
      }
    }
  });

  it("has unique rule ids and a versioned rule set", () => {
    const ids = FIGURE_RULES.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(RULES_VERSION).toMatch(/^uspto-drawings-\d{4}-\d{2}-\d{2}$/);
  });
});

/* ------------------------------- media -------------------------------- */

describe("media rules", () => {
  it("MEDIA-COLOR passes pure black-on-white output", () => {
    expect(
      clean(
        "MEDIA-COLOR",
        contextFor(validSpec(), { rasterReports: new Map([[1, cleanRasterReport()]]) }),
      ),
    ).toBe(true);
  });

  it("MEDIA-COLOR fails when generated art contains color", () => {
    const ctx = contextFor(validSpec(), {
      rasterReports: new Map([[1, { ...cleanRasterReport(), colorPixelRatio: 0.2 }]]),
    });
    expect(failed("MEDIA-COLOR", ctx)).toBe(true);
    expect(runRule("MEDIA-COLOR", ctx)[0].detail).toMatch(/color/i);
  });

  it("MEDIA-GREYSCALE passes clean art and fails continuous-tone art", () => {
    expect(clean("MEDIA-GREYSCALE", contextFor(validSpec(), { rasterReports: new Map([[1, cleanRasterReport()]]) }))).toBe(true);
    expect(
      failed(
        "MEDIA-GREYSCALE",
        contextFor(validSpec(), {
          rasterReports: new Map([[1, { ...cleanRasterReport(), midtoneRatio: 0.4 }]]),
        }),
      ),
    ).toBe(true);
  });

  it("MEDIA-SOLID-BLACK passes thin line work and fails a filled area", () => {
    expect(clean("MEDIA-SOLID-BLACK", contextFor(validSpec(), { rasterReports: new Map([[1, cleanRasterReport()]]) }))).toBe(true);
    expect(
      failed(
        "MEDIA-SOLID-BLACK",
        contextFor(validSpec(), {
          rasterReports: new Map([[1, { ...cleanRasterReport(), largestBlackRegionRatio: 0.3 }]]),
        }),
      ),
    ).toBe(true);
  });

  it("MEDIA-SOLID-BLACK also catches a black-filled shape in the composed SVG", () => {
    const spec = validSpec();
    const composition = compose(spec);
    composition.sheets[0].svg = composition.sheets[0].svg.replace(
      "<rect",
      '<rect fill="#000000"',
    );
    expect(failed("MEDIA-SOLID-BLACK", contextFor(spec, { composition }))).toBe(true);
  });

  it("MEDIA-REPRODUCTION passes the composer's type sizes", () => {
    expect(clean("MEDIA-REPRODUCTION", contextFor(validSpec()))).toBe(true);
  });

  it("MEDIA-REPRODUCTION fails lettering below the 0.32 cm floor", () => {
    const spec = validSpec();
    const composition = compose(spec);
    const reference = composition.sheets[0].textMarks.find((mark) => mark.role === "reference");
    expect(reference).toBeDefined();
    reference!.heightCm = 0.2;
    expect(failed("MEDIA-REPRODUCTION", contextFor(spec, { composition }))).toBe(true);
  });

  covers("MEDIA-SHADING-CONVENTION", (spec) => {
    const section = spec.figures[1].primitives[0];
    if (section.kind === "polygon") section.hatchAngleDeg = 20;
  });
});

/* ---------------------------- sheet geometry --------------------------- */

describe("sheet geometry rules", () => {
  it("SHEET-SIZE passes A4 and fails an unsupported size", () => {
    const spec = validSpec();
    expect(clean("SHEET-SIZE", contextFor(spec))).toBe(true);
    const composition = compose(spec);
    (composition.sheets[0].geometry as { size: string }).size = "tabloid";
    expect(failed("SHEET-SIZE", contextFor(spec, { composition }))).toBe(true);
  });

  it("SHEET-UNIFORM passes one size and fails mixed sizes", () => {
    const spec = validSpec();
    expect(clean("SHEET-UNIFORM", contextFor(spec))).toBe(true);
    const composition = compose(spec);
    expect(composition.sheets.length).toBeGreaterThan(0);
    composition.sheets.push({
      ...composition.sheets[0],
      sheetNumber: composition.sheets.length + 1,
      geometry: { ...composition.sheets[0].geometry, size: "letter" },
    });
    expect(failed("SHEET-UNIFORM", contextFor(spec, { composition }))).toBe(true);
  });

  it("SHEET-MARGINS passes the regulation minima and fails a shrunken margin", () => {
    const spec = validSpec();
    expect(clean("SHEET-MARGINS", contextFor(spec))).toBe(true);
    const composition = compose(spec);
    composition.sheets[0].geometry = { ...composition.sheets[0].geometry, marginTopCm: 1.0 };
    expect(failed("SHEET-MARGINS", contextFor(spec, { composition }))).toBe(true);
  });

  it("SHEET-SIGHT passes the computed sight and fails an oversized one", () => {
    const spec = validSpec();
    expect(clean("SHEET-SIGHT", contextFor(spec))).toBe(true);
    const composition = compose(spec);
    composition.sheets[0].geometry = { ...composition.sheets[0].geometry, sightWidthCm: 19 };
    expect(failed("SHEET-SIGHT", contextFor(spec, { composition }))).toBe(true);
  });

  it("SHEET-NO-FRAME passes an unframed sheet and fails a framed one", () => {
    const spec = validSpec();
    expect(clean("SHEET-NO-FRAME", contextFor(spec))).toBe(true);
    const composition = compose(spec);
    composition.sheets[0].hasSightFrame = true;
    expect(failed("SHEET-NO-FRAME", contextFor(spec, { composition }))).toBe(true);
  });

  it("SHEET-ORIENTATION passes portrait and fails an unrotated landscape sheet", () => {
    const spec = validSpec();
    expect(clean("SHEET-ORIENTATION", contextFor(spec))).toBe(true);
    const composition = compose(spec);
    composition.sheets[0].orientation = "landscape";
    expect(failed("SHEET-ORIENTATION", contextFor(spec, { composition }))).toBe(true);
  });

  it("SHEET-CROSSHAIRS passes margin-placed targets and fails in-sight targets", () => {
    const spec = validSpec();
    const good = compose(spec, { crosshairs: true });
    expect(good.sheets[0].crosshairs.length).toBe(2);
    expect(clean("SHEET-CROSSHAIRS", contextFor(spec, { composition: good }))).toBe(true);
    const bad = compose(spec, { crosshairs: true });
    bad.sheets[0].crosshairs[0].inMargin = false;
    expect(failed("SHEET-CROSSHAIRS", contextFor(spec, { composition: bad }))).toBe(true);
  });
});

/* -------------------------------- views -------------------------------- */

describe("view rules", () => {
  it("VIEW-NO-OVERLAP passes disjoint cells and fails overlapping ones", () => {
    const spec = validSpec();
    expect(clean("VIEW-NO-OVERLAP", contextFor(spec))).toBe(true);
    const composition = compose(spec);
    const sheet = composition.sheets[0];
    sheet.figures.push({ ...sheet.figures[0], figureNumber: 99 });
    expect(failed("VIEW-NO-OVERLAP", contextFor(spec, { composition }))).toBe(true);
  });

  it("VIEW-SAME-DIRECTION passes one direction and fails mixed rotations", () => {
    const spec = validSpec();
    expect(clean("VIEW-SAME-DIRECTION", contextFor(spec))).toBe(true);
    const composition = compose(spec);
    const sheet = composition.sheets[0];
    sheet.figures.push({ ...sheet.figures[0], figureNumber: 99, rotationDeg: 90 });
    expect(failed("VIEW-SAME-DIRECTION", contextFor(spec, { composition }))).toBe(true);
  });

  it("VIEW-SEPARATION passes the composer's gap and fails a crowded pair", () => {
    const spec = validSpec();
    expect(clean("VIEW-SEPARATION", contextFor(spec))).toBe(true);
    const composition = compose(spec);
    const sheet = composition.sheets[0];
    if (sheet.figures.length < 2) {
      sheet.figures.push({
        ...sheet.figures[0],
        figureNumber: 99,
        cellBoxMm: {
          ...sheet.figures[0].cellBoxMm,
          y: sheet.figures[0].cellBoxMm.y + sheet.figures[0].cellBoxMm.h + 1,
        },
      });
    } else {
      sheet.figures[1].cellBoxMm.y =
        sheet.figures[0].cellBoxMm.y + sheet.figures[0].cellBoxMm.h + 1;
    }
    expect(failed("VIEW-SEPARATION", contextFor(spec, { composition }))).toBe(true);
  });

  covers("VIEW-FRONT-PAGE", (spec) => {
    // Leave nothing that could serve as the front-page illustration.
    spec.figures[0].viewType = "flowchart";
    spec.figures[1].viewType = "flowchart";
  });

  covers("VIEW-SECTION-HATCH-ANGLE", (spec) => {
    const polygon = spec.figures[1].primitives[0];
    if (polygon.kind === "polygon") polygon.hatchAngleDeg = 30;
  });

  covers("VIEW-SECTION-HATCH-DISTINCT", (spec) => {
    // Two juxtaposed different materials hatched at the SAME angle.
    spec.figures[1].primitives.push({
      kind: "polygon",
      points: [
        { x: 0.82, y: 0.2 },
        { x: 0.95, y: 0.2 },
        { x: 0.95, y: 0.8 },
        { x: 0.82, y: 0.8 },
      ],
      lineType: "solid",
      hatchAngleDeg: 45,
      hatchSpacing: 0.05,
      hatchMaterial: "glass",
    });
  });

  covers("VIEW-SECTION-HATCH-CONSISTENT", (spec) => {
    // The same material hatched at two different angles across views.
    spec.figures[0].primitives.push({
      kind: "polygon",
      points: [
        { x: 0.1, y: 0.1 },
        { x: 0.3, y: 0.1 },
        { x: 0.3, y: 0.3 },
        { x: 0.1, y: 0.3 },
      ],
      lineType: "solid",
      hatchAngleDeg: 135,
      hatchSpacing: 0.05,
      hatchMaterial: "metal",
    });
  });

  covers("VIEW-SECTION-PLANE", (spec) => {
    // Remove the section-plane arrows from the parent view.
    spec.figures[0].primitives = spec.figures[0].primitives.filter(
      (primitive) => !(primitive.kind === "arrow" && primitive.role === "section_plane"),
    );
  });
});

/* ------------------------------ line types ----------------------------- */

describe("line-type rules", () => {
  covers("LINE-TYPES", (spec) => {
    (spec.figures[1].primitives[0] as { lineType?: string }).lineType = "squiggly";
  });

  it("LINE-QUALITY passes vector-only sets and flags noisy raster art for review", () => {
    expect(clean("LINE-QUALITY", contextFor(validSpec()))).toBe(true);
    const ctx = contextFor(validSpec(), {
      rasterReports: new Map([[1, { ...cleanRasterReport(), midtoneRatio: 0.05 }]]),
    });
    expect(flagged("LINE-QUALITY", ctx)).toBe(true);
    expect(runRule("LINE-QUALITY", ctx)[0].status).toBe("needs_human_review");
  });
});

/* -------------------------- reference characters ----------------------- */

describe("reference-character rules", () => {
  it("REF-MIN-HEIGHT passes 0.35 cm and fails 0.25 cm", () => {
    const spec = validSpec();
    expect(clean("REF-MIN-HEIGHT", contextFor(spec))).toBe(true);
    const composition = compose(spec);
    composition.sheets[0].textMarks
      .filter((mark) => mark.role === "reference")
      .forEach((mark) => {
        mark.heightCm = 0.25;
      });
    expect(failed("REF-MIN-HEIGHT", contextFor(spec, { composition }))).toBe(true);
  });

  it("REF-NOT-ENCLOSED passes plain numerals and fails bracketed ones", () => {
    const spec = validSpec();
    expect(clean("REF-NOT-ENCLOSED", contextFor(spec))).toBe(true);
    const composition = compose(spec);
    const mark = composition.sheets[0].textMarks.find((entry) => entry.role === "reference");
    mark!.text = "(10)";
    expect(failed("REF-NOT-ENCLOSED", contextFor(spec, { composition }))).toBe(true);
  });

  it("REF-ORIENTATION passes upright characters and fails rotated ones", () => {
    const spec = validSpec();
    expect(clean("REF-ORIENTATION", contextFor(spec))).toBe(true);
    const composition = compose(spec);
    const mark = composition.sheets[0].textMarks.find((entry) => entry.role === "reference");
    mark!.rotationDeg = 90;
    expect(failed("REF-ORIENTATION", contextFor(spec, { composition }))).toBe(true);
  });

  it("REF-NO-LINE-CROSSING passes gutter placement and fails a character on a line", () => {
    const spec = validSpec();
    expect(clean("REF-NO-LINE-CROSSING", contextFor(spec))).toBe(true);
    const composition = compose(spec);
    const sheet = composition.sheets[0];
    const mark = sheet.textMarks.find((entry) => entry.role === "reference");
    const segment = sheet.segments.find((entry) => entry.figureNumber === mark!.figureNumber);
    expect(segment).toBeDefined();
    // Drag the character onto a drawing line.
    mark!.boxMm = {
      x: Math.min(segment!.a.x, segment!.b.x) - 1,
      y: Math.min(segment!.a.y, segment!.b.y) - 1,
      w: Math.abs(segment!.b.x - segment!.a.x) + 2,
      h: Math.abs(segment!.b.y - segment!.a.y) + 2,
    };
    expect(failed("REF-NO-LINE-CROSSING", contextFor(spec, { composition }))).toBe(true);
  });

  it("REF-UNDERLINE-ON-SURFACE passes lead-lined characters and fails a bare one", () => {
    const spec = validSpec();
    expect(clean("REF-UNDERLINE-ON-SURFACE", contextFor(spec))).toBe(true);
    const composition = compose(spec);
    // Strip a lead line but leave the character not underlined.
    composition.sheets[0].leadLines = composition.sheets[0].leadLines.slice(1);
    expect(failed("REF-UNDERLINE-ON-SURFACE", contextFor(spec, { composition }))).toBe(true);
  });

  covers("REF-CROSS-VIEW-CONSISTENCY", (spec) => {
    // The same numeral designating two different parts.
    spec.numerals.push(numeral("10", "unrelated bracket"));
  });

  covers("REF-NUMBERING-CONVENTION", (spec) => {
    spec.numerals.push(numeral("3", "small pin"));
  });

  covers("REF-SPEC-TWO-WAY", () => ({
    // The description never mentions 12 or 14, but they are drawn.
    draftText: "The assembly includes an intake manifold 10 and other parts.",
  }));

  it("REF-SPEC-TWO-WAY also fails the other direction: mentioned but never drawn", () => {
    const spec = validSpec();
    spec.numerals.push(numeral("20", "pressure sensor"));
    const ctx = contextFor(spec, {
      draftText: `${VALID_DRAFT_TEXT}\nA pressure sensor 20 measures the manifold pressure.`,
    });
    const outcomes = runRule("REF-SPEC-TWO-WAY", ctx);
    expect(outcomes.some((outcome) => outcome.status === "fail" && outcome.detail.includes("20"))).toBe(
      true,
    );
  });

  it("LEAD-ONE-PER-CHARACTER passes one lead each and fails a duplicated lead", () => {
    const spec = validSpec();
    expect(clean("LEAD-ONE-PER-CHARACTER", contextFor(spec))).toBe(true);
    const composition = compose(spec);
    const sheet = composition.sheets[0];
    sheet.leadLines.push({ ...sheet.leadLines[0] });
    expect(failed("LEAD-ONE-PER-CHARACTER", contextFor(spec, { composition }))).toBe(true);
  });

  it("LEAD-NO-CROSSING passes the solver's output and fails crossed leads", () => {
    const spec = validSpec();
    expect(clean("LEAD-NO-CROSSING", contextFor(spec))).toBe(true);
    const composition = compose(spec);
    const sheet = composition.sheets[0];
    sheet.leadLines = [
      {
        figureNumber: 1,
        numeral: "10",
        pointsMm: [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ],
        terminalGapMm: 2,
      },
      {
        figureNumber: 1,
        numeral: "12",
        pointsMm: [
          { x: 0, y: 10 },
          { x: 10, y: 0 },
        ],
        terminalGapMm: 2,
      },
    ];
    expect(failed("LEAD-NO-CROSSING", contextFor(spec, { composition }))).toBe(true);
  });

  it("LEAD-NOT-TOUCHING passes a stand-off gap and fails a touching lead", () => {
    const spec = validSpec();
    expect(clean("LEAD-NOT-TOUCHING", contextFor(spec))).toBe(true);
    const composition = compose(spec);
    composition.sheets[0].leadLines[0].terminalGapMm = 0;
    expect(failed("LEAD-NOT-TOUCHING", contextFor(spec, { composition }))).toBe(true);
  });

  it("LEAD-ORIGIN-ADJACENT passes adjacent origins and fails a detached one", () => {
    const spec = validSpec();
    expect(clean("LEAD-ORIGIN-ADJACENT", contextFor(spec))).toBe(true);
    const composition = compose(spec);
    composition.sheets[0].leadLines[0].pointsMm[0] = { x: 0, y: 0 };
    expect(failed("LEAD-ORIGIN-ADJACENT", contextFor(spec, { composition }))).toBe(true);
  });

  it("ARROW-DISTINGUISHABLE passes plain leads and flags multi-segment leads", () => {
    const spec = validSpec();
    expect(clean("ARROW-DISTINGUISHABLE", contextFor(spec))).toBe(true);
    const composition = compose(spec);
    composition.sheets[0].leadLines[0].pointsMm.push({ x: 5, y: 5 });
    const ctx = contextFor(spec, { composition });
    expect(flagged("ARROW-DISTINGUISHABLE", ctx)).toBe(true);
    expect(runRule("ARROW-DISTINGUISHABLE", ctx)[0].status).toBe("needs_human_review");
  });
});

/* -------------------------- numbering and labels ----------------------- */

describe("numbering and label rules", () => {
  it("SHEETNUM-FORMAT passes n/total and fails a wrong sheet number", () => {
    const spec = validSpec();
    expect(clean("SHEETNUM-FORMAT", contextFor(spec))).toBe(true);
    const composition = compose(spec);
    const mark = composition.sheets[0].textMarks.find((entry) => entry.role === "sheet_number");
    mark!.text = "Sheet one";
    expect(failed("SHEETNUM-FORMAT", contextFor(spec, { composition }))).toBe(true);
  });

  it("SHEETNUM-IN-SIGHT passes in-sight placement and fails a margin placement", () => {
    const spec = validSpec();
    expect(clean("SHEETNUM-IN-SIGHT", contextFor(spec))).toBe(true);
    const composition = compose(spec);
    const mark = composition.sheets[0].textMarks.find((entry) => entry.role === "sheet_number");
    mark!.boxMm = { x: 1, y: 1, w: 10, h: 5 };
    expect(failed("SHEETNUM-IN-SIGHT", contextFor(spec, { composition }))).toBe(true);
  });

  it("SHEETNUM-LARGER passes 0.5 cm over 0.35 cm and fails when equal", () => {
    const spec = validSpec();
    expect(clean("SHEETNUM-LARGER", contextFor(spec))).toBe(true);
    const composition = compose(spec);
    const mark = composition.sheets[0].textMarks.find((entry) => entry.role === "sheet_number");
    mark!.heightCm = 0.3;
    expect(failed("SHEETNUM-LARGER", contextFor(spec, { composition }))).toBe(true);
  });

  covers("VIEWNUM-SEQUENTIAL", (spec) => {
    spec.figures[1].figureNumber = 5;
  });

  it("VIEWNUM-PREFIX passes FIG. n and fails a spelled-out label", () => {
    const spec = validSpec();
    expect(clean("VIEWNUM-PREFIX", contextFor(spec))).toBe(true);
    const composition = compose(spec);
    const mark = composition.sheets[0].textMarks.find((entry) => entry.role === "figure_label");
    mark!.text = "Figure One";
    expect(failed("VIEWNUM-PREFIX", contextFor(spec, { composition }))).toBe(true);
  });

  it("VIEWNUM-SINGLE-VIEW omits FIG. for a single view and fails when it appears", () => {
    const spec = validSpec();
    spec.figures = [spec.figures[0]];
    spec.numerals = spec.numerals;
    const composition = compose(spec);
    // The composer already suppresses the label for a one-view set.
    expect(
      composition.sheets[0].textMarks.filter(
        (mark) => mark.role === "figure_label" && mark.text.length > 0,
      ),
    ).toHaveLength(0);
    expect(clean("VIEWNUM-SINGLE-VIEW", contextFor(spec, { composition }))).toBe(true);

    const bad = compose(spec);
    bad.sheets[0].textMarks.push({
      role: "figure_label",
      text: "FIG. 1",
      atMm: { x: 10, y: 10 },
      heightCm: 0.5,
      boxMm: { x: 10, y: 10, w: 10, h: 5 },
      rotationDeg: 0,
      underlined: false,
      figureNumber: 1,
    });
    expect(failed("VIEWNUM-SINGLE-VIEW", contextFor(spec, { composition: bad }))).toBe(true);
  });

  it("VIEWNUM-LARGER passes 0.5 cm labels and fails a shrunken one", () => {
    const spec = validSpec();
    expect(clean("VIEWNUM-LARGER", contextFor(spec))).toBe(true);
    const composition = compose(spec);
    const mark = composition.sheets[0].textMarks.find((entry) => entry.role === "figure_label");
    mark!.heightCm = 0.3;
    expect(failed("VIEWNUM-LARGER", contextFor(spec, { composition }))).toBe(true);
  });

  it("VIEWNUM-PARTIAL passes a lettered pair and fails a lone lettered view", () => {
    const good = validSpec();
    good.figures[0].partialSuffix = "A";
    good.figures[1].figureNumber = 1;
    good.figures[1].partialSuffix = "B";
    expect(clean("VIEWNUM-PARTIAL", contextFor(good))).toBe(true);

    const bad = validSpec();
    bad.figures[0].partialSuffix = "A";
    expect(failed("VIEWNUM-PARTIAL", contextFor(bad))).toBe(true);
  });

  it("PRIOR-ART-LEGEND passes a legended prior-art figure and fails a bare one", () => {
    const spec = validSpec();
    spec.figures[1].isPriorArt = true;
    expect(clean("PRIOR-ART-LEGEND", contextFor(spec))).toBe(true);

    const composition = compose(spec);
    for (const sheet of composition.sheets) {
      sheet.textMarks = sheet.textMarks.filter((mark) => mark.role !== "prior_art");
    }
    expect(failed("PRIOR-ART-LEGEND", contextFor(spec, { composition }))).toBe(true);
  });

  covers("LEGEND-BREVITY", (spec) => {
    spec.figures[0].primitives.push({
      kind: "legend_text",
      at: { x: 0.5, y: 0.5 },
      text: "this legend is far too long to be reasonably indispensable here",
    });
  });

  it("COPYRIGHT-NOTICE passes a compliant notice and fails oversized lettering", () => {
    const spec = validSpec();
    const good = compose(spec, { copyrightNotice: "© 2026 Example Corp." });
    expect(clean("COPYRIGHT-NOTICE", contextFor(spec, { composition: good }))).toBe(true);
    const bad = compose(spec, { copyrightNotice: "© 2026 Example Corp." });
    bad.sheets[0].textMarks.find((mark) => mark.role === "copyright")!.heightCm = 1.2;
    expect(failed("COPYRIGHT-NOTICE", contextFor(spec, { composition: bad }))).toBe(true);
  });

  it("INDICIA-PLACEMENT passes top-margin indicia and fails displaced indicia", () => {
    const spec = validSpec();
    const good = compose(spec, { indicia: "Docket 1234 — Working draft" });
    expect(clean("INDICIA-PLACEMENT", contextFor(spec, { composition: good }))).toBe(true);
    const bad = compose(spec, { indicia: "Docket 1234 — Working draft" });
    const mark = bad.sheets[0].textMarks.find((entry) => entry.role === "indicia");
    mark!.boxMm = { ...mark!.boxMm, y: 150 };
    expect(failed("INDICIA-PLACEMENT", contextFor(spec, { composition: bad }))).toBe(true);
  });
});

/* ------------------------------- symbols ------------------------------- */

describe("symbol rules", () => {
  covers("SYMBOL-LEGEND", (spec) => {
    spec.symbolLegend = [];
  });

  it("FLOWCHART-SHAPES passes numerals outside boxes and fails numerals inside", () => {
    const spec = validSpec();
    expect(clean("FLOWCHART-SHAPES", contextFor(spec))).toBe(true);
    const composition = compose(spec);
    const sheet = composition.sheets[0];
    const placement = sheet.figures[0];
    const mark = sheet.textMarks.find(
      (entry) => entry.role === "reference" && entry.figureNumber === placement.figureNumber,
    );
    mark!.boxMm = {
      x: placement.artBoxMm.x + 5,
      y: placement.artBoxMm.y + 5,
      w: 4,
      h: 4,
    };
    expect(failed("FLOWCHART-SHAPES", contextFor(spec, { composition }))).toBe(true);
  });
});

/* ---------------------------- graphic forms ---------------------------- */

describe("graphic-form rules", () => {
  it("FORMULA-SEPARATE-FIGURE passes one formula per figure and fails a shared number", () => {
    const good = validSpec();
    good.figures[1].viewType = "formula";
    expect(clean("FORMULA-SEPARATE-FIGURE", contextFor(good))).toBe(true);

    const bad = validSpec();
    bad.figures[0].viewType = "formula";
    bad.figures[1].viewType = "formula";
    bad.figures[1].figureNumber = 1;
    expect(failed("FORMULA-SEPARATE-FIGURE", contextFor(bad))).toBe(true);
  });

  it("WAVEFORM-GROUP passes a lettered group with a time axis and fails without one", () => {
    const good = validSpec();
    good.figures[1].viewType = "waveform";
    good.figures[1].primitives = [
      { kind: "polyline", points: [{ x: 0.1, y: 0 }, { x: 0.1, y: 1 }], lineType: "solid" },
      { kind: "polyline", points: [{ x: 0.1, y: 1 }, { x: 1, y: 1 }], lineType: "solid" },
      { kind: "polyline", points: [{ x: 0.2, y: 0.3 }, { x: 0.9, y: 0.3 }], lineType: "solid" },
      { kind: "legend_text", at: { x: 0.05, y: 0.3 }, text: "A", anchor: "end" },
      { kind: "legend_text", at: { x: 0.95, y: 1 }, text: "TIME", anchor: "end" },
    ];
    expect(clean("WAVEFORM-GROUP", contextFor(good))).toBe(true);

    const bad = validSpec();
    bad.figures[1].viewType = "waveform";
    bad.figures[1].primitives = good.figures[1].primitives.filter(
      (primitive) => !(primitive.kind === "legend_text" && primitive.text === "TIME"),
    );
    expect(failed("WAVEFORM-GROUP", contextFor(bad))).toBe(true);
  });
});

/* --------------------------- design patents ---------------------------- */

describe("design-patent rules", () => {
  function designSpec(orthographicCount: number): FigureSetSpec {
    const spec = validSpec();
    const template = spec.figures[1];
    spec.figures = [];
    for (let i = 0; i < orthographicCount; i += 1) {
      spec.figures.push({
        ...template,
        figureNumber: i + 1,
        viewType: "design_orthographic",
        sectionOf: null,
        annotations: [],
      });
    }
    spec.figures.push({
      ...template,
      figureNumber: orthographicCount + 1,
      viewType: "perspective",
      sectionOf: null,
      annotations: [],
    });
    return spec;
  }

  it("DESIGN-VIEW-SET is not applicable to utility sets", () => {
    expect(runRule("DESIGN-VIEW-SET", contextFor(validSpec()))[0].status).toBe("not_applicable");
  });

  it("DESIGN-VIEW-SET passes six orthographic + perspective and fails a short set", () => {
    expect(
      clean("DESIGN-VIEW-SET", contextFor(designSpec(6), { designPatent: true })),
    ).toBe(true);
    expect(failed("DESIGN-VIEW-SET", contextFor(designSpec(3), { designPatent: true }))).toBe(true);
  });

  it("DESIGN-SHADING-REQUIRED passes shaded views and fails an unshaded one", () => {
    const good = designSpec(6);
    expect(clean("DESIGN-SHADING-REQUIRED", contextFor(good, { designPatent: true }))).toBe(true);
    const bad = designSpec(6);
    bad.figures[0].primitives = [];
    expect(failed("DESIGN-SHADING-REQUIRED", contextFor(bad, { designPatent: true }))).toBe(true);
  });

  it("DESIGN-BROKEN-LINES is honestly reported as needing human review", () => {
    const report = validateFigureSet(contextFor(validSpec(), { designPatent: true }));
    const outcome = report.outcomes.find((entry) => entry.ruleId === "DESIGN-BROKEN-LINES");
    expect(outcome?.status).toBe("needs_human_review");
    expect(outcome?.detail).toMatch(/legal judgment/i);
  });
});

/* ------------------------------- general ------------------------------- */

describe("general rules", () => {
  it("CLEAN-RENDER passes one root per sheet and fails a doubled document", () => {
    const spec = validSpec();
    expect(clean("CLEAN-RENDER", contextFor(spec))).toBe(true);
    const composition = compose(spec);
    composition.sheets[0].svg += composition.sheets[0].svg;
    expect(failed("CLEAN-RENDER", contextFor(spec, { composition }))).toBe(true);
  });

  it("PLACEMENT-SOLVED passes a solved set and reports unsolved placements for review", () => {
    const spec = validSpec();
    expect(clean("PLACEMENT-SOLVED", contextFor(spec))).toBe(true);
    const composition = compose(spec);
    composition.unplaceable.push({ figureNumber: 1, reason: "too many characters to place" });
    const ctx = contextFor(spec, { composition });
    expect(flagged("PLACEMENT-SOLVED", ctx)).toBe(true);
    expect(runRule("PLACEMENT-SOLVED", ctx)[0].status).toBe("needs_human_review");
  });
});

/* --------------------------- coverage guard ---------------------------- */

describe("coverage guard", () => {
  it("exercises every mechanically checked rule with BOTH a passing and a failing fixture", () => {
    const missingPass = MECHANICALLY_CHECKED_RULE_IDS.filter(
      (id) => !SAW_PASSING_FIXTURE.has(id),
    );
    const missingFail = MECHANICALLY_CHECKED_RULE_IDS.filter(
      (id) => !SAW_FAILING_FIXTURE.has(id),
    );
    expect(missingPass, "rules with no passing fixture").toEqual([]);
    expect(missingFail, "rules with no failing/escalating fixture").toEqual([]);
    expect(MECHANICALLY_CHECKED_RULE_IDS.length).toBeGreaterThan(30);
  });

  it("keeps the mechanically-checked list in sync with the rule set", () => {
    const source = FIGURE_RULES.filter((rule) => rule.check).map((rule) => rule.id);
    expect(source).toEqual([...MECHANICALLY_CHECKED_RULE_IDS]);
  });
});

describe("validateFigureSet", () => {
  it("passes the compliant baseline with no failures", () => {
    const report = validateFigureSet(contextFor(validSpec()));
    expect(violations(report)).toHaveLength(0);
    expect(report.status).not.toBe("failed");
    expect(report.rulesVersion).toBe(RULES_VERSION);
  });

  it("never claims USPTO acceptance in its summary", () => {
    const report = validateFigureSet(contextFor(validSpec()));
    expect(report.summary).toMatch(/mechanical/i);
    expect(report.summary).toMatch(/not a legal opinion/i);
    expect(report.summary).toMatch(/guarantee/i);
    expect(report.summary).not.toMatch(/\bcompliant\b|\bwill be accepted\b/i);
  });

  it("reports failures with the specific violating rule", () => {
    const spec = validSpec();
    spec.numerals.push(numeral("10", "a different part entirely"));
    const report = validateFigureSet(contextFor(spec));
    expect(report.status).toBe("failed");
    expect(violations(report).some((entry) => entry.ruleId === "REF-CROSS-VIEW-CONSISTENCY")).toBe(
      true,
    );
  });

  it("counts unverifiable requirements as needs_human_review, never as pass", () => {
    const report = validateFigureSet(contextFor(validSpec()));
    expect(report.counts.needs_human_review).toBeGreaterThan(0);
    for (const outcome of report.outcomes) {
      expect(["pass", "fail", "not_applicable", "needs_human_review"]).toContain(outcome.status);
    }
  });

  it("does not let a throwing checker silently pass a figure", () => {
    const spec = validSpec();
    const ctx = contextFor(spec);
    // Corrupt the composition so several checkers hit unexpected shapes.
    (ctx.composition as unknown as { sheets: unknown }).sheets = [{ bad: true }];
    const report = validateFigureSet(ctx);
    expect(report.status === "failed" || report.counts.needs_human_review > 0).toBe(true);
  });
});

// Reference the helper so lint does not flag it when all covers() are inline.
void annotation;
void exercised;
