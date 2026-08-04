"use server";

import { revalidatePath } from "next/cache";
import { getAdapters } from "@/lib/adapters";
import { canInvokeWorkflow, can } from "@/lib/domain/roles";
import { effectiveTier } from "@/lib/domain/tiers";

/**
 * Lex's three-pass drafting actions.
 *
 * Authorization derives from the server-resolved session, never from
 * client-supplied role or tenant values (Invariant 6). Drafting is Tier B, so
 * only a seat that may invoke Tier-B workflows can start it, and only a seat
 * that may approve review items can accept the finished set — the platform
 * can never accept on a practitioner's behalf.
 */

export async function startDraftSetAction(formData: FormData): Promise<void> {
  const adapters = getAdapters();
  const session = await adapters.auth.getSession();
  if (!session) return;
  const matterId = String(formData.get("matterId") ?? "");
  if (!matterId) return;

  // Tier B — draft for review (PRD-lex §5.3, Invariant 15).
  if (!canInvokeWorkflow(session.role, effectiveTier("section_draft"))) return;

  await adapters.data.startDraftSet(session.organizationId, matterId, {
    userId: session.userId,
    role: session.role,
  });
  revalidatePath(`/app/matters/${matterId}/documents`);
  revalidatePath(`/app/matters/${matterId}/reviews`);
}

export async function acceptDraftSetAction(formData: FormData): Promise<void> {
  const adapters = getAdapters();
  const session = await adapters.auth.getSession();
  if (!session) return;
  const matterId = String(formData.get("matterId") ?? "");
  const draftSetId = String(formData.get("draftSetId") ?? "");
  if (!matterId || !draftSetId) return;

  // Accepting a Tier-B draft is a review decision in substance, so it takes
  // the same permission.
  if (!can(session.role, "review.decide.tierB")) return;

  await adapters.data.acceptDraftSet(session.organizationId, draftSetId, {
    userId: session.userId,
    role: session.role,
  });
  revalidatePath(`/app/matters/${matterId}/documents`);
}
