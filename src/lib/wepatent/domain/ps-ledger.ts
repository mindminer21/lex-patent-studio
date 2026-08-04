/**
 * Problem/Solution ledger domain (Intake Studio PRD §5.4, §8, invariant 13).
 *
 * Non-negotiable rule encoded here: every AI-derived artifact starts as
 * `ai_proposed` and ONLY a human action can move it to `user_confirmed` or
 * `user_edited`. The model actor has exactly one capability — propose. It
 * can never confirm, edit, delete, or otherwise upgrade an item's state.
 */

/**
 * Neutral placeholder title an invention record starts with (no naming
 * step — design rule: minimize human steps and inputs). The record picks
 * up its real title the moment a working title is accepted or edited.
 */
export const PLACEHOLDER_RECORD_TITLE = "Untitled invention";

export const PS_PAIR_KINDS = ["problem", "solution"] as const;
export type PsPairKind = (typeof PS_PAIR_KINDS)[number];

export const PS_STATES = ["ai_proposed", "user_confirmed", "user_edited"] as const;
export type PsState = (typeof PS_STATES)[number];

export const PS_ORIGINS = ["upload_distillation", "interview", "manual"] as const;
export type PsOrigin = (typeof PS_ORIGINS)[number];

/** Who is attempting a ledger mutation. */
export type PsActor = "user" | "model";

export type PsAction = "propose" | "confirm" | "edit" | "delete" | "link" | "unlink";

/**
 * State a newly created item gets, by actor. AI output is a proposal by
 * construction; a human authoring an item directly has already exercised
 * judgment, so manual items start `user_confirmed`.
 */
export function initialPsState(actor: PsActor): PsState {
  return actor === "model" ? "ai_proposed" : "user_confirmed";
}

/**
 * Central guard for ledger mutations. Returns the resulting state for
 * state-changing actions, or `null` when the action is forbidden.
 *
 * - model: may only `propose` (state `ai_proposed`). Everything else is
 *   structurally refused — there is no code path for AI-set confirmation.
 * - user: may confirm an AI proposal, edit anything (result `user_edited`),
 *   delete anything, and manage links.
 */
export function applyPsAction(
  actor: PsActor,
  action: PsAction,
  current: PsState | null,
): { allowed: true; nextState: PsState | null } | { allowed: false } {
  if (actor === "model") {
    if (action === "propose" && current === null) {
      return { allowed: true, nextState: "ai_proposed" };
    }
    return { allowed: false };
  }
  switch (action) {
    case "propose":
      return current === null ? { allowed: true, nextState: initialPsState("user") } : { allowed: false };
    case "confirm":
      return current === "ai_proposed"
        ? { allowed: true, nextState: "user_confirmed" }
        : { allowed: false };
    case "edit":
      return current === null ? { allowed: false } : { allowed: true, nextState: "user_edited" };
    case "delete":
    case "link":
    case "unlink":
      return current === null ? { allowed: false } : { allowed: true, nextState: current };
    default:
      return { allowed: false };
  }
}

/** Event kinds recorded in the append-only ps_events log (PRD §8). */
export const PS_EVENT_KINDS = [
  "proposed",
  "confirmed",
  "edited",
  "deleted",
  "ai_proposal_rejected",
  "linked",
  "unlinked",
  "title_proposed",
  "title_edited",
  "title_confirmed",
  /** M3 ledger polish (feature PRD §5.4): merge/split + dismissal signals. */
  "merged",
  "split",
  "proposal_dismissed",
] as const;
export type PsEventKind = (typeof PS_EVENT_KINDS)[number];

/**
 * Deleting an AI proposal is a REJECTION signal (PRD §5.4 — it steers the
 * M2 interview away from rejected framings); deleting a user item is a
 * plain deletion.
 */
export function deletionEventKind(state: PsState): PsEventKind {
  return state === "ai_proposed" ? "ai_proposal_rejected" : "deleted";
}

export function isPsState(value: string): value is PsState {
  return (PS_STATES as readonly string[]).includes(value);
}

export function isPsPairKind(value: string): value is PsPairKind {
  return (PS_PAIR_KINDS as readonly string[]).includes(value);
}
