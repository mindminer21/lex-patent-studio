import type { WorkTier } from "./tiers";

/**
 * Role and permission policy (PRD-lex-patent-studio FR-2, Invariant 21).
 *
 * Nine roles. Workflow invocation, tier actions, approval rights, export
 * rights, and portfolio visibility are role-gated SERVER-SIDE via this policy
 * table — never by route checks or UI hiding alone.
 */

export const ROLES = [
  "owner",
  "practitioner_admin",
  "practitioner",
  "agent_operator",
  "contributor",
  "viewer",
  "counsel_intake",
  "counsel_attorney",
  "platform_support",
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  practitioner_admin: "Practitioner admin",
  practitioner: "Practitioner",
  agent_operator: "Agent / paralegal operator",
  contributor: "Contributor (R&D seat)",
  viewer: "Viewer",
  counsel_intake: "Counsel intake",
  counsel_attorney: "Counsel attorney",
  platform_support: "Platform support",
};

export const ACTIONS = [
  // Matter lifecycle
  "matter.create",
  "matter.view",
  "matter.edit",
  "matter.close",
  // Facts and sources
  "facts.contribute",
  "facts.approve",
  "sources.upload",
  // Workflow invocation by tier (Invariant 21: contributor seats cannot
  // invoke generation, claim, prosecution, or research workflows).
  "workflow.invoke.tierA",
  "workflow.invoke.tierB",
  "workflow.invoke.tierC",
  // Review decisions by tier (Invariant 16: only authenticated humans with
  // the required role can set review state).
  "review.decide.tierA",
  "review.decide.tierB",
  "review.decide.tierC",
  // Exports
  "export.draft",
  "export.approved",
  // Portfolio, templates, admin
  "portfolio.view",
  "styles.manage",
  "playbook.publish",
  "team.manage",
  "billing.manage",
  "audit.view",
  // Connected-counsel context (separately gated lane)
  "counsel.intake.view",
  "counsel.matter.manage",
  // Support (break-glass; disabled by default, fully audited)
  "support.readonly",
] as const;
export type Action = (typeof ACTIONS)[number];

const PRACTITIONER_ACTIONS: Action[] = [
  "matter.create",
  "matter.view",
  "matter.edit",
  "matter.close",
  "facts.contribute",
  "facts.approve",
  "sources.upload",
  "workflow.invoke.tierA",
  "workflow.invoke.tierB",
  "workflow.invoke.tierC",
  "review.decide.tierA",
  "review.decide.tierB",
  "review.decide.tierC",
  "export.draft",
  "export.approved",
  "portfolio.view",
  "styles.manage",
  "playbook.publish",
  "audit.view",
];

/**
 * The policy table. A role may perform an action iff it appears here.
 * Deny-by-default: anything not listed is refused.
 */
export const ROLE_POLICY: Record<Role, ReadonlySet<Action>> = {
  owner: new Set<Action>([...PRACTITIONER_ACTIONS, "team.manage", "billing.manage"]),
  practitioner_admin: new Set<Action>([
    ...PRACTITIONER_ACTIONS,
    "team.manage",
    "billing.manage",
  ]),
  practitioner: new Set<Action>(PRACTITIONER_ACTIONS),
  agent_operator: new Set<Action>([
    "matter.view",
    "facts.contribute",
    "sources.upload",
    "workflow.invoke.tierA",
    // Operators PREPARE Tier-B drafts and route them to the responsible
    // attorney (PRD §4.4) — invocation allowed, decision NOT.
    "workflow.invoke.tierB",
    "review.decide.tierA",
    "export.draft",
    "audit.view",
  ]),
  contributor: new Set<Action>([
    // R&D seat: intake, fact contribution, source upload, status visibility.
    // NO generation, claim, prosecution, or research workflows (Invariant 21).
    "matter.view",
    "facts.contribute",
    "sources.upload",
  ]),
  viewer: new Set<Action>(["matter.view"]),
  counsel_intake: new Set<Action>(["counsel.intake.view"]),
  counsel_attorney: new Set<Action>([
    "counsel.intake.view",
    "counsel.matter.manage",
  ]),
  platform_support: new Set<Action>(["support.readonly"]),
};

/** Permission predicate. Deny-by-default. */
export function can(role: Role, action: Action): boolean {
  return ROLE_POLICY[role]?.has(action) ?? false;
}

/** Map a work tier to the action required to invoke a workflow at that tier. */
export function invokeActionForTier(tier: WorkTier): Action {
  return `workflow.invoke.tier${tier}` as Action;
}

/** Map a work tier to the action required to decide a review at that tier. */
export function decideActionForTier(tier: WorkTier): Action {
  return `review.decide.tier${tier}` as Action;
}

/** May this role invoke a workflow whose effective tier is `tier`? */
export function canInvokeWorkflow(role: Role, tier: WorkTier): boolean {
  return can(role, invokeActionForTier(tier));
}

/** May this role record a review decision for an item at `tier`? */
export function canDecideReview(role: Role, tier: WorkTier): boolean {
  return can(role, decideActionForTier(tier));
}
