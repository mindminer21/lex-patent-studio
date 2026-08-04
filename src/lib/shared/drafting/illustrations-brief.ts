/**
 * THE ILLUSTRATIONS BRIEF — a first-class Pass-1 artifact.
 *
 * Jeff's directive (2026-08-04): the first draft is produced together with
 * "an illustrations brief (including reference numbers)".
 *
 * WHY THIS ARTIFACT EXISTS
 * ------------------------
 * Before this, two things independently decided reference numerals: the
 * drafting prose and the figure planner. Two authors, one numbering scheme —
 * which is how a description ends up citing an element "24" that no drawing
 * shows, and a drawing ends up carrying a "24" the description never
 * mentions. 37 CFR 1.84(p)(4) and MPEP 608.02(g) both assume one scheme.
 *
 * So Pass 1 becomes THE AUTHOR of the numeral registry, and the brief is
 * where it writes that decision down: the ordered figure list, the view
 * type of each, what each figure must show, which parts appear in it, and
 * the numeral assigned to every part. The figure planner then CONSUMES this
 * — it no longer invents numerals — and the Pass-1 prose uses the same
 * numerals because it came from the same artifact.
 *
 * PRODUCT-AGNOSTIC. wepatent and Lex persist it in their own tables and
 * render it in their own review UX, but the schema and every rule below are
 * shared. Neither product may accept a brief this module rejects.
 */
import { z } from "zod";

export const ILLUSTRATIONS_BRIEF_VERSION = "illustrations-brief-1.0.0";

/**
 * The view types a brief may request. Identical to the figure planner's set
 * — the brief drives the planner, so it cannot ask for a view the planner
 * has no way to produce.
 */
export const BRIEF_VIEW_TYPES = [
  "perspective",
  "plan",
  "elevation",
  "section",
  "partial",
  "detail",
  "exploded",
  "block_diagram",
  "flowchart",
  "waveform",
  "formula",
  "design_orthographic",
] as const;
export type BriefViewType = (typeof BRIEF_VIEW_TYPES)[number];

/** Reference character: Arabic numeral + optional single capital suffix. */
const NUMERAL_RE = /^[1-9][0-9]*[A-Z]?$/;

const numeralSchema = z
  .string()
  .regex(NUMERAL_RE, "reference numerals are an Arabic numeral with an optional capital suffix");

/**
 * One numeral assignment. This is the row that lands in the
 * `figure_reference_numerals` registry — Pass 1 writes it, the planner reads
 * it, Pass 2 reconciles against it.
 */
export const briefNumeralSchema = z.object({
  numeral: numeralSchema,
  partLabel: z.string().min(1).max(120),
  /** Link back to the record row this part came from, when there is one. */
  componentId: z.string().nullable().default(null),
  /** The lowest-numbered figure this part appears in. */
  firstFigureNumber: z.number().int().min(1).nullable().default(null),
});
export type BriefNumeral = z.infer<typeof briefNumeralSchema>;

export const briefFigureSchema = z.object({
  figureNumber: z.number().int().min(1),
  /** 37 CFR 1.84(u)(2): partial views share a number plus a capital letter. */
  partialSuffix: z
    .string()
    .regex(/^[A-Z]$/)
    .nullable()
    .default(null),
  viewType: z.enum(BRIEF_VIEW_TYPES),
  title: z.string().min(1).max(200),
  /**
   * WHAT THIS FIGURE MUST SHOW. Prose, from the record, written in Pass 1.
   * This is the instruction the figure stage works from — not an ad-hoc
   * plan derived later from whatever happened to be in the draft text.
   */
  mustShow: z.string().min(1).max(1_000),
  /** The parts appearing in this figure, BY NUMERAL. */
  partNumerals: z.array(numeralSchema).default([]),
  /** The Brief Description of the Drawings sentence for this figure. */
  briefDescription: z.string().max(400).default(""),
  isPriorArt: z.boolean().default(false),
  sectionOf: z.number().int().min(1).nullable().default(null),
  /**
   * True when Pass 1 could not honestly specify this figure and is asking
   * a question instead of inventing one. A needs-input figure carries no
   * Brief Description sentence, because there is nothing to describe yet.
   */
  needsInput: z.boolean().default(false),
  needsInputQuestion: z.string().max(400).default(""),
});
export type BriefFigure = z.infer<typeof briefFigureSchema>;

export const illustrationsBriefSchema = z
  .object({
    version: z.literal(ILLUSTRATIONS_BRIEF_VERSION),
    figures: z.array(briefFigureSchema).default([]),
    /** The numeral registry, authored here. */
    numerals: z.array(briefNumeralSchema).default([]),
    /** Anything Pass 1 needs from the user before the figures can be built. */
    openQuestions: z
      .array(
        z.object({
          figureRef: z.string().max(120),
          question: z.string().min(1).max(400),
          missing: z.string().max(300).default(""),
        }),
      )
      .default([]),
    notes: z.string().max(2_000).default(""),
  })
  .superRefine((brief, ctx) => {
    for (const [index, figure] of brief.figures.entries()) {
      if (!figure.needsInput && figure.briefDescription.trim().length === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["figures", index, "briefDescription"],
          message: "a specified figure must carry a Brief Description sentence",
        });
      }
      if (figure.needsInput && figure.needsInputQuestion.trim().length === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["figures", index, "needsInputQuestion"],
          message: "a needs-input figure must carry the question we are asking",
        });
      }
    }
  });

export type IllustrationsBrief = z.infer<typeof illustrationsBriefSchema>;

export const EMPTY_BRIEF: IllustrationsBrief = {
  version: ILLUSTRATIONS_BRIEF_VERSION,
  figures: [],
  numerals: [],
  openQuestions: [],
  notes: "",
};

/* ------------------------------------------------------------------ */
/* Structural validation beyond the schema                             */
/* ------------------------------------------------------------------ */

export type BriefViolation =
  | { kind: "duplicate_numeral"; numeral: string; parts: string[] }
  | { kind: "duplicate_part"; partLabel: string; numerals: string[] }
  | { kind: "duplicate_figure_number"; figureNumber: number; partialSuffix: string | null }
  | { kind: "figure_numbers_not_consecutive"; expected: number; found: number }
  | { kind: "unknown_numeral_in_figure"; figureNumber: number; numeral: string }
  | { kind: "numeral_in_no_figure"; numeral: string; partLabel: string }
  | { kind: "specified_figure_without_parts"; figureNumber: number }
  | { kind: "section_of_unknown_figure"; figureNumber: number; sectionOf: number };

export function describeBriefViolation(violation: BriefViolation): string {
  switch (violation.kind) {
    case "duplicate_numeral":
      return `Reference numeral ${violation.numeral} is assigned to more than one part (${violation.parts.join(", ")}). 37 CFR 1.84(p)(4) forbids one character designating different parts.`;
    case "duplicate_part":
      return `Part "${violation.partLabel}" carries more than one numeral (${violation.numerals.join(", ")}). The same part must always use the same reference character.`;
    case "duplicate_figure_number":
      return `Figure ${violation.figureNumber}${violation.partialSuffix ?? ""} is listed more than once.`;
    case "figure_numbers_not_consecutive":
      return `Figure numbering skips: expected FIG. ${violation.expected}, found FIG. ${violation.found}.`;
    case "unknown_numeral_in_figure":
      return `FIG. ${violation.figureNumber} cites numeral ${violation.numeral}, which the brief never assigns to a part.`;
    case "numeral_in_no_figure":
      return `Numeral ${violation.numeral} ("${violation.partLabel}") is assigned but appears in no figure.`;
    case "specified_figure_without_parts":
      return `FIG. ${violation.figureNumber} is specified but names no parts, so nothing can be labelled on it.`;
    case "section_of_unknown_figure":
      return `FIG. ${violation.figureNumber} is a section of FIG. ${violation.sectionOf}, which the brief does not contain.`;
  }
}

/**
 * Internal consistency of the brief, checked BEFORE any figure is drawn.
 *
 * This is cheap and it is the last point at which a numbering mistake costs
 * nothing to fix. Every violation is returned rather than thrown, so the
 * product can show the whole list at once.
 */
export function validateBriefConsistency(brief: IllustrationsBrief): BriefViolation[] {
  const violations: BriefViolation[] = [];

  // Numeral ↔ part must be a bijection (37 CFR 1.84(p)(4), both directions).
  const partsByNumeral = new Map<string, Set<string>>();
  const numeralsByPart = new Map<string, Set<string>>();
  for (const entry of brief.numerals) {
    const partKey = entry.partLabel.trim().toLowerCase().replace(/\s+/g, " ");
    if (!partsByNumeral.has(entry.numeral)) partsByNumeral.set(entry.numeral, new Set());
    partsByNumeral.get(entry.numeral)!.add(partKey);
    if (!numeralsByPart.has(partKey)) numeralsByPart.set(partKey, new Set());
    numeralsByPart.get(partKey)!.add(entry.numeral);
  }
  for (const [numeral, parts] of partsByNumeral) {
    if (parts.size > 1) {
      violations.push({ kind: "duplicate_numeral", numeral, parts: [...parts].sort() });
    }
  }
  for (const [partLabel, numerals] of numeralsByPart) {
    if (numerals.size > 1) {
      violations.push({ kind: "duplicate_part", partLabel, numerals: [...numerals].sort() });
    }
  }

  const knownNumerals = new Set(brief.numerals.map((entry) => entry.numeral));

  // Figure identity and ordering.
  const seenFigures = new Set<string>();
  const figureNumbers = new Set<number>();
  for (const figure of brief.figures) {
    const key = `${figure.figureNumber}${figure.partialSuffix ?? ""}`;
    if (seenFigures.has(key)) {
      violations.push({
        kind: "duplicate_figure_number",
        figureNumber: figure.figureNumber,
        partialSuffix: figure.partialSuffix,
      });
    }
    seenFigures.add(key);
    figureNumbers.add(figure.figureNumber);
  }
  const ordered = [...figureNumbers].sort((a, b) => a - b);
  for (const [index, number] of ordered.entries()) {
    if (number !== index + 1) {
      violations.push({
        kind: "figure_numbers_not_consecutive",
        expected: index + 1,
        found: number,
      });
      break;
    }
  }

  // Every numeral a figure cites must be assigned; every specified figure
  // must name at least one part; sections must reference a real figure.
  const usedNumerals = new Set<string>();
  for (const figure of brief.figures) {
    for (const numeral of figure.partNumerals) {
      usedNumerals.add(numeral);
      if (!knownNumerals.has(numeral)) {
        violations.push({
          kind: "unknown_numeral_in_figure",
          figureNumber: figure.figureNumber,
          numeral,
        });
      }
    }
    if (!figure.needsInput && figure.partNumerals.length === 0) {
      violations.push({
        kind: "specified_figure_without_parts",
        figureNumber: figure.figureNumber,
      });
    }
    if (figure.sectionOf !== null && !figureNumbers.has(figure.sectionOf)) {
      violations.push({
        kind: "section_of_unknown_figure",
        figureNumber: figure.figureNumber,
        sectionOf: figure.sectionOf,
      });
    }
  }
  for (const entry of brief.numerals) {
    if (!usedNumerals.has(entry.numeral)) {
      violations.push({
        kind: "numeral_in_no_figure",
        numeral: entry.numeral,
        partLabel: entry.partLabel,
      });
    }
  }

  return violations;
}

/** The brief is usable as an instruction to the figure stage. */
export function isBriefUsable(brief: IllustrationsBrief): boolean {
  return (
    brief.figures.some((figure) => !figure.needsInput) &&
    validateBriefConsistency(brief).length === 0
  );
}

/** Numerals the brief assigns, in numeric order — the registry write set. */
export function briefNumerals(brief: IllustrationsBrief): BriefNumeral[] {
  return [...brief.numerals].sort((a, b) => {
    const an = Number.parseInt(a.numeral, 10);
    const bn = Number.parseInt(b.numeral, 10);
    return an - bn || a.numeral.localeCompare(b.numeral);
  });
}

/**
 * The "Brief Description of the Drawings" paragraphs implied by the brief.
 * Pass 2 rewrites this section from the figures ACTUALLY produced; this is
 * the Pass-1 version, which is what the prose is drafted against.
 */
export function briefDescriptionParagraphs(brief: IllustrationsBrief): string[] {
  return brief.figures
    .filter((figure) => !figure.needsInput && figure.briefDescription.trim().length > 0)
    .sort(
      (a, b) =>
        a.figureNumber - b.figureNumber ||
        (a.partialSuffix ?? "").localeCompare(b.partialSuffix ?? ""),
    )
    .map((figure) => figure.briefDescription.trim());
}

/** Label lookup for a numeral, used when composing prose and callouts. */
export function partLabelFor(brief: IllustrationsBrief, numeral: string): string | null {
  return brief.numerals.find((entry) => entry.numeral === numeral)?.partLabel ?? null;
}
