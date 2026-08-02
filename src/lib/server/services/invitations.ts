import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { can, type Role } from "@/lib/domain/roles";
import { getAdapters } from "../adapters";
import type { Id, InvitationRecord, MembershipRecord } from "../adapters/types";

/**
 * Invitations (PRD §7.1): idempotent, expiring.
 *
 * - Only owner/admin can invite; invitable roles are admin/member/viewer.
 *   Counsel roles are structurally impossible here (validated AND excluded
 *   by the DB check constraint).
 * - One pending invitation per organization+email: re-inviting returns the
 *   existing pending invitation instead of minting a duplicate.
 * - The raw token is returned exactly once at creation; only its SHA-256
 *   lands in storage.
 * - Acceptance is idempotent: accepting the same invitation again (same
 *   user) succeeds without creating a second membership; a different user
 *   is rejected. Expired and revoked invitations never grant access.
 */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const INVITABLE_ROLES = ["admin", "member", "viewer"] as const;

export const inviteInputSchema = z.object({
  email: z.email(),
  role: z.enum(INVITABLE_ROLES),
});

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type InvitationStatus = "pending" | "accepted" | "revoked" | "expired";

export function invitationStatus(
  invitation: InvitationRecord,
  now: Date = new Date(),
): InvitationStatus {
  if (invitation.revokedAt) return "revoked";
  if (invitation.acceptedAt) return "accepted";
  if (Date.parse(invitation.expiresAt) < now.getTime()) return "expired";
  return "pending";
}

export type CreateInvitationResult =
  | { ok: true; invitation: InvitationRecord; token: string | null; existing: boolean }
  | { ok: false; error: "forbidden" | "invalid_input" | "already_member" };

export async function createInvitation(params: {
  organizationId: Id;
  inviterUserId: Id;
  inviterRole: Role;
  input: unknown;
}): Promise<CreateInvitationResult> {
  if (!can(params.inviterRole, "org.members.manage")) {
    return { ok: false, error: "forbidden" };
  }
  const parsed = inviteInputSchema.safeParse(params.input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const email = parsed.data.email.trim().toLowerCase();

  const { data } = getAdapters();

  // Existing member? No invitation needed.
  const existingUser = await data.getUserByEmail(email);
  if (existingUser) {
    const memberships = await data.getMembershipsForOrganization(params.organizationId);
    if (memberships.some((membership) => membership.userId === existingUser.id)) {
      return { ok: false, error: "already_member" };
    }
  }

  // Idempotent per organization+email: return the pending one.
  const invitations = await data.listInvitations(params.organizationId);
  const pending = invitations.find(
    (invitation) =>
      invitation.email === email && invitationStatus(invitation) === "pending",
  );
  if (pending) {
    return { ok: true, invitation: pending, token: null, existing: true };
  }

  const token = randomBytes(24).toString("base64url");
  const invitation = await data.createInvitation({
    organizationId: params.organizationId,
    email,
    role: parsed.data.role,
    tokenHash: hashInvitationToken(token),
    invitedBy: params.inviterUserId,
    expiresAt: new Date(Date.now() + INVITATION_TTL_MS).toISOString(),
  });
  await data.appendAuditEvent({
    organizationId: params.organizationId,
    actor: params.inviterUserId,
    action: "invitation.created",
    target: invitation.id,
    // Email addresses are not logged; the invitation row holds them.
    meta: { role: parsed.data.role },
  });
  return { ok: true, invitation, token, existing: false };
}

export type AcceptInvitationResult =
  | { ok: true; membership: MembershipRecord; alreadyAccepted: boolean }
  | {
      ok: false;
      error:
        | "invalid_token"
        | "expired"
        | "revoked"
        | "already_used"
        | "email_mismatch"
        | "already_in_organization";
    };

export async function acceptInvitation(params: {
  token: string;
  userId: Id;
  userEmail: string;
}): Promise<AcceptInvitationResult> {
  const { data } = getAdapters();
  const invitation = await data.getInvitationByTokenHash(hashInvitationToken(params.token));
  if (!invitation) return { ok: false, error: "invalid_token" };

  const status = invitationStatus(invitation);
  if (status === "revoked") return { ok: false, error: "revoked" };

  if (status === "accepted") {
    // Idempotent for the same user; anyone else is rejected.
    if (invitation.acceptedBy === params.userId) {
      const memberships = await data.getMembershipsForUser(params.userId);
      const membership = memberships.find(
        (entry) => entry.organizationId === invitation.organizationId,
      );
      if (membership) return { ok: true, membership, alreadyAccepted: true };
    }
    return { ok: false, error: "already_used" };
  }
  if (status === "expired") return { ok: false, error: "expired" };

  if (invitation.email !== params.userEmail.trim().toLowerCase()) {
    return { ok: false, error: "email_mismatch" };
  }

  const memberships = await data.getMembershipsForUser(params.userId);
  const existing = memberships.find(
    (entry) => entry.organizationId === invitation.organizationId,
  );
  if (existing) {
    // Already a member (e.g. concurrent accept): mark and succeed.
    await data.updateInvitation(invitation.id, {
      acceptedAt: new Date().toISOString(),
      acceptedBy: params.userId,
    });
    return { ok: true, membership: existing, alreadyAccepted: true };
  }
  if (memberships.length > 0) {
    // The workspace model is one organization per user for now (PRD §7.1
    // dashboard flow); joining a second org is a deliberate later feature.
    return { ok: false, error: "already_in_organization" };
  }

  const membership = await data.createMembership({
    organizationId: invitation.organizationId,
    userId: params.userId,
    role: invitation.role,
  });
  await data.updateInvitation(invitation.id, {
    acceptedAt: new Date().toISOString(),
    acceptedBy: params.userId,
  });
  await data.appendAuditEvent({
    organizationId: invitation.organizationId,
    actor: params.userId,
    action: "invitation.accepted",
    target: invitation.id,
    meta: { role: invitation.role },
  });
  return { ok: true, membership, alreadyAccepted: false };
}

export async function revokeInvitation(params: {
  organizationId: Id;
  invitationId: Id;
  actorUserId: Id;
  actorRole: Role;
}): Promise<{ ok: boolean }> {
  if (!can(params.actorRole, "org.members.manage")) return { ok: false };
  const { data } = getAdapters();
  const invitations = await data.listInvitations(params.organizationId);
  const invitation = invitations.find((entry) => entry.id === params.invitationId);
  if (!invitation || invitationStatus(invitation) !== "pending") return { ok: false };
  await data.updateInvitation(invitation.id, { revokedAt: new Date().toISOString() });
  await data.appendAuditEvent({
    organizationId: params.organizationId,
    actor: params.actorUserId,
    action: "invitation.revoked",
    target: invitation.id,
    meta: {},
  });
  return { ok: true };
}
