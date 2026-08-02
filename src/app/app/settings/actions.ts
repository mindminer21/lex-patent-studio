"use server";

import { redirect } from "next/navigation";
import { requireOrg } from "@/lib/server/session";
import {
  createInvitation,
  revokeInvitation,
} from "@/lib/server/services/invitations";

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
