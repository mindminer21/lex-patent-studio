/**
 * Fact provenance states (PRD-lex-patent-studio §5.1 "Intake and disclosure",
 * PRD-wepatent FR-3).
 *
 * Every fact in the ledger carries provenance and status. `counsel_reviewed`
 * may only be set by a human practitioner action (Invariant 16 analog for
 * facts); model or system actors can propose `needs_confirmation` or
 * `source_supported`, never counsel review.
 */

export const FACT_PROVENANCE_STATES = [
  "user_asserted",
  "source_supported",
  "needs_confirmation",
  "disputed",
  "counsel_reviewed",
] as const;
export type FactProvenance = (typeof FACT_PROVENANCE_STATES)[number];

export const FACT_PROVENANCE_LABELS: Record<FactProvenance, string> = {
  user_asserted: "User asserted",
  source_supported: "Source supported",
  needs_confirmation: "Needs confirmation",
  disputed: "Disputed",
  counsel_reviewed: "Counsel reviewed",
};

const FACT_TRANSITIONS: Record<FactProvenance, ReadonlySet<FactProvenance>> = {
  user_asserted: new Set([
    "source_supported",
    "needs_confirmation",
    "disputed",
    "counsel_reviewed",
  ]),
  source_supported: new Set(["disputed", "needs_confirmation", "counsel_reviewed"]),
  needs_confirmation: new Set([
    "user_asserted",
    "source_supported",
    "disputed",
    "counsel_reviewed",
  ]),
  disputed: new Set(["needs_confirmation", "counsel_reviewed"]),
  // Counsel review is not un-reviewable by non-humans; a human may reopen.
  counsel_reviewed: new Set(["disputed", "needs_confirmation"]),
};

export type FactActor = "human" | "model" | "system";

/** States a non-human actor may set. Counsel review is human-only. */
const NON_HUMAN_SETTABLE: ReadonlySet<FactProvenance> = new Set([
  "source_supported",
  "needs_confirmation",
]);

export function canTransitionFact(
  from: FactProvenance,
  to: FactProvenance,
  actor: FactActor,
): boolean {
  if (!FACT_TRANSITIONS[from]?.has(to)) return false;
  if (actor !== "human" && !NON_HUMAN_SETTABLE.has(to)) return false;
  return true;
}

export class InvalidFactTransitionError extends Error {
  constructor(from: FactProvenance, to: FactProvenance, actor: FactActor) {
    super(`Invalid fact provenance transition: ${from} → ${to} by ${actor}`);
    this.name = "InvalidFactTransitionError";
  }
}

export function transitionFact(
  from: FactProvenance,
  to: FactProvenance,
  actor: FactActor,
): FactProvenance {
  if (!canTransitionFact(from, to, actor)) {
    throw new InvalidFactTransitionError(from, to, actor);
  }
  return to;
}

/** Drafting may only draw on these states (PRD §9.2: approved fact baseline). */
export function isDraftableProvenance(state: FactProvenance): boolean {
  return state === "counsel_reviewed";
}
