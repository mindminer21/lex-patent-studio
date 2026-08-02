"use server";

import { redirect } from "next/navigation";
import { requireOrg } from "@/lib/server/session";
import {
  createInvitation,
  revokeInvitation,
} from "@/lib/server/services/invitations";
import { runRetentionPurge, updateRetentionPolicy } from "@/lib/server/services/retention";

/** FR-3: owner-adjustable retention window (30-3650 days), audited. */
export async function updateRetentionAction(formData: FormData): Promise<void> {
  const context = await requireOrg();
  const result = await updateRetentionPolicy({
    organizationId: context.organization.id,
    actorUserId: context.user.id,
    actorRole: context.membership.role,
    retentionDays: formData.get("retentionDays"),
  });
  redirect(
    result.ok ? "/app/settings?retention=updated" : `/app/settings?error=retention_${result.error}`,
  );
}

/** FR-3: retention-aware purge of soft-deleted records, audited. */
export async function runPurgeAction(): Promise<void> {
  const context = await requireOrg();
  const result = await runRetentionPurge({
    organizationId: context.organization.id,
    actorUserId: context.user.id,
    actorRole: context.membership.role,
  });
  redirect(
    result.ok
      ? `/app/settings?purged=${result.purged}&pending=${result.pending}`
      : `/app/settings?error=retention_${result.error}`,
  );
}

export async function inviteMemberAction(formData: FormData): Promise<void> {
  const context = await requireOrg();
  const result = await createInvitation({
    organizationId: context.organization.id,
    inviterUserId: context.user.id,
    inviterRole: context.membership.role,
    input: {
      email: String(formData.get("email") ?? "").trim().toLowerCase(),
      role: String(formData.get("role") ?? ""),
    },
  });
  if (!result.ok) {
    redirect(`/app/settings?error=${result.error}`);
  }
  // The raw token appears exactly once. Local mode surfaces the accept link
  // in the UI because sending email is approval-gated (PRD §17.6).
  redirect(
    `/app/settings?invited=${result.invitation.id}${result.token ? `&token=${encodeURIComponent(result.token)}` : "&existing=1"}`,
  );
}

export async function revokeInvitationAction(formData: FormData): Promise<void> {
  const context = await requireOrg();
  await revokeInvitation({
    organizationId: context.organization.id,
    invitationId: String(formData.get("invitationId") ?? ""),
    actorUserId: context.user.id,
    actorRole: context.membership.role,
  });
  redirect("/app/settings");
}
