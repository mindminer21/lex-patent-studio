/**
 * AUTHORING THE ILLUSTRATIONS BRIEF IN PASS 1.
 *
 * The brief is the artifact that makes prose and drawings share one
 * numbering scheme. Whoever authors it becomes the registry's author, so
 * this runs in Pass 1 — before any figure exists and before the prose is
 * written against numerals.
 *
 * WHY THIS IS DETERMINISTIC
 * -------------------------
 * The same reason the figure planner is (docs/PATENT-FIGURES.md §4): a
 * generative step here could invent a part the record does not contain, and
 * that part would then propagate into the numeral registry, the drawings,
 * AND the description — three places, one hallucination, all mutually
 * corroborating. So the brief is a PROJECTION of rows that already exist:
 * components, solution↔component associations, method steps literally
 * present in the record, and uploaded sources. Where the record cannot
 * support a figure, the brief emits an open question instead.
 *
 * The model's job in Pass 1 is to write the PROSE against this brief, not to
 * decide what the figures are.
 *
 * PRODUCT-AGNOSTIC. Both lanes author briefs the same way; only the document
 * the prose lands in differs.
 */
import {
  ILLUSTRATIONS_BRIEF_VERSION,
  type BriefFigure,
  type BriefNumeral,
  type BriefViewType,
  type IllustrationsBrief,
} from "./illustrations-brief";

/** MPEP 608.02 practice: start at 10, step by 2, leaving odds for insertions. */
const NUMERAL_START = 10;
const NUMERAL_STEP = 2;

export type BriefAuthoringInput = {
  recordTitle: string;
  /** Named parts from the record. Order is the order they are numbered in. */
  components: ReadonlyArray<{ id: string; name: string; description?: string }>;
  /** solution → component links, used to decide which parts share a view. */
  associations: ReadonlyArray<{ solutionId: string; componentId: string | null }>;
  solutions: ReadonlyArray<{ id: string; statement: string }>;
  /** Method steps already extracted from the record by structure. */
  methodSteps: readonly string[];
  /** True when an uploaded 3D model or image can condition a view. */
  hasUploadedGeometry: boolean;
  /** False when the Layer-1 image provider is disabled/unkeyed. */
  lineArtAvailable: boolean;
};

function partKey(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, " ");
}

function lowerFirst(text: string): string {
  return text.length > 0 ? text[0].toLowerCase() + text.slice(1) : text;
}

function shorten(text: string, max: number): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

/**
 * Assign a numeral to every named part in the record, once.
 *
 * This is the registry. Every later consumer — the prose, the planner, the
 * annotations, the reconciliation gate — reads it and none of them add to it.
 */
export function assignNumerals(
  components: BriefAuthoringInput["components"],
): BriefNumeral[] {
  const seen = new Set<string>();
  const numerals: BriefNumeral[] = [];
  let cursor = NUMERAL_START;
  for (const component of components) {
    const label = component.name.trim();
    if (label.length === 0) continue;
    const key = partKey(label);
    if (seen.has(key)) continue;
    seen.add(key);
    numerals.push({
      numeral: String(cursor),
      partLabel: label,
      componentId: component.id,
      firstFigureNumber: null,
    });
    cursor += NUMERAL_STEP;
  }
  return numerals;
}

/**
 * Author the brief.
 *
 * The figure list mirrors what the deterministic planner can actually
 * produce, in the same order, so the figures stage does not have to
 * reinterpret the instruction:
 *
 *   1. a block diagram of the system, when the record names ≥2 parts;
 *   2. a flowchart of the method, when the record contains method steps;
 *   3. a perspective view of the apparatus, when line art or uploaded
 *      geometry is available to draw it from.
 *
 * Where none of those hold, the brief carries an open question rather than
 * a figure.
 */
export function authorIllustrationsBrief(
  input: BriefAuthoringInput,
): IllustrationsBrief {
  const numerals = assignNumerals(input.components);
  const figures: BriefFigure[] = [];
  const openQuestions: IllustrationsBrief["openQuestions"] = [];
  const title = shorten(input.recordTitle, 60);
  let figureNumber = 1;

  const push = (
    viewType: BriefViewType,
    figureTitle: string,
    mustShow: string,
    partNumerals: string[],
    briefDescription: string,
  ) => {
    figures.push({
      figureNumber,
      partialSuffix: null,
      viewType,
      title: figureTitle,
      mustShow,
      partNumerals,
      briefDescription,
      isPriorArt: false,
      sectionOf: null,
      needsInput: false,
      needsInputQuestion: "",
    });
    for (const numeral of partNumerals) {
      const entry = numerals.find((candidate) => candidate.numeral === numeral);
      if (entry && entry.firstFigureNumber === null) entry.firstFigureNumber = figureNumber;
    }
    figureNumber += 1;
  };

  /* ---- 1. System overview ------------------------------------------- */
  const systemNumerals = numerals.slice(0, 8).map((entry) => entry.numeral);
  if (systemNumerals.length >= 2) {
    const names = numerals
      .slice(0, 8)
      .map((entry) => `${entry.partLabel} (${entry.numeral})`)
      .join(", ");
    push(
      "block_diagram",
      `Block diagram of ${title}`,
      `The overall arrangement of ${names}, with the connections between them that the record supports. No part that the record does not name.`,
      systemNumerals,
      `FIG. 1 is a block diagram of ${lowerFirst(title)}.`,
    );
  }

  /* ---- 2. Method flowchart ------------------------------------------ */
  if (input.methodSteps.length >= 2) {
    // A method figure carries the parts its steps actually name.
    const mentioned = numerals
      .filter((entry) =>
        input.methodSteps.some((step) =>
          step.toLowerCase().includes(entry.partLabel.toLowerCase()),
        ),
      )
      .map((entry) => entry.numeral);
    const stepNumerals = mentioned.length > 0 ? mentioned : systemNumerals.slice(0, 3);
    if (stepNumerals.length > 0) {
      push(
        "flowchart",
        `Flowchart of the method of ${title}`,
        `Each of the ${input.methodSteps.length} method steps present in the record, in order, as a single flow. Steps are drawn as boxes with directional arrows; no step is added that the record does not state.`,
        stepNumerals,
        `FIG. ${figureNumber} is a flowchart of a method of operating ${lowerFirst(title)}.`,
      );
    }
  }

  /* ---- 3. Apparatus view -------------------------------------------- */
  const canDrawApparatus = input.lineArtAvailable || input.hasUploadedGeometry;
  if (numerals.length > 0 && canDrawApparatus) {
    const apparatusNumerals = numerals.slice(0, 6).map((entry) => entry.numeral);
    push(
      "perspective",
      `Perspective view of ${title}`,
      `The physical arrangement of ${numerals
        .slice(0, 6)
        .map((entry) => `${entry.partLabel} (${entry.numeral})`)
        .join(", ")} as an assembled apparatus. Pure line art: no shading beyond hatching, no text on the drawing.`,
      apparatusNumerals,
      `FIG. ${figureNumber} is a perspective view of ${lowerFirst(title)}.`,
    );
  } else if (numerals.length > 0 && !canDrawApparatus) {
    openQuestions.push({
      figureRef: "apparatus",
      question:
        "We can describe the parts but have nothing to draw the physical arrangement from. Upload a sketch or a 3D model of the assembly, or confirm that the block diagram alone is sufficient.",
      missing: "geometry for a perspective view",
    });
  }

  /* ---- Honest failure ------------------------------------------------ */
  if (figures.length === 0) {
    openQuestions.push({
      figureRef: "all",
      question:
        "The record does not yet name enough distinct parts or method steps to specify a figure. Add the components of the invention, or describe the steps of the method, and we will draft the illustrations brief from them.",
      missing: "named parts or method steps",
    });
  }

  // A numeral that appears in no figure would fail brief consistency, so
  // parts the record names but no figure shows are dropped from the
  // registry rather than left dangling. They are still described in prose —
  // they simply carry no reference character, which is correct: a reference
  // character with no drawing is exactly what the §608.02 gate rejects.
  const used = new Set(figures.flatMap((figure) => figure.partNumerals));
  const kept = numerals.filter((entry) => used.has(entry.numeral));

  return {
    version: ILLUSTRATIONS_BRIEF_VERSION,
    figures,
    numerals: kept,
    openQuestions,
    notes:
      "Authored in Pass 1 from the record. The reference numerals here are the single source used by both the description and the drawings.",
  };
}

/** Parts the brief numbers, as `label (numeral)`, for the drafting prompt. */
export function numeralGlossary(brief: IllustrationsBrief): string[] {
  return brief.numerals.map((entry) => `${entry.partLabel} (${entry.numeral})`);
}

/** Every numeral the brief assigns — the set the prose must use. */
export function requiredNumerals(brief: IllustrationsBrief): string[] {
  return brief.numerals.map((entry) => entry.numeral);
}
