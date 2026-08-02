"use server";

import { redirect } from "next/navigation";
import {
  COUNSEL_REQUEST_ACTIONS,
  type CounselRequestAction,
} from "@/lib/wepatent/domain/counsel-request";
import { requireOnboarded } from "@/lib/server/session";
import {
  createCounselRequest,
  performCounselAction,
} from "@/lib/server/services/counsel";

export async function createCounselRequestAction(formData: FormData): Promise<void> {
  const context = await requireOnboarded();
  const result = await createCounselRequest({
    organizationId: context.organization.id,
    userId: context.user.id,
    input: {
      inventionId: String(formData.get("inventionId") ?? "") || null,
      requestSummary: String(formData.get("requestSummary") ?? ""),
      adverseParties: String(formData.get("adverseParties") ?? ""),
      jurisdiction: String(formData.get("jurisdiction") ?? ""),
      contactEmail: String(formData.get("contactEmail") ?? ""),
    },
  });
  redirect(`/wepatent/app/counsel${result.ok ? "" : "?error=invalid_input"}`);
}

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

