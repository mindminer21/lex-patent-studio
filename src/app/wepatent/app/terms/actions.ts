"use server";

import { redirect } from "next/navigation";
import { ACKNOWLEDGEMENT_KEYS } from "@/lib/wepatent/domain/clickwrap";
import { requireOrg } from "@/lib/server/session";
import { acceptCurrentTerms } from "@/lib/server/services/terms";

/**
 * Server-side clickwrap acceptance (PRD §7.2). The client checkbox state
 * only gates the button; this action independently re-validates that every
 * required acknowledgement was affirmatively selected.
 */
export async function acceptTermsAction(formData: FormData): Promise<void> {
  const context = await requireOrg();

  const acknowledgedKeys = ACKNOWLEDGEMENT_KEYS.filter(
    (key) => formData.get(`ack_${key}`) === "on",
  );
  const result = await acceptCurrentTerms({
    userId: context.user.id,
    organizationId: context.organization.id,
    termsVersion: String(formData.get("termsVersion") ?? ""),
    acknowledgedKeys,
  });

  if (!result.ok) {
    redirect(`/wepatent/app/terms?error=${encodeURIComponent(result.error)}`);
  }
  redirect("/wepatent/app");
}
