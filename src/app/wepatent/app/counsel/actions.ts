"use server";

import { redirect } from "next/navigation";
import {
  COUNSEL_REQUEST_ACTIONS,
  type CounselRequestAction,
} from "@/lib/wepatent/domain/counsel-request";
import { requireOnboarded } from "@/lib/server/session";
import { performCounselAction } from "@/lib/server/services/counsel";

/**
 * Requester-side transitions only: the actor is the signed-in user's real
 * organization role. The domain state machine rejects anything the role is
 * not allowed to do — ordinary users cannot skip states (PRD §7.6).
 */
export async function requesterCounselAction(formData: FormData): Promise<void> {
  const context = await requireOnboarded();
  const action = String(formData.get("action") ?? "") as CounselRequestAction;
  const requestId = String(formData.get("requestId") ?? "");
  if (!COUNSEL_REQUEST_ACTIONS.includes(action)) {
    redirect("/wepatent/app/counsel?error=unknown_action");
  }
  const result = await performCounselAction({
    organizationId: context.organization.id,
    requestId,
    action,
    actor: { kind: "user", role: context.membership.role },
    actorUserId: context.user.id,
    actorRole: context.membership.role,
  });
  redirect(`/wepatent/app/counsel${result.ok ? "" : `?error=${result.error}`}`);
}

