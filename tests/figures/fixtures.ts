/**
 * Shared fixtures for the patent-figure rule tests.
 *
 * `validSet()` builds a figure set that is compliant on every mechanically
 * checkable rule. Each rule test then MUTATES one thing and asserts that the
 * specific rule flips to `fail` — which is how we get a passing and a failing
 * fixture per rule without 50 hand-written scenes drifting apart.
 */
import { compose, type Composition } from "@/lib/server/figures/compose";
import { buildBlockDiagram } from "@/lib/server/figures/diagrams";
import { getRule, RULES_VERSION, type RuleOutcome, type ValidationContext } from "@/lib/server/figures/rules";
import type { RasterReport } from "@/lib/server/figures/raster";
import type {
  Annotation,
  FigureSetSpec,
  FigureSpec,
  NumeralEntry,
  Point,
} from "@/lib/server/figures/types";

export function numeral(numeralText: string, partLabel: string): NumeralEntry {
  return { numeral: numeralText, partLabel, componentId: null, firstAssignedFigureNumber: 1 };
}

export function annotation(numeralText: string, anchor: Point): Annotation {
  return {
    numeral: numeralText,
    anchor,
    label: anchor,
    leadLine: [],
    underlined: false,
    placedBy: "auto",
  };
}

/** A compliant two-figure set: a block diagram plus a sectional view. */
export function validSpec(): FigureSetSpec {
  const diagram = buildBlockDiagram(
    [
      { id: "a", label: "Intake manifold", partLabel: "intake manifold" },
      { id: "b", label: "Controller", partLabel: "controller" },
      { id: "c", label: "Actuator", partLabel: "actuator" },
    ],
    [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
    ],
  );

  const numerals = [
    numeral("10", "intake manifold"),
    numeral("12", "controller"),
    numeral("14", "actuator"),
  ];
  const assigned = new Map([
    ["intake manifold", "10"],
    ["controller", "12"],
    ["actuator", "14"],
  ]);

  const blockDiagram: FigureSpec = {
    figureNumber: 1,
    partialSuffix: null,
    viewType: "block_diagram",
    title: "Block diagram of the assembly",
    isPriorArt: false,
    sourceKind: "deterministic_diagram",
    subjectRef: "components",
    briefDescription: "FIG. 1 is a block diagram of the assembly.",
    primitives: [
      ...diagram.primitives,
      // Section-plane arrows for FIG. 2, drawn on the view it is taken from.
      { kind: "arrow", from: { x: 0.05, y: 0.9 }, to: { x: 0.95, y: 0.9 }, role: "section_plane" },
    ],
    annotations: diagram.anchors
      .map((anchor) => {
        const value = assigned.get(anchor.partLabel);
        return value ? annotation(value, anchor.point) : null;
      })
      .filter((entry): entry is Annotation => entry !== null),
    sectionOf: null,
    state: "planned",
    needsInput: null,
    generationPrompt: null,
  };

  const sectionView: FigureSpec = {
    figureNumber: 2,
    partialSuffix: null,
    viewType: "section",
    title: "Sectional view taken on FIG. 1",
    isPriorArt: false,
    sourceKind: "deterministic_diagram",
    subjectRef: "components",
    briefDescription: "FIG. 2 is a sectional view taken on the plane indicated in FIG. 1.",
    primitives: [
      {
        kind: "polygon",
        points: [
          { x: 0.2, y: 0.2 },
          { x: 0.8, y: 0.2 },
          { x: 0.8, y: 0.8 },
          { x: 0.2, y: 0.8 },
        ],
        lineType: "solid",
        hatchAngleDeg: 45,
        hatchSpacing: 0.05,
        hatchMaterial: "metal",
      },
    ],
    annotations: [],
    sectionOf: 1,
    state: "planned",
    needsInput: null,
    generationPrompt: null,
  };

  return {
    sheetSize: "a4",
    orientationPolicy: "portrait_preferred",
    rulesVersion: RULES_VERSION,
    figures: [blockDiagram, sectionView],
    numerals,
    briefDescriptionParagraphs: [
      blockDiagram.briefDescription,
      sectionView.briefDescription,
    ],
    symbolLegend: [
      { symbol: "Rectangle", meaning: "A functional block." },
      { symbol: "Arrow", meaning: "Direction of flow." },
    ],
    needsInput: [],
    inputHash: "hash-fixture",
  };
}

/** Draft prose that mentions exactly the drawn reference characters. */
export const VALID_DRAFT_TEXT = [
  "The assembly includes an intake manifold 10 coupled to a controller 12.",
  "The controller 12 drives an actuator 14 in response to a measured pressure.",
  "FIG. 2 is a sectional view of the actuator 14 housing.",
].join("\n");

export function contextFor(
  spec: FigureSetSpec,
  overrides: Partial<Omit<ValidationContext, "spec" | "composition">> & {
    composition?: Composition;
  } = {},
): ValidationContext {
  return {
    spec,
    composition: overrides.composition ?? compose(spec),
    rasterReports: overrides.rasterReports ?? new Map<number, RasterReport>(),
    draftText: overrides.draftText ?? VALID_DRAFT_TEXT,
    designPatent: overrides.designPatent ?? false,
  };
}

/** A raster report that passes every hygiene-derived rule. */
export function cleanRasterReport(): RasterReport {
  return {
    width: 800,
    height: 800,
    colorPixelRatio: 0,
    midtoneRatio: 0.001,
    blackRatio: 0.05,
    largestBlackRegionRatio: 0.004,
    textLikeGlyphCount: 0,
    contentBox: { x: 40, y: 40, w: 700, h: 700 },
  };
}

/** Run one rule against a context and return its outcomes. */
export function runRule(ruleId: string, ctx: ValidationContext): RuleOutcome[] {
  const rule = getRule(ruleId);
  if (!rule) throw new Error(`unknown rule ${ruleId}`);
  if (!rule.check) throw new Error(`rule ${ruleId} has no mechanical checker`);
  return rule.check(ctx);
}

/**
 * Coverage accumulators. Every `failed()` / `clean()` call records which
 * rule was exercised in which direction, so the coverage-guard test can
 * assert — at runtime, not by grepping — that EVERY mechanically checkable
 * rule saw both a passing and a failing fixture.
 */
export const SAW_PASSING_FIXTURE = new Set<string>();
export const SAW_FAILING_FIXTURE = new Set<string>();

/** True when a rule reported at least one failure. */
export function failed(ruleId: string, ctx: ValidationContext): boolean {
  const result = runRule(ruleId, ctx).some((outcome) => outcome.status === "fail");
  if (result) SAW_FAILING_FIXTURE.add(ruleId);
  return result;
}

/**
 * True when a rule flagged the fixture at all — `fail` OR
 * `needs_human_review`. Three rules (LINE-QUALITY, ARROW-DISTINGUISHABLE,
 * PLACEMENT-SOLVED) can only ever escalate to human review rather than
 * assert a violation outright, because the thing they detect is
 * "a machine cannot settle this", not "this is wrong". Their negative
 * fixture therefore asserts the escalation.
 */
export function flagged(ruleId: string, ctx: ValidationContext): boolean {
  const result = runRule(ruleId, ctx).some(
    (outcome) => outcome.status === "fail" || outcome.status === "needs_human_review",
  );
  if (result) SAW_FAILING_FIXTURE.add(ruleId);
  return result;
}

/** True when a rule reported no failures at all. */
export function clean(ruleId: string, ctx: ValidationContext): boolean {
  const result = runRule(ruleId, ctx).every((outcome) => outcome.status !== "fail");
  if (result) SAW_PASSING_FIXTURE.add(ruleId);
  return result;
}
