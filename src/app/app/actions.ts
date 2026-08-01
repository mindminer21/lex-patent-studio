"use server";

import { revalidatePath } from "next/cache";
import { getAdapters } from "@/lib/adapters";
import { reviewDecisionSchema, runRequestSchema } from "@/lib/domain/schemas";
import { z } from "zod";

/**
 * Server actions for the authenticated workspace.
 *
 * Authorization derives from the server-resolved session (adapter contract),
 * never from client-supplied role or tenant values (PRD-wepatent Invariant 6).
 * Model output has no path into these actions; every mutation records an
 * audit event in the local store.
 */

export interface ActionState {
  ok: boolean;
  message: string;
}

export async function createRunAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const adapters = getAdapters();
  const session = await adapters.auth.getSession();
  if (!session) return { ok: false, message: "Not authenticated." };

  const parsed = runRequestSchema.safeParse({
    matterId: formData.get("matterId"),
    workflowKey: formData.get("workflowKey"),
    jurisdiction: formData.get("jurisdiction"),
    asOfDate: formData.get("asOfDate"),
    modelId: formData.get("modelId"),
    deliverableType: formData.get("deliverableType"),
    qualityControls: {
      sourceRequired: formData.get("qcSourceRequired") === "on",
      secondModelReview: formData.get("qcSecondModel") === "on",
      quoteVerification: formData.get("qcQuoteVerification") === "on",
    },
    factIds: [],
    sourceIds: [],
  });
  if (!parsed.success) {
    return { ok: false, message: "Please complete every composer field." };
  }

  const result = await adapters.data.createRun(
    session.organizationId,
    parsed.data,
    { requestedBy: session.userId, role: session.role },
  );
  if (!result.ok) return { ok: false, message: result.error };

  revalidatePath(`/app/matters/${parsed.data.matterId}`);
  revalidatePath("/app");
  return {
    ok: true,
    message: `Run queued (Tier ${result.run.tier}, est. $${result.run.estimatedChargeLowUsd.toFixed(2)}–$${result.run.estimatedChargeHighUsd.toFixed(2)}). Local mode: no provider call is made.`,
  };
}

const decideSchema = z.object({
  reviewItemId: z.string().min(1),
  decision: reviewDecisionSchema,
  note: z.string().max(4000).optional(),
});

export async function decideReviewAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const adapters = getAdapters();
  const session = await adapters.auth.getSession();
  if (!session) return { ok: false, message: "Not authenticated." };

  const parsed = decideSchema.safeParse({
    reviewItemId: formData.get("reviewItemId"),
    decision: formData.get("decision"),
    note: (formData.get("note") as string | null) || undefined,
  });
  if (!parsed.success) return { ok: false, message: "Invalid decision." };

  const result = await adapters.data.decideReviewItem(
    session.organizationId,
    parsed.data.reviewItemId,
    parsed.data.decision,
    { userId: session.userId, role: session.role, note: parsed.data.note },
  );
  if (!result.ok) return { ok: false, message: result.error };

  revalidatePath("/app/review-queue");
  revalidatePath("/app");
  revalidatePath(`/app/matters/${result.item.matterId}`);
  return {
    ok: true,
    message: `Recorded: ${parsed.data.decision.replace("_", " ")} on "${result.item.documentTitle}" (doc hash ${result.record.documentVersionHash}).`,
  };
}
