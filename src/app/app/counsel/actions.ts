"use server";

import { redirect } from "next/navigation";
import {
  COUNSEL_REQUEST_ACTIONS,
  type CounselRequestAction,
} from "@/lib/domain/counsel-request";
import { isLocalMode } from "@/lib/env";
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
  redirect(`/app/counsel${result.ok ? "" : "?error=invalid_input"}`);
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
    redirect("/app/counsel?error=unknown_action");
  }
  const result = await performCounselAction({
    organizationId: context.organization.id,
    requestId,
    action,
    actor: { kind: "user", role: context.membership.role },
    actorUserId: context.user.id,
    actorRole: context.membership.role,
  });
  redirect(`/app/counsel${result.ok ? "" : `?error=${result.error}`}`);
}

/**
 * LOCAL MODE ONLY: simulates the separate connected-counsel administration
 * lane (PRD §6.3) so the full state machine can be exercised without a
 * counsel deployment. It still runs through the same domain guards with an
 * explicit counsel role — it is a stand-in for the counsel UI, not a
 * bypass. Disabled outside local mode.
 */
export async function simulateCounselAdminAction(formData: FormData): Promise<void> {
  if (!isLocalMode) {
    redirect("/app/counsel?error=not_available");
  }
  const context = await requireOnboarded();
  const action = String(formData.get("action") ?? "") as CounselRequestAction;
  const requestId = String(formData.get("requestId") ?? "");
  const role = String(formData.get("role") ?? "");
  const evidenceRef = String(formData.get("evidenceRef") ?? "") || undefined;
  if (
    !COUNSEL_REQUEST_ACTIONS.includes(action) ||
    (role !== "counsel_intake" && role !== "counsel_attorney")
  ) {
    redirect("/app/counsel?error=unknown_action");
  }
  const counselRole = role as "counsel_intake" | "counsel_attorney";
  const result = await performCounselAction({
    organizationId: context.organization.id,
    requestId,
    action,
    actor: { kind: "user", role: counselRole },
    actorUserId: `local-simulated-${counselRole}`,
    actorRole: counselRole,
    evidenceRef,
  });
  redirect(`/app/counsel${result.ok ? "" : `?error=${result.error}`}`);
}
