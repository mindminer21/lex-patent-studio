import { canDecideReview, type Role } from "./roles";
import type { WorkTier } from "./tiers";

/**
 * Review / approval state machine (PRD-lex-patent-studio §9.6, Invariant 16).
 *
 * - No workflow output is marked approved except by an AUTHENTICATED HUMAN
 *   with the required role. Model output can never set review state.
 * - Approval unlocks export-as-approved; unapproved exports remain
 *   watermarked "DRAFT — NOT REVIEWED".
 * - Every decision records actor, timestamp, and document-version hash.
 */

export const REVIEW_STATES = [
  "pending_review",
  "changes_requested",
  "approved",
  "rejected",
] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

export const REVIEW_STATE_LABELS: Record<ReviewState, string> = {
  pending_review: "Pending review",
  changes_requested: "Changes requested",
  approved: "Approved",
  rejected: "Rejected",
};

export const REVIEW_DECISIONS = ["approve", "request_changes", "reject"] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

const DECISION_RESULT: Record<ReviewDecision, ReviewState> = {
  approve: "approved",
  request_changes: "changes_requested",
  reject: "rejected",
};

const REVIEW_TRANSITIONS: Record<ReviewState, ReadonlySet<ReviewState>> = {
  pending_review: new Set(["approved", "changes_requested", "rejected"]),
  // A revised version re-enters review; the revision itself is a new
  // pending item, so from changes_requested only re-submission applies.
  changes_requested: new Set(["pending_review"]),
  // Approval may be withdrawn by a human (reopens review); never by a model.
  approved: new Set(["pending_review"]),
  rejected: new Set(),
};

export type ReviewActorType = "human" | "model" | "system";

export interface ReviewActor {
  type: ReviewActorType;
  userId?: string;
  role?: Role;
  authenticated?: boolean;
}

export type ReviewDecisionResult =
  | { ok: true; nextState: ReviewState }
  | { ok: false; error: string };

export function canTransitionReview(from: ReviewState, to: ReviewState): boolean {
  return REVIEW_TRANSITIONS[from]?.has(to) ?? false;
}

/**
 * The single gate for review-state changes. Refuses:
 *  - any non-human actor (Invariant 16 — model output can never set review state)
 *  - unauthenticated humans
 *  - humans whose role lacks decision rights at the item's tier
 *  - invalid state transitions
 */
export function applyReviewDecision(params: {
  current: ReviewState;
  decision: ReviewDecision;
  tier: WorkTier;
  actor: ReviewActor;
}): ReviewDecisionResult {
  const { current, decision, tier, actor } = params;

  if (actor.type !== "human") {
    return {
      ok: false,
      error: `Review state can only be set by an authenticated human; actor type "${actor.type}" is not permitted (Invariant 16).`,
    };
  }
  if (!actor.authenticated || !actor.userId) {
    return { ok: false, error: "Review decisions require an authenticated user." };
  }
  if (!actor.role || !canDecideReview(actor.role, tier)) {
    return {
      ok: false,
      error: `Role "${actor.role ?? "none"}" may not decide Tier-${tier} review items.`,
    };
  }

  const nextState = DECISION_RESULT[decision];
  if (!canTransitionReview(current, nextState)) {
    return {
      ok: false,
      error: `Invalid review transition: ${current} → ${nextState}.`,
    };
  }
  return { ok: true, nextState };
}

/** Watermark rule (PRD §9.6.4). */
export function exportWatermark(state: ReviewState): string | null {
  return state === "approved" ? null : "DRAFT — NOT REVIEWED";
}
