/**
 * Stage 1 — the figure-set planner.
 *
 * THE SINGLE MOST IMPORTANT QUALITY RULE (spec §8): the planner must never
 * invent structure the record does not support. Where the record is
 * insufficient, it emits `needs_input` with a targeted question instead of
 * confident fiction.
 *
 * This planner is therefore DETERMINISTIC and record-driven: every figure it
 * proposes is a projection of rows that already exist (components, solution↔
 * component associations, uploaded sources, method steps literally present
 * in the draft text). It cannot hallucinate a part, because it has no
 * generative step in which to do so.
 *
 * `plannerOutputSchema` below is the validated JSON contract a model-assisted
 * planner would have to satisfy. It exists so that seam is already typed and
 * enforced; today nothing writes through it except this deterministic
 * planner's own self-check, which is exactly the point — see
 * docs/PATENT-FIGURES.md for why the model planner is deferred.
 *
 * Prompt-injection posture: every string reaching this module is untrusted
 * EVIDENCE. Nothing here interprets record text as an instruction — the only
 * things read out of text are (a) numbered method steps by structure, and
 * (b) formula-shaped lines by character class. Planted instructions cannot
 * change the figure list, the numeral registry, or any state.
 */
import { z } from "zod";
import { buildBlockDiagram, buildFlowchart, buildFormulaFigure, buildWaveformGroup } from "./diagrams";
import { allocateNumerals, consumeNumerals } from "./numerals";
import { RULES_VERSION } from "./rules";
import type {
  Annotation,
  DrawPrimitive,
  FigureSetSpec,
  FigureSpec,
  FigureSourceKind,
  NeedsInput,
  NumeralEntry,
  Point,
  SheetSize,
  SymbolLegendEntry,
  ViewType,
} from "./types";

export const PLANNER_VERSION = "figures-planner-1.0.0";

/* ------------------------------------------------------------------ */
/* The validated planner contract                                      */
/* ------------------------------------------------------------------ */

export const plannerOutputSchema = z.object({
  figures: z
    .array(
      z.object({
        figureNumber: z.number().int().min(1),
        partialSuffix: z
          .string()
          .regex(/^[A-Z]$/)
          .nullable()
          .default(null),
        viewType: z.enum([
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
        ]),
        title: z.string().min(1).max(200),
        isPriorArt: z.boolean().default(false),
        sourceKind: z.enum([
          "generated_line_art",
          "deterministic_diagram",
          "from_uploaded_model",
          "from_uploaded_image",
        ]),
        subjectRef: z.string().max(200).default(""),
        rationale: z.string().max(500).default(""),
        /**
         * Empty ONLY for a figure that could not be planned honestly — a
         * `needs_input` placeholder has no drawing to describe yet. The
         * refinement below enforces that; a drawable figure without a
         * Brief Description sentence is a schema error.
         */
        briefDescription: z.string().max(400).default(""),
        needsInput: z.boolean().default(false),
        sectionOf: z.number().int().min(1).nullable().default(null),
        /** Parts appearing in this figure, by registry part label. */
        parts: z
          .array(
            z.object({
              partLabel: z.string().min(1).max(120),
              componentId: z.string().nullable().default(null),
              preferredNumeral: z.string().nullable().default(null),
            }),
          )
          .default([]),
      })
        .superRefine((figure, ctx) => {
          if (!figure.needsInput && figure.briefDescription.trim().length === 0) {
            ctx.addIssue({
              code: "custom",
              path: ["briefDescription"],
              message: "a drawable figure must carry a Brief Description sentence",
            });
          }
        }),
    )
    .default([]),
  briefDescriptionParagraphs: z.array(z.string()).default([]),
  symbolLegend: z
    .array(z.object({ symbol: z.string().min(1), meaning: z.string().min(1) }))
    .default([]),
  needsInput: z
    .array(
      z.object({
        figureRef: z.string().max(120),
        question: z.string().min(1).max(400),
        missing: z.string().max(300).default(""),
      }),
    )
    .default([]),
});

export type PlannerOutput = z.infer<typeof plannerOutputSchema>;

/* ------------------------------------------------------------------ */
/* Planner input                                                       */
/* ------------------------------------------------------------------ */

export type PlannerComponent = {
  id: string;
  name: string;
  description: string;
  /** ai_proposed / user_confirmed / user_edited — all usable as record. */
  state: string;
};

export type PlannerSource = {
  id: string;
  name: string;
  /** How the upload pipeline classified it. */
  sourceClass: "document" | "image" | "model3d" | "audio" | "video" | "stored_only";
  status: string;
  /** Present for model3d sources the caller already parsed and projected. */
  meshPrimitives?: DrawPrimitive[];
  meshAnchors?: Point[];
  /** True when the source is a derived snapshot of a 3D model. */
  derived?: boolean;
};

export type PlannerInput = {
  inventionTitle: string;
  /** Draft text — untrusted evidence, read structurally only. */
  draftText: string;
  components: PlannerComponent[];
  solutions: Array<{ id: string; statement: string }>;
  /** solution → component links from the P/S ledger. */
  associations: Array<{ solutionId: string; componentId: string | null }>;
  sources: PlannerSource[];
  existingNumerals: NumeralEntry[];
  sheetSize: SheetSize;
  /** Set when the Layer-1 image provider is unavailable/disabled. */
  lineArtAvailable: boolean;
  /** Design-patent rule subset (Lex design lane). */
  designPatent: boolean;
  /** Content hash of every input above; regeneration no-ops when equal. */
  inputHash: string;
  /**
   * BRIEF-DRIVEN MODE (Jeff's directive, 2026-08-04).
   *
   * When true, `existingNumerals` came from the Pass-1 illustrations brief
   * and the planner CONSUMES them: a part the brief did not number is not
   * numbered here either — it is reported as a needs-input question. This is
   * what makes the prose and the drawings share one numbering scheme instead
   * of two authors independently inventing one.
   *
   * When false (legacy ad-hoc planning), the planner mints numerals itself,
   * exactly as it did before.
   */
  briefDriven?: boolean;
};

/* ------------------------------------------------------------------ */
/* Structural readers over untrusted text                              */
/* ------------------------------------------------------------------ */

/**
 * Method steps, read by STRUCTURE only: numbered or bulleted lines under a
 * heading that mentions steps/method/process. We never ask a model what the
 * steps are, and we never treat their content as instructions.
 */
export function extractMethodSteps(draftText: string): string[] {
  const lines = draftText.split(/\r?\n/);
  const steps: string[] = [];
  let inSection = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^#{0,3}\s*(method|process|steps?|operation)\b/i.test(line) && line.length < 120) {
      inSection = true;
      continue;
    }
    if (inSection && /^#{1,3}\s/.test(line)) break;
    const numbered = /^(?:\(?\d+[.)]|[-*•])\s+(.{4,200})$/.exec(line);
    if (numbered) {
      if (inSection || steps.length > 0) steps.push(numbered[1].trim());
    } else if (line.length === 0 && steps.length > 0 && !inSection) {
      break;
    }
  }
  return steps.slice(0, 8);
}

/** Formula-shaped lines: an equation with an operator, no prose sentence. */
export function extractFormulas(draftText: string): string[] {
  const formulas: string[] = [];
  for (const raw of draftText.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length < 3 || line.length > 90) continue;
    if (!line.includes("=")) continue;
    if (/[.;:]\s/.test(line)) continue;
    if (!/^[A-Za-z0-9_^*/+\-()[\]{}=.,\s×·√Σ∫αβγδθλμπσΔ]+$/.test(line)) continue;
    const words = line.split(/\s+/).filter((token) => /^[A-Za-z]{4,}$/.test(token));
    if (words.length > 2) continue;
    formulas.push(line);
  }
  return formulas.slice(0, 4);
}

/** Prior-art signals, read literally from the record. */
export function mentionsPriorArt(draftText: string): boolean {
  return /\bprior art\b/i.test(draftText);
}

/* ------------------------------------------------------------------ */
/* The planner                                                         */
/* ------------------------------------------------------------------ */

export type PlanResult = {
  spec: FigureSetSpec;
  /** Schema-validated planner output, for provenance and future model swap. */
  plannerOutput: PlannerOutput;
};

export function planFigureSet(input: PlannerInput): PlanResult {
  const figures: FigureSpec[] = [];
  const needsInput: NeedsInput[] = [];
  const symbolLegend: SymbolLegendEntry[] = [];
  let numerals: NumeralEntry[] = [...input.existingNumerals];
  let nextNumber = 1;

  /**
   * The one allocation seam. In brief-driven mode it consumes the Pass-1
   * registry and never mints; otherwise it behaves exactly as before. Parts
   * the brief did not number surface as targeted questions rather than as
   * newly invented numerals.
   */
  const allocate = (
    registry: readonly NumeralEntry[],
    requests: ReadonlyArray<{
      partLabel: string;
      componentId?: string | null;
      figureNumber?: number | null;
      preferredNumeral?: string | null;
    }>,
  ): { entries: NumeralEntry[]; assigned: Map<string, string> } => {
    if (!input.briefDriven) return allocateNumerals(registry, requests);
    const consumed = consumeNumerals(registry, requests);
    for (const partLabel of consumed.unassignable) {
      needsInput.push({
        figureRef: `part:${partLabel}`,
        question: `The illustrations brief does not assign a reference numeral to "${partLabel}". Add it to the brief (so the description and the drawings agree) or remove it from this figure.`,
        missing: "reference numeral in the Pass-1 illustrations brief",
      });
    }
    return { entries: consumed.entries, assigned: consumed.assigned };
  };

  const usableComponents = input.components.filter((component) => component.name.trim().length > 0);

  /* ---- 1. System overview: block diagram from the component graph ------ */
  if (usableComponents.length >= 2) {
    const nodes = usableComponents.slice(0, 8).map((component) => ({
      id: component.id,
      label: shorten(component.name, 28),
      partLabel: component.name.trim(),
    }));
    const edges = edgesFromAssociations(input.associations, nodes.map((node) => node.id));
    const diagram = buildBlockDiagram(nodes, edges);
    const allocation = allocate(
      numerals,
      nodes.map((node) => {
        const component = usableComponents.find((candidate) => candidate.id === node.id);
        return { partLabel: node.partLabel, componentId: component?.id ?? null, figureNumber: nextNumber };
      }),
    );
    numerals = allocation.entries;
    figures.push({
      figureNumber: nextNumber,
      partialSuffix: null,
      viewType: "block_diagram",
      title: `Block diagram of ${shorten(input.inventionTitle, 60)}`,
      isPriorArt: false,
      sourceKind: "deterministic_diagram",
      subjectRef: "components",
      briefDescription: `FIG. ${nextNumber} is a block diagram of ${lowerFirst(shorten(input.inventionTitle, 60))}.`,
      primitives: diagram.primitives,
      annotations: annotationsFor(diagram.anchors, allocation.assigned),
      sectionOf: null,
      state: "planned",
      needsInput: null,
      generationPrompt: null,
    });
    symbolLegend.push({
      symbol: "Rectangle",
      meaning: "A functional block; the reference character on its lead line names the part.",
    });
    symbolLegend.push({ symbol: "Arrow", meaning: "Direction of signal, material or control flow." });
    nextNumber += 1;
  }

  /* ---- 2. Method flowchart from literal numbered steps ---------------- */
  const steps = extractMethodSteps(input.draftText);
  if (steps.length >= 2) {
    const nodes = steps.map((step, index) => ({
      id: `step-${index}`,
      label: shorten(step, 30),
      partLabel: `step ${index + 1}: ${shorten(step, 60)}`,
      shape: (index === 0 || index === steps.length - 1 ? "terminal" : "process") as
        | "terminal"
        | "process",
    }));
    const edges = nodes.slice(0, -1).map((node, index) => ({ from: node.id, to: nodes[index + 1].id }));
    const diagram = buildFlowchart(nodes, edges);
    const allocation = allocate(
      numerals,
      nodes.map((node) => ({ partLabel: node.partLabel, figureNumber: nextNumber })),
    );
    numerals = allocation.entries;
    figures.push({
      figureNumber: nextNumber,
      partialSuffix: null,
      viewType: "flowchart",
      title: "Method flowchart",
      isPriorArt: false,
      sourceKind: "deterministic_diagram",
      subjectRef: "method_steps",
      briefDescription: `FIG. ${nextNumber} is a flowchart of a method according to an embodiment.`,
      primitives: diagram.primitives,
      annotations: annotationsFor(diagram.anchors, allocation.assigned),
      sectionOf: null,
      state: "planned",
      needsInput: null,
      generationPrompt: null,
    });
    symbolLegend.push({ symbol: "Oval", meaning: "Terminal: start or end of the method." });
    symbolLegend.push({ symbol: "Rectangle", meaning: "Process step." });
    nextNumber += 1;
  }

  /* ---- 3. Model-derived views from uploaded 3D geometry --------------- */
  for (const source of input.sources) {
    if (source.sourceClass !== "model3d") continue;
    if (!source.meshPrimitives || source.meshPrimitives.length === 0) {
      needsInput.push({
        figureRef: `source:${source.name}`,
        question: `We could not read usable geometry from "${source.name}". Can you re-upload it as STL or OBJ, or describe the view you want drawn?`,
        missing: "parsable 3D geometry",
      });
      continue;
    }
    const partLabel = `${source.name.replace(/\.[a-z0-9]+$/i, "")} assembly`;
    const allocation = allocate(numerals, [{ partLabel, figureNumber: nextNumber }]);
    numerals = allocation.entries;
    const anchors = (source.meshAnchors ?? []).slice(0, 1);
    figures.push({
      figureNumber: nextNumber,
      partialSuffix: null,
      viewType: "perspective",
      title: `Perspective view from ${source.name}`,
      isPriorArt: false,
      sourceKind: "from_uploaded_model",
      subjectRef: `source:${source.id}`,
      briefDescription: `FIG. ${nextNumber} is a perspective view of ${lowerFirst(partLabel)}.`,
      primitives: source.meshPrimitives,
      annotations: annotationsFor(
        anchors.map((point) => ({ partLabel, point })),
        allocation.assigned,
      ),
      sectionOf: null,
      state: "planned",
      needsInput: null,
      generationPrompt: null,
    });
    nextNumber += 1;
  }

  /* ---- 4. Line art from uploaded images / textual subject ------------- */
  const conditioningImages = input.sources.filter(
    (source) => source.sourceClass === "image" && !source.derived,
  );
  for (const source of conditioningImages.slice(0, 3)) {
    const partLabel = `${source.name.replace(/\.[a-z0-9]+$/i, "")} subject`;
    if (!input.lineArtAvailable) {
      needsInput.push({
        figureRef: `source:${source.name}`,
        question: `Converting "${source.name}" into patent line art needs the drawing model, which is not enabled. You can upload a line drawing or an STL/OBJ model instead, or describe the view and we will keep it in the plan.`,
        missing: "line-art generation provider",
      });
      figures.push(
        placeholderFigure(nextNumber, "perspective", `View from ${source.name}`, `source:${source.id}`, {
          figureRef: `source:${source.name}`,
          question: `Describe the view you want drawn from "${source.name}", or upload a line drawing or 3D model.`,
          missing: "line-art generation provider",
        }, "from_uploaded_image"),
      );
      nextNumber += 1;
      continue;
    }
    const allocation = allocate(numerals, [{ partLabel, figureNumber: nextNumber }]);
    numerals = allocation.entries;
    figures.push({
      figureNumber: nextNumber,
      partialSuffix: null,
      viewType: "perspective",
      title: `Perspective view from ${source.name}`,
      isPriorArt: false,
      sourceKind: "from_uploaded_image",
      subjectRef: `source:${source.id}`,
      briefDescription: `FIG. ${nextNumber} is a perspective view of ${lowerFirst(partLabel)}.`,
      primitives: [],
      annotations: [],
      sectionOf: null,
      state: "planned",
      needsInput: null,
      generationPrompt: null,
    });
    nextNumber += 1;
  }

  /* ---- 5. Formula figures — each its own figure (1.84(i)) ------------- */
  for (const formula of extractFormulas(input.draftText)) {
    const diagram = buildFormulaFigure([formula]);
    figures.push({
      figureNumber: nextNumber,
      partialSuffix: null,
      viewType: "formula",
      title: "Formula",
      isPriorArt: false,
      sourceKind: "deterministic_diagram",
      subjectRef: "formula",
      briefDescription: `FIG. ${nextNumber} shows a formula used by an embodiment.`,
      primitives: diagram.primitives,
      annotations: [],
      sectionOf: null,
      state: "planned",
      needsInput: null,
      generationPrompt: null,
    });
    nextNumber += 1;
  }

  /* ---- 6. Nothing to draw: say so, do not invent ---------------------- */
  if (figures.length === 0) {
    needsInput.push({
      figureRef: "set",
      question:
        "There is not enough in the record yet to draw a figure honestly. Add the parts of your invention (or upload a sketch, photo, or 3D model) and we will plan the drawings from them.",
      missing: "components, method steps, or an uploaded source",
    });
  }

  const briefDescriptionParagraphs = figures
    .filter((figure) => figure.state !== "needs_input")
    .map((figure) => figure.briefDescription);

  const spec: FigureSetSpec = {
    sheetSize: input.sheetSize,
    orientationPolicy: "portrait_preferred",
    rulesVersion: RULES_VERSION,
    figures,
    numerals,
    briefDescriptionParagraphs,
    symbolLegend: dedupeLegend(symbolLegend),
    needsInput,
    inputHash: input.inputHash,
  };

  // Self-check through the same schema a model planner would have to pass.
  const plannerOutput = plannerOutputSchema.parse({
    figures: figures.map((figure) => ({
      figureNumber: figure.figureNumber,
      partialSuffix: figure.partialSuffix,
      viewType: figure.viewType,
      title: figure.title,
      isPriorArt: figure.isPriorArt,
      sourceKind: figure.sourceKind,
      subjectRef: figure.subjectRef,
      rationale: `derived deterministically from ${figure.subjectRef || "the record"}`,
      briefDescription: figure.briefDescription,
      needsInput: figure.state === "needs_input",
      sectionOf: figure.sectionOf,
      parts: figure.annotations.map((annotation) => ({
        partLabel:
          numerals.find((entry) => entry.numeral === annotation.numeral)?.partLabel ??
          annotation.numeral,
        componentId:
          numerals.find((entry) => entry.numeral === annotation.numeral)?.componentId ?? null,
        preferredNumeral: annotation.numeral,
      })),
    })),
    briefDescriptionParagraphs,
    symbolLegend: spec.symbolLegend,
    needsInput,
  });

  return { spec, plannerOutput };
}

function placeholderFigure(
  figureNumber: number,
  viewType: ViewType,
  title: string,
  subjectRef: string,
  question: NeedsInput,
  sourceKind: FigureSourceKind,
): FigureSpec {
  return {
    figureNumber,
    partialSuffix: null,
    viewType,
    title,
    isPriorArt: false,
    sourceKind,
    subjectRef,
    briefDescription: "",
    primitives: [],
    annotations: [],
    sectionOf: null,
    state: "needs_input",
    needsInput: question,
    generationPrompt: null,
  };
}

function annotationsFor(
  anchors: ReadonlyArray<{ partLabel: string; point: Point }>,
  assigned: ReadonlyMap<string, string>,
): Annotation[] {
  const annotations: Annotation[] = [];
  for (const anchor of anchors) {
    const numeral = assigned.get(anchor.partLabel.trim());
    if (!numeral) continue;
    annotations.push({
      numeral,
      anchor: anchor.point,
      label: anchor.point,
      leadLine: [],
      underlined: false,
      placedBy: "auto",
    });
  }
  return annotations;
}

function edgesFromAssociations(
  associations: ReadonlyArray<{ solutionId: string; componentId: string | null }>,
  componentIds: readonly string[],
): Array<{ from: string; to: string }> {
  const bySolution = new Map<string, string[]>();
  for (const association of associations) {
    if (!association.componentId || !componentIds.includes(association.componentId)) continue;
    const list = bySolution.get(association.solutionId) ?? [];
    if (!list.includes(association.componentId)) list.push(association.componentId);
    bySolution.set(association.solutionId, list);
  }
  const edges: Array<{ from: string; to: string }> = [];
  const seen = new Set<string>();
  for (const members of bySolution.values()) {
    for (let i = 0; i + 1 < members.length; i += 1) {
      const key = `${members[i]}->${members[i + 1]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: members[i], to: members[i + 1] });
    }
  }
  // With no association evidence we draw NO connections rather than guessing
  // a topology — an invented arrow is invented structure.
  return edges;
}

function dedupeLegend(entries: readonly SymbolLegendEntry[]): SymbolLegendEntry[] {
  const seen = new Set<string>();
  const output: SymbolLegendEntry[] = [];
  for (const entry of entries) {
    const key = `${entry.symbol}|${entry.meaning}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(entry);
  }
  return output;
}

function shorten(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max - 1)}…`;
}

function lowerFirst(text: string): string {
  return text.length === 0 ? text : text[0].toLowerCase() + text.slice(1);
}

export { buildWaveformGroup };
