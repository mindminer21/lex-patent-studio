/**
 * Role policy (PRD FR-2).
 *
 * Seven roles. The first four are ordinary organization roles; the two
 * counsel roles belong to the connected-counsel administration lane and are
 * never granted through ordinary organization membership flows;
 * `platform_support` has no standing permissions (break-glass is disabled by
 * default and fully audited).
 */
export const ROLES = [
  "owner",
  "admin",
  "member",
  "viewer",
  "counsel_intake",
  "counsel_attorney",
  "platform_support",
] as const;

export type Role = (typeof ROLES)[number];

export const ORDINARY_USER_ROLES: readonly Role[] = ["owner", "admin", "member", "viewer"];
export const COUNSEL_ROLES: readonly Role[] = ["counsel_intake", "counsel_attorney"];

export const ACTIONS = [
  "org.manage",
  "org.members.manage",
  "billing.manage",
  "invention.view",
  "invention.create",
  "invention.edit",
  "draft.generate",
  "export.create",
  "counsel_request.create",
  "counsel_request.submit",
  "counsel.conflict.review",
  "counsel.request.decide",
  "counsel.engagement.manage",
  "counsel.matter.convert",
] as const;

export type Action = (typeof ACTIONS)[number];

const GRANTS: Record<Role, readonly Action[]> = {
  owner: [
    "org.manage",
    "org.members.manage",
    "billing.manage",
    "invention.view",
    "invention.create",
    "invention.edit",
    "draft.generate",
    "export.create",
    "counsel_request.create",
    "counsel_request.submit",
  ],
  admin: [
    "org.members.manage",
    "billing.manage",
    "invention.view",
    "invention.create",
    "invention.edit",
    "draft.generate",
    "export.create",
    "counsel_request.create",
    "counsel_request.submit",
  ],
  member: [
    "invention.view",
    "invention.create",
    "invention.edit",
    "draft.generate",
    "export.create",
    "counsel_request.create",
    "counsel_request.submit",
  ],
  viewer: ["invention.view"],
  counsel_intake: ["counsel.conflict.review"],
  counsel_attorney: [
    "counsel.conflict.review",
    "counsel.request.decide",
    "counsel.engagement.manage",
    "counsel.matter.convert",
  ],
  // Break-glass support access is disabled by default (PRD FR-2).
  platform_support: [],
};

export function can(role: Role, action: Action): boolean {
  return GRANTS[role].includes(action);
}

export function isOrdinaryUserRole(role: Role): boolean {
  return ORDINARY_USER_ROLES.includes(role);
}

export function isCounselRole(role: Role): boolean {
  return COUNSEL_ROLES.includes(role);
}
