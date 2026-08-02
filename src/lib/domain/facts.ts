import { z } from "zod";

/**
 * Fact provenance states (PRD FR-3) and mutation rules.
 *
 * Canonical facts are separate from generated prose. Invariants:
 * - Model actors can NEVER create, edit, or transition a fact (PRD §5.9,
 *   §7.4: "Model output cannot mutate facts or mark itself approved").
 * - Only counsel actors can mark a fact `counsel_reviewed`.
 * - A user edit to a reviewed fact demotes it back to `user_asserted`.
 */
export const FACT_PROVENANCE_STATES = [
  "user_asserted",
  "source_supported",
  "needs_confirmation",
  "disputed",
  "counsel_reviewed",
] as const;

export type FactProvenance = (typeof FACT_PROVENANCE_STATES)[number];

export type FactActor = "user" | "counsel" | "system" | "model";

export const FACT_CATEGORIES = [
  "technical",
  "contributor",
  "timeline",
  "ownership",
  "business",
] as const;

export type FactCategory = (typeof FACT_CATEGORIES)[number];

export const factInputSchema = z.object({
  category: z.enum(FACT_CATEGORIES),
  statement: z.string().trim().min(3).max(8_000),
});

/** Which provenance transitions each actor may perform. */
const ALLOWED: Record<FactActor, Array<{ from: FactProvenance | "*"; to: FactProvenance }>> = {
  user: [
    { from: "*", to: "user_asserted" }, // user edit / re-assertion
    { from: "*", to: "needs_confirmation" },
    { from: "*", to: "disputed" },
  ],
  counsel: [
    { from: "*", to: "counsel_reviewed" },
    { from: "*", to: "needs_confirmation" },
    { from: "*", to: "disputed" },
  ],
  system: [
    // Deterministic pipeline results only (e.g. extraction linked a source).
    { from: "user_asserted", to: "source_supported" },
    { from: "needs_confirmation", to: "source_supported" },
    { from: "user_asserted", to: "needs_confirmation" },
  ],
  // Model output is untrusted data: no fact mutations, ever.
  model: [],
};

export function canMutateFacts(actor: FactActor): boolean {
  return actor !== "model";
}

export function canTransitionFact(
  actor: FactActor,
  from: FactProvenance,
  to: FactProvenance,
): boolean {
  if (from === to) return false;
  return ALLOWED[actor].some((rule) => (rule.from === "*" || rule.from === from) && rule.to === to);
}

export type FactTransitionResult =
  | { ok: true; next: FactProvenance }
  | { ok: false; error: "actor_not_allowed" | "no_change" };

export function transitionFact(
  actor: FactActor,
  from: FactProvenance,
  to: FactProvenance,
): FactTransitionResult {
  // Actors with no mutation rights (model) are rejected before anything else.
  if (ALLOWED[actor].length === 0) return { ok: false, error: "actor_not_allowed" };
  if (from === to) return { ok: false, error: "no_change" };
  if (!canTransitionFact(actor, from, to)) return { ok: false, error: "actor_not_allowed" };
  return { ok: true, next: to };
}

/** Unresolved facts block a "counsel-ready" signal and surface in review. */
export function isUnresolved(state: FactProvenance): boolean {
  return state === "needs_confirmation" || state === "disputed";
}
