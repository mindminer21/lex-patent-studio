/**
 * Shared patent-figure core — data shapes.
 *
 * This module (and everything else under `src/lib/server/figures/`) is
 * PRODUCT-NEUTRAL: wepatent and Lex Patent Studio both consume it. It must
 * not import from `@/lib/wepatent/**` or `@/lib/domain/**`, and it must not
 * touch adapters, sessions, or storage — it is pure, deterministic,
 * unit-testable geometry and rules. Product-specific orchestration lives in
 * `src/lib/server/services/figures.ts` (wepatent) and would live in the Lex
 * run orchestrator for the professional lane.
 */

/** 37 CFR 1.84(f) permitted sheet sizes. */
export type SheetSize = "a4" | "letter";

export type Orientation = "portrait" | "landscape";

/**
 * How a figure's drawing was produced. This is the honesty axis: the UI
 * shows it, exports record it, and it decides which quality caveats apply.
 */
export type FigureSourceKind =
  | "generated_line_art"
  | "deterministic_diagram"
  | "from_uploaded_model"
  | "from_uploaded_image";

export type ViewType =
  | "perspective"
  | "plan"
  | "elevation"
  | "section"
  | "partial"
  | "detail"
  | "exploded"
  | "block_diagram"
  | "flowchart"
  | "waveform"
  | "formula"
  | "design_orthographic";

/** Every AI-derived artifact starts `ai_proposed` (invariant 1). */
export type AiState = "ai_proposed" | "user_confirmed" | "user_edited";

export type FigureSetState =
  | "planning"
  | "generating"
  | "composing"
  | "validating"
  | "ready"
  | "needs_input"
  | "paused_budget"
  | "failed";

export type FigureState =
  | "planned"
  | "generated"
  | "composed"
  | "ready"
  | "needs_input"
  | "needs_human_review"
  | "failed";

/** A point in figure-local normalized coordinates (0..1 of the art box). */
export type Point = { x: number; y: number };

/** 37 CFR 1.84(l) line types. */
export type LineType =
  | "solid" // edges and shading
  | "dashed" // hidden lines
  | "phantom" // dash-dot-dot-dash: parts not forming part of the invention
  | "projection"; // dash-dot-dash: assembly projection lines

/**
 * A primitive of deterministic line art (Layer 2). Everything the composer
 * can draw without an image model is expressible here, which is exactly why
 * block diagrams / flowcharts / waveforms / formulae never touch Layer 1.
 */
export type DrawPrimitive =
  | { kind: "polyline"; points: Point[]; lineType?: LineType; closed?: boolean }
  | { kind: "rect"; x: number; y: number; w: number; h: number; lineType?: LineType }
  | { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number; lineType?: LineType }
  | {
      kind: "polygon";
      points: Point[];
      lineType?: LineType;
      /** 45° oblique hatching for sectional views; degrees, 0 = horizontal. */
      hatchAngleDeg?: number;
      hatchSpacing?: number;
      /** Conventional material pattern identified in the symbol legend. */
      hatchMaterial?: HatchMaterial;
    }
  | { kind: "arrow"; from: Point; to: Point; role: "direction" | "section_plane" }
  /**
   * Descriptive legend text INSIDE a figure — permitted only where
   * reasonably indispensable (37 CFR 1.84(o)): flowchart/block-diagram box
   * labels. Never used for reference characters, which the composer owns.
   */
  | { kind: "legend_text"; at: Point; text: string; anchor?: "start" | "middle" | "end" }
  /**
   * A generated or imported raster image placed in the art box. This is the
   * ONLY primitive Layer 1 can contribute, and it carries no text by
   * construction (raster hygiene rejects any output containing glyphs).
   */
  | { kind: "raster"; dataUri: string; x: number; y: number; w: number; h: number };

/**
 * USPTO "Symbols for Draftsmen" material hatching patterns. Only used when
 * the record actually states the material — never guessed (§8 no-fabrication).
 */
export type HatchMaterial =
  | "unspecified"
  | "metal"
  | "glass"
  | "wood"
  | "concrete"
  | "plastic"
  | "liquid"
  | "rubber"
  | "fabric";

/** One reference character in the shared, set-wide registry. */
export type NumeralEntry = {
  /** e.g. "10", "12", "16A". Never bracketed, circled, or primed. */
  numeral: string;
  partLabel: string;
  /** Component row this numeral designates, when it maps to one. */
  componentId: string | null;
  firstAssignedFigureNumber: number | null;
};

/** Placement of one reference character on one figure. */
export type Annotation = {
  numeral: string;
  /** Where the feature is (normalized, art-box coordinates). */
  anchor: Point;
  /** Where the character is drawn. */
  label: Point;
  /** Lead line from the character to (but not touching) the feature. */
  leadLine: Point[];
  /**
   * True when the character sits on the surface it designates: no lead
   * line, underlined instead (37 CFR 1.84(q)).
   */
  underlined: boolean;
  placedBy: "auto" | "user";
};

/**
 * Whether the record supported this figure. `needs_input` is a first-class
 * outcome: the planner emits it instead of inventing geometry (§8).
 */
export type NeedsInput = {
  figureRef: string;
  question: string;
  missing: string;
};

export type FigureSpec = {
  /** 1-based, consecutive across the set, independent of sheet numbering. */
  figureNumber: number;
  /** "A"/"B"… for partial views forming one complete view. */
  partialSuffix: string | null;
  viewType: ViewType;
  title: string;
  isPriorArt: boolean;
  sourceKind: FigureSourceKind;
  /** Provenance: which component / ps_pair / method step this depicts. */
  subjectRef: string;
  /** What the drawing actually is, in patent style, one sentence. */
  briefDescription: string;
  /** Deterministic geometry (Layer 2). Empty for pure Layer-1 figures. */
  primitives: DrawPrimitive[];
  /** Reference characters placed on this figure. */
  annotations: Annotation[];
  /** Section-plane relationship: "this figure is the section taken on FIG. n". */
  sectionOf: number | null;
  state: FigureState;
  /** Populated when state is needs_input. */
  needsInput: NeedsInput | null;
  /** Layer-1 prompt actually used, for provenance. Null for deterministic. */
  generationPrompt: string | null;
};

export type SymbolLegendEntry = { symbol: string; meaning: string };

export type FigureSetSpec = {
  sheetSize: SheetSize;
  orientationPolicy: "portrait_preferred" | "landscape_allowed";
  rulesVersion: string;
  figures: FigureSpec[];
  numerals: NumeralEntry[];
  /** "Brief Description of the Drawings", one sentence per figure. */
  briefDescriptionParagraphs: string[];
  symbolLegend: SymbolLegendEntry[];
  needsInput: NeedsInput[];
  /** Content hash of every planner input — regeneration no-ops when equal. */
  inputHash: string;
};

/** A composed drawing sheet ready to be stored. */
export type ComposedSheet = {
  sheetNumber: number;
  totalSheets: number;
  orientation: Orientation;
  /** Full SVG document text for the sheet. */
  svg: string;
  /** Figure numbers laid out on this sheet, in order. */
  figureNumbers: number[];
};
