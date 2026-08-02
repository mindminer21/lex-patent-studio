import type { Role } from "./roles";

/**
 * Connected-counsel request state machine (PRD §7.6).
 *
 * draft → submitted → conflict_review → declined | consultation_offered
 *   → consultation_scheduled → engagement_offered → engagement_signed
 *   → converted_to_matter
 *
 * Invariants enforced here:
 * - counsel_request !== engagement. No transition infers representation from
 *   signup, payment, upload, or scheduling.
 * - Ordinary user actions cannot skip states: only adjacent transitions
 *   exist, and counsel-side transitions require counsel roles.
 * - Model or system actors can never move this machine.
 */
export const COUNSEL_REQUEST_STATES = [
  "draft",
  "submitted",
  "conflict_review",
  "declined",
  "consultation_offered",
  "consultation_scheduled",
  "engagement_offered",
  "engagement_signed",
  "converted_to_matter",
] as const;

export type CounselRequestState = (typeof COUNSEL_REQUEST_STATES)[number];

export type CounselActor =
  | { kind: "user"; role: Role }
  | { kind: "system" }
  | { kind: "model" };

export const COUNSEL_REQUEST_ACTIONS = [
  "submit",
  "begin_conflict_review",
  "decline",
  "offer_consultation",
  "schedule_consultation",
  "offer_engagement",
  "record_signed_engagement",
  "convert_to_matter",
] as const;

export type CounselRequestAction = (typeof COUNSEL_REQUEST_ACTIONS)[number];

type TransitionRule = {
  action: CounselRequestAction;
  from: CounselRequestState;
  to: CounselRequestState;
  /** Roles allowed to perform this transition. Empty means nobody. */
  roles: readonly Role[];
  /** Human description shown in UI and audit events. */
  description: string;
  /** Requires supporting evidence reference (e.g. signed engagement doc). */
  requiresEvidence?: boolean;
};

const REQUESTER_ROLES: readonly Role[] = ["owner", "admin", "member"];

export const COUNSEL_REQUEST_TRANSITIONS: readonly TransitionRule[] = [
  {
    action: "submit",
    from: "draft",
    to: "submitted",
    roles: REQUESTER_ROLES,
    description: "Submit limited conflict-intake information to connected counsel.",
  },
  {
    action: "begin_conflict_review",
    from: "submitted",
    to: "conflict_review",
    roles: ["counsel_intake", "counsel_attorney"],
    description: "Counsel administrator begins conflict review.",
  },
  {
    action: "decline",
    from: "conflict_review",
    to: "declined",
    roles: ["counsel_attorney"],
    description: "Attorney declines the request after conflict review.",
  },
  {
    action: "offer_consultation",
    from: "conflict_review",
    to: "consultation_offered",
    roles: ["counsel_attorney"],
    description: "Attorney accepts the request for an initial consultation.",
  },
  {
    action: "schedule_consultation",
    from: "consultation_offered",
    to: "consultation_scheduled",
    roles: [...REQUESTER_ROLES, "counsel_intake"],
    description: "A consultation time is scheduled. Scheduling does not create representation.",
  },
  {
    action: "offer_engagement",
    from: "consultation_scheduled",
    to: "engagement_offered",
    roles: ["counsel_attorney"],
    description: "Attorney offers an engagement with defined scope and fees.",
  },
  {
    action: "record_signed_engagement",
    from: "engagement_offered",
    to: "engagement_signed",
    roles: ["counsel_attorney"],
    description:
      "Counsel records the fully signed engagement agreement. Representation is defined by the signed engagement letter, not by wepatent.",
    requiresEvidence: true,
  },
  {
    action: "convert_to_matter",
    from: "engagement_signed",
    to: "converted_to_matter",
    roles: ["counsel_attorney"],
    description: "Attorney converts the accepted engagement into a legal matter.",
  },
];

export const TERMINAL_COUNSEL_STATES: readonly CounselRequestState[] = [
  "declined",
  "converted_to_matter",
];

export type TransitionResult =
  | { ok: true; next: CounselRequestState; rule: TransitionRule }
  | {
      ok: false;
      error:
        | "unknown_action"
        | "invalid_from_state"
        | "actor_not_allowed"
        | "evidence_required";
    };

function actorRole(actor: CounselActor): Role | null {
  return actor.kind === "user" ? actor.role : null;
}

export function canTransition(
  from: CounselRequestState,
  to: CounselRequestState,
  actor: CounselActor,
): boolean {
  const rule = COUNSEL_REQUEST_TRANSITIONS.find((t) => t.from === from && t.to === to);
  if (!rule) return false;
  const role = actorRole(actor);
  if (role === null) return false; // system and model actors can never move this machine
  return rule.roles.includes(role);
}

export function applyTransition(
  from: CounselRequestState,
  action: CounselRequestAction,
  actor: CounselActor,
  options?: { evidenceRef?: string },
): TransitionResult {
  const rule = COUNSEL_REQUEST_TRANSITIONS.find((t) => t.action === action);
  if (!rule) return { ok: false, error: "unknown_action" };
  if (rule.from !== from) return { ok: false, error: "invalid_from_state" };
  const role = actorRole(actor);
  if (role === null || !rule.roles.includes(role)) {
    return { ok: false, error: "actor_not_allowed" };
  }
  if (rule.requiresEvidence && !options?.evidenceRef) {
    return { ok: false, error: "evidence_required" };
  }
  return { ok: true, next: rule.to, rule };
}

export function availableActions(
  state: CounselRequestState,
  actor: CounselActor,
): CounselRequestAction[] {
  const role = actorRole(actor);
  if (role === null) return [];
  return COUNSEL_REQUEST_TRANSITIONS.filter(
    (t) => t.from === state && t.roles.includes(role),
  ).map((t) => t.action);
}

export function isTerminal(state: CounselRequestState): boolean {
  return TERMINAL_COUNSEL_STATES.includes(state);
}

/**
 * Conspicuous representation status for every stage of the flow (PRD §7.6).
 * No state before engagement_signed may ever read as represented.
 */
export function representationStatus(state: CounselRequestState): {
  represented: boolean;
  label: string;
  detail: string;
} {
  if (state === "engagement_signed" || state === "converted_to_matter") {
    return {
      represented: true,
      label: "Engagement signed",
      detail:
        "Representation exists only as defined by the signed engagement letter with the identified law firm — not through wepatent, and not for any matter outside the engagement's scope.",
    };
  }
  return {
    represented: false,
    label: "Not yet represented",
    detail:
      "You are not represented by any law firm through this request. Submitting a request, conflict review, scheduling, or consultation does not create an attorney-client relationship.",
  };
}
