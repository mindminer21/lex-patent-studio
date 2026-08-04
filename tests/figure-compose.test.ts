import { describe, expect, it } from "vitest";
import {
  compose,
  figureLabel,
  hatchLines,
  segmentIntersection,
} from "@/lib/server/figures/compose";
import {
  MARGINS_CM,
  MAX_SIGHT_CM,
  SHEET_DIMENSIONS_CM,
  TYPE_SIZE_CM,
  mm,
  sheetGeometry,
} from "@/lib/server/figures/geometry";
import {
  buildBlockDiagram,
  buildFlowchart,
  buildFormulaFigure,
  buildWaveformGroup,
} from "@/lib/server/figures/diagrams";
import { validSpec } from "./figures/fixtures";
import type { FigureSpec } from "@/lib/server/figures/types";

describe("sheet geometry", () => {
  it("computes the A4 sight from the regulation minima", () => {
    const geometry = sheetGeometry("a4", "portrait");
    expect(geometry.widthCm).toBe(21.0);
    expect(geometry.heightCm).toBe(29.7);
    expect(geometry.marginTopCm).toBe(MARGINS_CM.top);
    expect(geometry.sightWidthCm).toBeCloseTo(17.0, 4);
    expect(geometry.sightHeightCm).toBeCloseTo(26.2, 4);
    expect(geometry.sightWidthCm).toBeLessThanOrEqual(MAX_SIGHT_CM.a4.widthCm);
    expect(geometry.sightHeightCm).toBeLessThanOrEqual(MAX_SIGHT_CM.a4.heightCm);
  });

  it("computes the 8.5 x 11 sight within its stated maximum", () => {
    const geometry = sheetGeometry("letter", "portrait");
    expect(geometry.widthCm).toBe(SHEET_DIMENSIONS_CM.letter.widthCm);
    expect(geometry.sightWidthCm).toBeCloseTo(17.6, 4);
    expect(geometry.sightHeightCm).toBeCloseTo(24.4, 4);
    expect(geometry.sightWidthCm).toBeLessThanOrEqual(MAX_SIGHT_CM.letter.widthCm);
    expect(geometry.sightHeightCm).toBeLessThanOrEqual(MAX_SIGHT_CM.letter.heightCm);
  });

  it("rotates the margins with the sheet in landscape", () => {
    for (const size of ["a4", "letter"] as const) {
      const portrait = sheetGeometry(size, "portrait");
      const landscape = sheetGeometry(size, "landscape");
      expect(landscape.widthCm).toBe(portrait.heightCm);
      expect(landscape.heightCm).toBe(portrait.widthCm);
      // The sight is the same physical area, turned.
      expect(landscape.sightWidthCm).toBeCloseTo(portrait.sightHeightCm, 4);
      expect(landscape.sightHeightCm).toBeCloseTo(portrait.sightWidthCm, 4);
    }
  });

  it("keeps reference characters at or above the 0.32 cm floor", () => {
    expect(TYPE_SIZE_CM.referenceCharacter).toBeGreaterThanOrEqual(
      TYPE_SIZE_CM.referenceCharacterMin,
    );
    expect(TYPE_SIZE_CM.figureLabel).toBeGreaterThan(TYPE_SIZE_CM.referenceCharacter);
    expect(TYPE_SIZE_CM.sheetNumber).toBeGreaterThan(TYPE_SIZE_CM.referenceCharacter);
  });

  it("converts cm to mm user units", () => {
    expect(mm(2.5)).toBe(25);
    expect(mm(0.32)).toBeCloseTo(3.2, 6);
  });
});

describe("composer output", () => {
  it("is deterministic: the same spec composes to identical bytes", () => {
    const a = compose(validSpec());
    const b = compose(validSpec());
    expect(a.sheets.map((sheet) => sheet.svg)).toEqual(b.sheets.map((sheet) => sheet.svg));
  });

  it("emits one well-formed SVG root per sheet with physical dimensions", () => {
    const composition = compose(validSpec());
    expect(composition.sheets.length).toBeGreaterThan(0);
    for (const sheet of composition.sheets) {
      expect((sheet.svg.match(/<svg\b/g) ?? []).length).toBe(1);
      expect(sheet.svg).toContain('width="210mm"');
      expect(sheet.svg).toContain('height="297mm"');
      expect(sheet.svg).toContain("counsel review required");
      expect(sheet.svg).toContain('role="img"');
    }
  });

  it("draws no frame around the sight", () => {
    const composition = compose(validSpec());
    for (const sheet of composition.sheets) {
      expect(sheet.hasSightFrame).toBe(false);
    }
  });

  it("numbers sheets as n/total inside the sight", () => {
    const composition = compose(validSpec());
    const total = composition.sheets.length;
    composition.sheets.forEach((sheet, index) => {
      const mark = sheet.textMarks.find((entry) => entry.role === "sheet_number");
      expect(mark?.text).toBe(`${index + 1}/${total}`);
      expect(mark!.boxMm.y).toBeGreaterThanOrEqual(mm(sheet.geometry.sightYCm) - 0.01);
    });
  });

  it("omits the FIG. label entirely for a single-view application", () => {
    const spec = validSpec();
    spec.figures = [spec.figures[0]];
    const composition = compose(spec);
    const labels = composition.sheets.flatMap((sheet) =>
      sheet.textMarks.filter((mark) => mark.role === "figure_label" && mark.text.length > 0),
    );
    expect(labels).toHaveLength(0);
    expect(figureLabel(spec.figures[0], 1)).toBe("");
    expect(figureLabel(spec.figures[0], 2)).toBe("FIG. 1");
  });

  it("labels partial views with the shared number plus a capital letter", () => {
    const spec = validSpec();
    spec.figures[0].partialSuffix = "A";
    spec.figures[1].figureNumber = 1;
    spec.figures[1].partialSuffix = "B";
    const labels = compose(spec)
      .sheets.flatMap((sheet) => sheet.textMarks)
      .filter((mark) => mark.role === "figure_label")
      .map((mark) => mark.text);
    expect(labels).toContain("FIG. 1A");
    expect(labels).toContain("FIG. 1B");
  });

  it("draws the Prior Art legend below the figure label", () => {
    const spec = validSpec();
    spec.figures[0].isPriorArt = true;
    const composition = compose(spec);
    const sheet = composition.sheets.find((candidate) =>
      candidate.textMarks.some((mark) => mark.role === "prior_art"),
    );
    expect(sheet).toBeDefined();
    const label = sheet!.textMarks.find(
      (mark) => mark.role === "figure_label" && mark.figureNumber === 1,
    );
    const legend = sheet!.textMarks.find((mark) => mark.role === "prior_art");
    expect(legend!.text).toBe("Prior Art");
    expect(legend!.atMm.y).toBeGreaterThan(label!.atMm.y);
  });

  it("never composes a needs_input figure", () => {
    const spec = validSpec();
    spec.figures[1] = {
      ...spec.figures[1],
      state: "needs_input",
      needsInput: { figureRef: "x", question: "what does it look like?", missing: "geometry" },
    };
    const composition = compose(spec);
    const drawn = composition.sheets.flatMap((sheet) => sheet.figures.map((f) => f.figureNumber));
    expect(drawn).not.toContain(2);
    expect(drawn).toContain(1);
  });
});

describe("reference-character placement solver", () => {
  it("places characters outside the art box, in the gutters", () => {
    const composition = compose(validSpec());
    for (const sheet of composition.sheets) {
      for (const mark of sheet.textMarks) {
        if (mark.role !== "reference" || mark.underlined) continue;
        const placement = sheet.figures.find((f) => f.figureNumber === mark.figureNumber);
        if (!placement) continue;
        const insideHorizontally =
          mark.atMm.x > placement.artBoxMm.x && mark.atMm.x < placement.artBoxMm.x + placement.artBoxMm.w;
        expect(insideHorizontally).toBe(false);
      }
    }
  });

  it("produces lead lines that never cross each other, even with many parts", () => {
    const nodes = Array.from({ length: 8 }, (_, index) => ({
      id: `n${index}`,
      label: `Part ${index}`,
      partLabel: `part ${index}`,
    }));
    const diagram = buildBlockDiagram(nodes, []);
    const spec = validSpec();
    spec.numerals = nodes.map((node, index) => ({
      numeral: String(10 + index * 2),
      partLabel: node.partLabel,
      componentId: null,
      firstAssignedFigureNumber: 1,
    }));
    spec.figures = [
      {
        ...spec.figures[0],
        primitives: diagram.primitives,
        annotations: diagram.anchors.map((anchor, index) => ({
          numeral: String(10 + index * 2),
          anchor: anchor.point,
          label: anchor.point,
          leadLine: [],
          underlined: false,
          placedBy: "auto" as const,
        })),
      },
    ];

    const composition = compose(spec);
    for (const sheet of composition.sheets) {
      for (let i = 0; i < sheet.leadLines.length; i += 1) {
        for (let j = i + 1; j < sheet.leadLines.length; j += 1) {
          const a = sheet.leadLines[i].pointsMm;
          const b = sheet.leadLines[j].pointsMm;
          expect(
            segmentIntersection(a[0], a[1], b[0], b[1]),
            `lead lines ${sheet.leadLines[i].numeral} and ${sheet.leadLines[j].numeral} cross`,
          ).toBeNull();
        }
      }
    }
  });

  it("stops every lead line short of the feature it points at", () => {
    const composition = compose(validSpec());
    for (const sheet of composition.sheets) {
      for (const lead of sheet.leadLines) {
        expect(lead.terminalGapMm).toBeGreaterThan(0.2);
      }
    }
  });

  it("falls back to the underlined on-surface convention when the gutter is full", () => {
    // Far more characters than gutter slots forces the fallback.
    const spec = validSpec();
    const count = 200;
    spec.numerals = Array.from({ length: count }, (_, index) => ({
      numeral: String(10 + index * 2),
      partLabel: `part ${index}`,
      componentId: null,
      firstAssignedFigureNumber: 1,
    }));
    spec.figures = [
      {
        ...spec.figures[0],
        annotations: Array.from({ length: count }, (_, index) => ({
          numeral: String(10 + index * 2),
          anchor: { x: (index % 10) / 10, y: (index % 40) / 40 },
          label: { x: 0, y: 0 },
          leadLine: [],
          underlined: false,
          placedBy: "auto" as const,
        })),
      },
    ];
    const composition = compose(spec);
    const underlined = composition.sheets
      .flatMap((sheet) => sheet.textMarks)
      .filter((mark) => mark.role === "reference" && mark.underlined);
    expect(underlined.length).toBeGreaterThan(0);
    // And the composer is honest that it could not place them all outside.
    expect(composition.unplaceable.length).toBeGreaterThan(0);
  });
});

describe("deterministic diagram builders", () => {
  it("builds a block diagram with a box and an outside anchor per node", () => {
    const diagram = buildBlockDiagram(
      [
        { id: "a", label: "Sensor", partLabel: "sensor" },
        { id: "b", label: "Processor", partLabel: "processor" },
      ],
      [{ from: "a", to: "b" }],
    );
    expect(diagram.primitives.filter((p) => p.kind === "rect")).toHaveLength(2);
    expect(diagram.primitives.filter((p) => p.kind === "arrow")).toHaveLength(1);
    expect(diagram.anchors.map((anchor) => anchor.partLabel)).toEqual(["sensor", "processor"]);
    for (const box of diagram.nodeBoxes) {
      const anchor = diagram.anchors.find((entry) => entry.partLabel === box.partLabel)!;
      // Anchors sit on the box edge, not buried inside it.
      const onEdge =
        Math.abs(anchor.point.x - box.x) < 1e-9 || Math.abs(anchor.point.x - (box.x + box.w)) < 1e-9;
      expect(onEdge).toBe(true);
    }
  });

  it("uses conventional flowchart shapes: terminal, process, decision", () => {
    const diagram = buildFlowchart(
      [
        { id: "s", label: "Start", partLabel: "start", shape: "terminal" },
        { id: "p", label: "Measure", partLabel: "measure", shape: "process" },
        { id: "d", label: "Above limit?", partLabel: "test", shape: "decision" },
        { id: "e", label: "End", partLabel: "end", shape: "terminal" },
      ],
      [],
    );
    expect(diagram.primitives.filter((p) => p.kind === "ellipse")).toHaveLength(2);
    expect(diagram.primitives.filter((p) => p.kind === "rect")).toHaveLength(1);
    expect(diagram.primitives.filter((p) => p.kind === "polygon")).toHaveLength(1);
  });

  it("draws a waveform group as one figure with a common axis and lettering", () => {
    const diagram = buildWaveformGroup([
      { letter: "A", partLabel: "clock", samples: [0, 1, 0, 1] },
      { letter: "B", partLabel: "data", samples: [1, 1, 0, 0] },
    ]);
    const legends = diagram.primitives.filter((p) => p.kind === "legend_text");
    expect(legends.some((p) => p.kind === "legend_text" && p.text === "A")).toBe(true);
    expect(legends.some((p) => p.kind === "legend_text" && p.text === "B")).toBe(true);
    expect(legends.some((p) => p.kind === "legend_text" && /time/i.test(p.text))).toBe(true);
    // Two shared axes plus one trace per waveform.
    expect(diagram.primitives.filter((p) => p.kind === "polyline")).toHaveLength(4);
  });

  it("draws a formula as horizontal legend text", () => {
    const diagram = buildFormulaFigure(["E = m c^2"]);
    expect(diagram.primitives).toHaveLength(1);
    expect(diagram.primitives[0].kind).toBe("legend_text");
  });
});

describe("hatching", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];

  it("produces regularly spaced parallel oblique strokes", () => {
    const lines = hatchLines(square, 45, 10);
    expect(lines.length).toBeGreaterThan(3);
    const angles = lines.map(([a, b]) => {
      const raw = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
      return ((raw % 180) + 180) % 180;
    });
    for (const angle of angles) expect(angle).toBeCloseTo(45, 3);
  });

  it("returns nothing for a degenerate polygon or a non-positive spacing", () => {
    expect(hatchLines([{ x: 0, y: 0 }], 45, 10)).toEqual([]);
    expect(hatchLines(square, 45, 0)).toEqual([]);
  });
});

describe("segmentIntersection", () => {
  it("finds a proper crossing and rejects parallel or disjoint segments", () => {
    expect(
      segmentIntersection({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 }),
    ).toEqual({ x: 5, y: 5 });
    expect(
      segmentIntersection({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }, { x: 10, y: 5 }),
    ).toBeNull();
    expect(
      segmentIntersection({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 5, y: 5 }, { x: 6, y: 4 }),
    ).toBeNull();
  });
});

describe("sheet packing", () => {
  it("never places two views in overlapping cells", () => {
    const spec = validSpec();
    const extra: FigureSpec[] = Array.from({ length: 5 }, (_, index) => ({
      ...spec.figures[1],
      figureNumber: 3 + index,
      sectionOf: null,
      viewType: "elevation",
      annotations: [],
    }));
    spec.figures = [...spec.figures, ...extra];
    const composition = compose(spec);
    for (const sheet of composition.sheets) {
      for (let i = 0; i < sheet.figures.length; i += 1) {
        for (let j = i + 1; j < sheet.figures.length; j += 1) {
          const a = sheet.figures[i].cellBoxMm;
          const b = sheet.figures[j].cellBoxMm;
          const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
          expect(overlap).toBe(false);
        }
      }
    }
  });

  it("keeps every cell inside the sight", () => {
    const composition = compose(validSpec());
    for (const sheet of composition.sheets) {
      const sightX = mm(sheet.geometry.sightXCm);
      const sightY = mm(sheet.geometry.sightYCm);
      const sightW = mm(sheet.geometry.sightWidthCm);
      const sightH = mm(sheet.geometry.sightHeightCm);
      for (const figure of sheet.figures) {
        expect(figure.cellBoxMm.x).toBeGreaterThanOrEqual(sightX - 0.01);
        expect(figure.cellBoxMm.y).toBeGreaterThanOrEqual(sightY - 0.01);
        expect(figure.cellBoxMm.x + figure.cellBoxMm.w).toBeLessThanOrEqual(sightX + sightW + 0.01);
        expect(figure.cellBoxMm.y + figure.cellBoxMm.h).toBeLessThanOrEqual(sightY + sightH + 0.01);
      }
    }
  });
});
