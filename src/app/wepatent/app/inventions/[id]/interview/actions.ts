"use server";

import { redirect } from "next/navigation";
import { editPair } from "@/lib/server/services/ps-ledger";
import { requireOnboarded } from "@/lib/server/session";

/**
 * Apply an AI-proposed edit (FR-INT-7) as the USER's edit. This is a human
 * action through the normal user-lane guard — the model only proposed the
 * wording; state becomes `user_edited` because the user chose to apply it.
 */
export async function applyProposedEditAction(formData: FormData): Promise<void> {
  const context = await requireOnboarded();
  const inventionId = String(formData.get("inventionId") ?? "");
  const result = await editPair({
    organizationId: context.organization.id,
    userId: context.user.id,
    pairId: String(formData.get("pairId") ?? ""),
    statement: String(formData.get("statement") ?? ""),
  });
  redirect(
    `/wepatent/app/inventions/${inventionId}/interview${result.ok ? "" : `?error=${result.error}`}`,
  );
}
