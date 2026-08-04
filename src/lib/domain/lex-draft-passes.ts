/**
 * LEX PATENT STUDIO'S THREE-PASS DRAFTING — the same flow, the same code.
 *
 * Jeff's directive (2026-08-04): "This needs to be the flow in both wepatent
 * and the lex patent studio apps. The patent application generation process
 * should be similarly implemented in both."
 *
 * WHAT IS SHARED AND WHAT IS NOT
 * ------------------------------
 * Everything that decides BEHAVIOUR is shared with wepatent and imported
 * from `src/lib/shared/drafting/`: the state machine, the illustrations-brief
 * schema and authoring, the numeral registry rules, the two-way §608.02
 * reconciliation, and the delivery gate. This module contains no copy of any
 * of them — it is the Lex-shaped ADAPTER over that core:
 *
 *   - a set hangs off a MATTER, not an invention;
 *   - the output is a `WorkProductDocument` with Lex's section shape and
 *     claim-support material (PRD-lex §8.2), not a wepatent export package;
 *   - it is TIER B — draft for review — so a completed set produces a review
 *     item and enters the practitioner review queue rather than becoming
 *     directly deliverable;
 *   - the practitioner, not "a human" generically, is the one who accepts.
 *
 * Pure functions only. The local store and the production adapter both drive
 * these; neither re-implements the rules.
 */
import {
  authorIllustrationsBrief,
  briefDescriptionParagraphs,
  evaluateDeliveryGate,
  figuresNamedInBriefDescription,
  illustrationsBriefSchema,
  isBriefUsable,
  LEX_DRAFT_CONFIG,
  numeralGlossary,
  reconcileProseAndDrawings,
  transitionDraftPass,
  validateBriefConsistency,
  describeBriefViolation,
  type DeliveryBlocker,
  type DraftPassState,
  type IllustrationsBrief,
  type ReconciliationReport,
  type ResumableStage,
} from "@/lib/shared/drafting";
import { effectiveTier, type WorkTier } from "./tiers";

export const LEX_THREE_PASS_VERSION = "lex-three-pass-1.0.0";

/** The Lex-side draft set. Mirrors `public.draft_sets` in migration 0007. */
export interface LexDraftSet {
  id: string;
  organizationId: string;
  matterId: string;
  state: DraftPassState;
  interruptedStage: ResumableStage | null;
  /** Tier B floor; promotable to C, never demotable (Invariant 15). */
  tier: WorkTier;
  passOneDocumentId: string | null;
  passTwoDocumentId: string | null;
  runId: string | null;
  reviewItemId: string | null;
  illustrationsBrief: IllustrationsBrief | null;
  briefVersion: string;
  reconciliation: ReconciliationReport | null;
  reconciled: boolean;
  reconciliationVersion: string;
  statusDetail: string;
  acceptedByUserId: string | null;
  acceptedAt: string | null;
  passOneChargeUsd: number;
  passTwoChargeUsd: number;
  createdAt: string;
  updatedAt: string;
}

export interface LexDraftSetTransition {
  id: string;
  organizationId: string;
  draftSetId: string;
  fromState: DraftPassState | null;
  toState: DraftPassState;
  actor: string;
  reason: string;
  createdAt: string;
}

/**
 * The tier a Lex draft set runs at.
 *
 * `section_draft` has a Tier-B platform floor, and the three-pass flow does
 * not change that: drafting is substantive work product regardless of how
 * many passes produced it. A tenant may promote to C; the shared clamp
 * refuses any demotion.
 */
export function draftSetTier(tenantOverride?: WorkTier): WorkTier {
  return effectiveTier("section_draft", tenantOverride);
}

/* ------------------------------------------------------------------ */
/* Pass 1                                                              */
/* ------------------------------------------------------------------ */

export type LexPassOneInput = {
  matterTitle: string;
  /** Named parts, from the matter's approved fact ledger. */
  components: ReadonlyArray<{ id: string; name: string; description?: string }>;
  solutions: ReadonlyArray<{ id: string; statement: string }>;
  methodSteps: readonly string[];
  hasUploadedGeometry: boolean;
  lineArtAvailable: boolean;
};

export type LexPassOneResult =
  | {
      ok: true;
      brief: IllustrationsBrief;
      /** Section bodies for the Pass-1 WorkProductDocument. */
      sections: Array<{ heading: string; body: string; flags: string[] }>;
      nextState: "FIGURES_PENDING";
    }
  | {
      ok: false;
      reason: "brief_inconsistent" | "needs_input";
      detail: string;
      brief: IllustrationsBrief;
      nextState: "NEEDS_INPUT" | "FAILED";
    };

/**
 * Pass 1: author the illustrations brief, then the draft against it.
 *
 * Identical mechanics to wepatent's Pass 1 — same authoring function, same
 * validation, same honest NEEDS_INPUT when the record cannot support a
 * figure. Only the document SHAPE differs, which is what
 * `LEX_DRAFT_CONFIG.documentSections` describes.
 */
export function runLexPassOne(input: LexPassOneInput): LexPassOneResult {
  const brief = authorIllustrationsBrief({
    recordTitle: input.matterTitle,
    components: input.components,
    associations: [],
    solutions: input.solutions,
    methodSteps: input.methodSteps,
    hasUploadedGeometry: input.hasUploadedGeometry,
    lineArtAvailable: input.lineArtAvailable,
  });

  const parsed = illustrationsBriefSchema.safeParse(brief);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "brief_inconsistent",
      detail: `The illustrations brief did not satisfy its schema: ${parsed.error.issues
        .map((issue) => issue.message)
        .join("; ")}`,
      brief,
      nextState: "FAILED",
    };
  }
  const violations = validateBriefConsistency(parsed.data);
  if (violations.length > 0) {
    return {
      ok: false,
      reason: "brief_inconsistent",
      detail: violations.map(describeBriefViolation).join(" "),
      brief: parsed.data,
      nextState: "FAILED",
    };
  }
  if (!isBriefUsable(parsed.data)) {
    return {
      ok: false,
      reason: "needs_input",
      detail:
        parsed.data.openQuestions.map((question) => question.question).join(" ") ||
        "The matter record does not yet support specifying any figure.",
      brief: parsed.data,
      nextState: "NEEDS_INPUT",
    };
  }

  const glossary = numeralGlossary(parsed.data);
  const sections: Array<{ heading: string; body: string; flags: string[] }> = [
    {
      heading: "Field",
      body: `This application relates to ${input.matterTitle}.`,
      flags: ["first pass — not yet checked against any drawing"],
    },
    {
      heading: "Background",
      body: input.solutions
        .map((solution) => solution.statement)
        .join(" ")
        .slice(0, 4_000),
      flags: [],
    },
    {
      heading: "Summary",
      body: `The disclosed subject matter comprises ${glossary.join(", ")}.`,
      flags: [],
    },
    {
      heading: "Brief Description of the Drawings",
      body:
        briefDescriptionParagraphs(parsed.data).join("\n") ||
        "No figure has been specified from the record yet.",
      flags: ["provisional — rewritten in the second pass from the figures produced"],
    },
    {
      heading: "Detailed Description",
      body: glossary
        .map(
          (entry) =>
            `The ${entry} is described from the approved fact ledger. Nothing is asserted that the ledger does not support.`,
        )
        .join(" "),
      flags: [],
    },
    {
      heading: "Illustrations brief",
      body: [
        "Authored in this pass. These reference numerals are the single source used by both the description and the drawings.",
        ...parsed.data.figures.map(
          (figure) =>
            `FIG. ${figure.figureNumber}${figure.partialSuffix ?? ""} — ${figure.title} (${figure.viewType}). Must show: ${figure.mustShow} Parts: ${figure.partNumerals.join(", ")}`,
        ),
        `Reference numerals: ${glossary.join("; ")}`,
      ].join("\n"),
      flags: [],
    },
  ];

  // Lex additionally carries claim-support material (PRD-lex §8.2).
  if (LEX_DRAFT_CONFIG.includeClaimSupport) {
    sections.push({
      heading: "Claim support",
      body: glossary
        .map((entry) => `${entry} — support traceable to the approved fact ledger.`)
        .join("\n"),
      flags: ["support mapping completes in the second pass, against the depicted elements"],
    });
  }

  return { ok: true, brief: parsed.data, sections, nextState: "FIGURES_PENDING" };
}

/* ------------------------------------------------------------------ */
/* Pass 2                                                              */
/* ------------------------------------------------------------------ */

export type LexPassTwoInput = {
  matterTitle: string;
  brief: IllustrationsBrief;
  /** The numerals the registry assigns, materialised by the figures stage. */
  registry: ReadonlyArray<{ numeral: string; partLabel: string }>;
  /** The numerals ACTUALLY placed on the composed sheets. */
  placedNumerals: readonly string[];
  producedFigures: ReadonlyArray<{
    figureNumber: number;
    partialSuffix: string | null;
    title: string;
    briefDescription: string;
  }>;
  /** Figure-validation findings, flagged verbatim and never auto-resolved. */
  validationFindings: readonly string[];
  /** §112(a) coverage dimensions with no record evidence. */
  coverageGaps: readonly string[];
};

export type LexPassTwoResult = {
  sections: Array<{ heading: string; body: string; flags: string[] }>;
  reconciliation: ReconciliationReport;
  /** READY_FOR_REVIEW only when the two-way check passes. */
  nextState: "READY_FOR_REVIEW" | "NEEDS_INPUT";
  statusDetail: string;
  /** Unresolved flags for the review item, when it is created. */
  unresolvedFlags: string[];
};

/**
 * Pass 2: the enablement revision against the figures actually produced.
 *
 * Same mechanics as wepatent's Pass 2 and the same gate — the reconciliation
 * function is literally the shared one. What differs is where the output
 * goes: a Tier-B review item in the practitioner queue.
 */
export function runLexPassTwo(input: LexPassTwoInput, now: Date = new Date()): LexPassTwoResult {
  const briefDescription =
    input.producedFigures.length > 0
      ? input.producedFigures
          .slice()
          .sort((a, b) => a.figureNumber - b.figureNumber)
          .map(
            (figure) =>
              figure.briefDescription.trim() ||
              `FIG. ${figure.figureNumber}${figure.partialSuffix ?? ""} is ${figure.title}.`,
          )
      : ["No drawing accompanies this application."];

  const detailed = input.registry
    .map(
      (entry) =>
        `The ${entry.partLabel} ${entry.numeral} is shown in the drawings and is described here so that a person of ordinary skill in the art can make and use it. Where the approved fact ledger does not state a dimension, material, or tolerance for the ${entry.partLabel} ${entry.numeral}, none is asserted.`,
    )
    .join(" ");

  const sections: Array<{ heading: string; body: string; flags: string[] }> = [
    {
      heading: "Field",
      body: `This application relates to ${input.matterTitle}.`,
      flags: [],
    },
    {
      heading: "Summary",
      body: `The disclosed subject matter comprises ${input.registry
        .map((entry) => `${entry.partLabel} (${entry.numeral})`)
        .join(", ")}.`,
      flags: [],
    },
    {
      // Rewritten from the figures ACTUALLY produced, not the Pass-1 plan.
      heading: "Brief Description of the Drawings",
      body: briefDescription.join("\n"),
      flags: [],
    },
    {
      heading: "Detailed Description",
      body: detailed,
      flags: [],
    },
  ];

  if (input.coverageGaps.length > 0) {
    sections.push({
      heading: "Enablement coverage gaps",
      body: `The §112(a) coverage model reports no record evidence for: ${input.coverageGaps.join(", ")}. These are left open rather than filled with plausible text.`,
      flags: input.coverageGaps.map((gap) => `coverage gap: ${gap}`),
    });
  }

  if (input.validationFindings.length > 0) {
    sections.push({
      heading: "Figure/record disagreements",
      body: `Flagged for the practitioner; nothing was changed automatically:\n${input.validationFindings
        .map((finding) => `• ${finding}`)
        .join("\n")}`,
      flags: input.validationFindings.map((finding) => `figure disagreement: ${finding}`),
    });
  }

  if (LEX_DRAFT_CONFIG.includeClaimSupport) {
    sections.push({
      heading: "Claim support",
      body: input.registry
        .map(
          (entry) =>
            `${entry.partLabel} (${entry.numeral}) — depicted and described; support traceable to the approved fact ledger.`,
        )
        .join("\n"),
      flags: [],
    });
  }

  // THE GATE. The same function wepatent runs, on the same inputs.
  const draftText = sections.map((section) => `${section.heading}\n${section.body}`).join("\n\n");
  const reconciliation = reconcileProseAndDrawings(
    {
      draftText,
      registryNumerals: input.registry,
      drawingNumerals: input.placedNumerals,
      producedFigures: input.producedFigures.map((figure) => ({
        figureNumber: figure.figureNumber,
        partialSuffix: figure.partialSuffix,
      })),
      briefDescriptionFigures: figuresNamedInBriefDescription(briefDescription),
    },
    now,
  );

  const unresolvedFlags = [
    ...reconciliation.findings.map((finding) => finding.detail),
    ...input.validationFindings,
  ];

  return {
    sections,
    reconciliation,
    nextState: reconciliation.reconciled ? "READY_FOR_REVIEW" : "NEEDS_INPUT",
    statusDetail: reconciliation.reconciled
      ? ""
      : [
          `The description and the drawings do not agree on ${reconciliation.findings.length} point(s). We flag these for the practitioner rather than changing the draft:`,
          ...reconciliation.findings.map((finding) => `• ${finding.detail}`),
        ].join("\n"),
    unresolvedFlags,
  };
}

/* ------------------------------------------------------------------ */
/* The delivery gate, Lex-shaped                                       */
/* ------------------------------------------------------------------ */

/**
 * Lex's delivery gate. The SAME shared evaluation, with Lex's counts.
 *
 * A Lex set is deliverable only once it reaches READY_FOR_REVIEW with a
 * passing reconciliation AND the responsible practitioner has accepted it —
 * which, under the Tier-B model, means the review item has been decided by a
 * person, not merely created.
 */
export function evaluateLexDelivery(
  set: LexDraftSet,
  figures: { ready: number; unresolved: number },
): { allowed: true } | { allowed: false; blockers: DeliveryBlocker[] } {
  const decision = evaluateDeliveryGate({
    state: set.state,
    interruptedStage: set.interruptedStage,
    statusDetail: set.statusDetail,
    passOneVersionId: set.passOneDocumentId,
    passTwoVersionId: set.passTwoDocumentId,
    // Lex composes its figures through the same pipeline; a set with no
    // figure work is represented by zero ready figures, which the shared
    // gate already refuses.
    figureSetId: figures.ready > 0 ? set.id : null,
    readyFigureCount: figures.ready,
    unresolvedFigureCount: figures.unresolved,
    reconciliation: set.reconciliation,
    acceptedByUserId: set.acceptedByUserId,
    acceptedAt: set.acceptedAt,
  });
  return decision.allowed ? { allowed: true } : { allowed: false, blockers: decision.blockers };
}

/** Guarded transition, using the shared machine. Throws on an illegal move. */
export function transitionLexDraftSet(
  set: LexDraftSet,
  to: DraftPassState,
): DraftPassState {
  return transitionDraftPass(set.state, to, {
    resumeStage: set.interruptedStage ?? undefined,
  });
}
