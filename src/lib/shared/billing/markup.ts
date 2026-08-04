/**
 * Per-category retail markup catalog and the customer-facing disclosure
 * derived from it (PRD-wepatent FR-6 / PRD-lex-patent-studio FR-9).
 *
 * PRODUCT-AGNOSTIC. Both wepatent and Lex Patent Studio read the multiplier
 * and the published sentence from this one module; `src/lib/wepatent/domain/
 * markup.ts` re-exports it for the import paths that predate the move.
 *
 * WHY THIS MODULE EXISTS SEPARATELY FROM THE PRICE REGISTRY
 * ---------------------------------------------------------
 * Provider *rates* are commercially sensitive and stay server-side (see
 * `PROVIDER_PRICE_REGISTRY`). The *markup* is the opposite: it is the number
 * we publish, so it must be importable by public marketing pages and product
 * copy without dragging provider rates into the browser bundle.
 *
 * THE RULE IS BY TASK TYPE, NOT BY PROVIDER (Jeff's directive, 2026-08-04)
 * -----------------------------------------------------------------------
 * A charge is categorised by what the model call PRODUCES, not by which
 * vendor served it or whether the bytes were pixels or tokens:
 *
 * - `generation` (2.0×) — the model's output is newly authored work product
 *   delivered to the customer. Patent application drafting (every pass),
 *   figure/image generation, illustration-brief authoring, draft revision,
 *   export-bound prose, deterministic-diagram planning that authors text,
 *   and Lex's drafting / claim / OA-response / memo / search-report
 *   workflows.
 * - `analysis` (1.5×) — the model call reads, structures, checks, or routes
 *   material that already exists. Extraction, parsing, classification,
 *   transcription, retrieval/grounding, verification/critique, coverage
 *   scoring, interview question drafting (a conversational step, not a
 *   deliverable), and routing.
 *
 * The exhaustive workflow → category table lives in `./task-category.ts`,
 * which fails to compile if a new workflow or job kind is added without one.
 *
 * Changing any multiplier is a pricing change and requires the owner's
 * explicit approval (PRD FR-6 / §17).
 */

/** What kind of work a charge is for — by task type, not by provider. */
export type BillingCategory = "generation" | "analysis";

export const BILLING_CATEGORIES = ["generation", "analysis"] as const;

/**
 * Retail multiplier applied to provider cost, by task category.
 *
 * - `generation`: 2.0 — Jeff's directive (2026-08-04), broadened from image
 *   generation to every generation task. Generation output is the product:
 *   it carries the rejection/retry cost (output that fails a hygiene or
 *   reconciliation gate is discarded and re-authored at our expense) and the
 *   deterministic composition, validation, and reconciliation work that turns
 *   a raw model response into something deliverable.
 * - `analysis`: 1.5 — the platform-wide default, unchanged since launch.
 *   Every charge that billed at 1.5 before this change still bills at 1.5.
 */
export const MARKUP_MULTIPLIERS: Readonly<Record<BillingCategory, number>> = {
  generation: 2.0,
  analysis: 1.5,
};

/**
 * Applied to any charge whose category is unknown/unspecified.
 *
 * Deliberately `analysis` (1.5): an uncategorised charge must never be
 * marked up MORE than it would have been before this change. Under-charging
 * is a business problem; over-charging without a stated basis is a
 * substantiation problem (docs/legal-ethics-risk-memo.md).
 */
export const DEFAULT_BILLING_CATEGORY: BillingCategory = "analysis";

export const DEFAULT_MARKUP_MULTIPLIER = MARKUP_MULTIPLIERS[DEFAULT_BILLING_CATEGORY];

/** The generation multiplier, named for callers that assert on it directly. */
export const GENERATION_MARKUP_MULTIPLIER = MARKUP_MULTIPLIERS.generation;
export const ANALYSIS_MARKUP_MULTIPLIER = MARKUP_MULTIPLIERS.analysis;

/** Human labels used in the published disclosure sentence. */
export const CATEGORY_LABELS: Readonly<Record<BillingCategory, string>> = {
  generation: "generation tasks",
  analysis: "analysis tasks",
};

/** One-line definition of each category, for disclosure surfaces. */
export const CATEGORY_DEFINITIONS: Readonly<Record<BillingCategory, string>> = {
  generation:
    "any model call whose output is newly authored work product delivered to you — application drafting, the illustrations brief, figure generation, draft revision, and export-bound prose.",
  analysis:
    "extraction, parsing, classification, transcription, retrieval, verification and critique, coverage scoring, interview questions, and routing.",
};

export function markupMultiplierFor(category: BillingCategory | null | undefined): number {
  if (!category) return DEFAULT_MARKUP_MULTIPLIER;
  return MARKUP_MULTIPLIERS[category] ?? DEFAULT_MARKUP_MULTIPLIER;
}

/**
 * Multipliers are integers in basis points internally so the money math is
 * exact — no floating-point cents. 1.5 → 15000, 2.0 → 20000.
 */
export function markupBasisPoints(multiplier: number): number {
  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    throw new Error("markup multiplier must be a positive finite number");
  }
  return Math.round(multiplier * 10_000);
}

/** "1.5", "2.0" — one decimal, matching how the rate is published. */
export function formatMultiplier(multiplier: number): string {
  return multiplier.toFixed(1);
}

/**
 * The published rate sentence fragment, derived from the catalog above so
 * product copy can never drift from what actually gets charged.
 *
 * With today's catalog: `provider cost × 2.0 for generation tasks, × 1.5 for
 * analysis tasks`. Both categories are named explicitly — there is no
 * "default plus exceptions" framing, because neither category is an
 * exception and a customer reading either half must get an accurate number.
 */
export function markupDisclosure(): string {
  const parts = BILLING_CATEGORIES.map(
    (category) =>
      `× ${formatMultiplier(MARKUP_MULTIPLIERS[category])} for ${CATEGORY_LABELS[category]}`,
  );
  return `provider cost ${parts.join(", ")}`;
}

/** Heading-sized form of the same fact: `cost × 2.0 generation / × 1.5 analysis`. */
export function markupDisclosureShort(): string {
  return `cost ${BILLING_CATEGORIES.map(
    (category) => `× ${formatMultiplier(MARKUP_MULTIPLIERS[category])} ${category}`,
  ).join(" / ")}`;
}

/**
 * The two-sentence disclosure used where there is room to define the terms
 * as well as state the rate (billing page, pricing page, AI disclosure).
 */
export function markupDisclosureWithDefinitions(): string {
  const definitions = BILLING_CATEGORIES.map(
    (category) =>
      `${formatMultiplier(MARKUP_MULTIPLIERS[category])}× ${category} is ${CATEGORY_DEFINITIONS[category]}`,
  ).join(" ");
  return `${markupDisclosure()}. ${definitions}`;
}
