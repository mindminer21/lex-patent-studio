"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { can } from "@/lib/wepatent/domain/roles";
import { enqueueJob } from "@/lib/server/jobs/runner";
import { acceptFigureSet, renameFigurePart } from "@/lib/server/services/figures";
import { requireOnboarded } from "@/lib/server/session";

function figuresPath(inventionId: string, suffix = ""): string {
  return `/wepatent/app/inventions/${inventionId}/figures${suffix}`;
}

/**
 * Manual "Generate figures" affordance. Per the app-wide design rule this
 * exists but is never REQUIRED — with automatic generation enabled the set
 * is already there when the user arrives.
 */
export async function generateFiguresAction(formData: FormData): Promise<void> {
  const context = await requireOnboarded();
  if (!can(context.membership.role, "draft.generate")) {
    redirect("/wepatent/app?error=forbidden");
  }
  const inventionId = String(formData.get("inventionId") ?? "");
  const result = await enqueueJob({
    organizationId: context.organization.id,
    kind: "figure_plan",
    idempotencyKey: `figures:manual:${randomUUID()}`,
    payload: { inventionId, draftVersionId: null, userId: context.user.id },
  });
  redirect(figuresPath(inventionId, result.ok ? `?job=${result.job.id}` : "?error=enqueue_failed"));
}

/** Accepting the set is ONE action (design rule: minimal-step acceptance). */
export async function acceptFiguresAction(formData: FormData): Promise<void> {
  const context = await requireOnboarded();
  if (!can(context.membership.role, "draft.generate")) {
    redirect("/wepatent/app?error=forbidden");
  }
  const inventionId = String(formData.get("inventionId") ?? "");
  const figureSetId = String(formData.get("figureSetId") ?? "");
  const dismissalReason = String(formData.get("dismissalReason") ?? "").trim();
  await acceptFigureSet({
    organizationId: context.organization.id,
    userId: context.user.id,
    figureSetId,
    dismissalReason: dismissalReason || undefined,
  });
  redirect(figuresPath(inventionId, "?accepted=1"));
}

/**
 * Rename a part. One registry row changes and every view updates, because
 * views store the numeral and never the label.
 */
export async function renamePartAction(formData: FormData): Promise<void> {
  const context = await requireOnboarded();
  if (!can(context.membership.role, "draft.generate")) {
    redirect("/wepatent/app?error=forbidden");
  }
  const inventionId = String(formData.get("inventionId") ?? "");
  const numeralId = String(formData.get("numeralId") ?? "");
  const partLabel = String(formData.get("partLabel") ?? "").trim();
  if (partLabel.length === 0) redirect(figuresPath(inventionId, "?error=empty_label"));
  await renameFigurePart({
    organizationId: context.organization.id,
    userId: context.user.id,
    numeralId,
    partLabel,
  });
  redirect(figuresPath(inventionId, "?renamed=1"));
}
