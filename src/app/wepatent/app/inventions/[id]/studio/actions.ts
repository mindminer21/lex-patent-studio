"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { can } from "@/lib/wepatent/domain/roles";
import { getAdapters } from "@/lib/server/adapters";
import { enqueueJob } from "@/lib/server/jobs/runner";
import { requireOnboarded } from "@/lib/server/session";
import {
  addManualPair,
  bulkReviewProposals,
  confirmPair,
  deletePair,
  editPair,
  linkPairs,
  mergePairs,
  setWorkingTitle,
  splitPair,
} from "@/lib/server/services/ps-ledger";

function studioPath(inventionId: string, suffix = ""): string {
  return `/wepatent/app/inventions/${inventionId}/studio${suffix}`;
}

/**
 * Enqueue interpretation jobs for every eligible (post-quarantine,
 * not-yet-interpreted) source (FR-INT-3). Per-source idempotency keys make
 * retries attach to the same job; the reservation layer prevents any
 * double charge.
 */
export async function interpretSourcesAction(formData: FormData): Promise<void> {
  const context = await requireOnboarded();
  if (!can(context.membership.role, "draft.generate")) {
    redirect("/wepatent/app?error=forbidden");
  }
  const inventionId = String(formData.get("inventionId") ?? "");
  const { data } = getAdapters();
  const invention = await data.getInvention(context.organization.id, inventionId);
  if (!invention) redirect("/wepatent/app");
  const sources = await data.listSources(context.organization.id, inventionId);
  const eligible = sources.filter(
    (source) =>
      (source.status === "scanned" || source.status === "extracted") &&
      source.interpretationStatus !== "interpreted",
  );
  let lastJobId = "";
  for (const source of eligible) {
    const result = await enqueueJob({
      organizationId: context.organization.id,
      kind: "source_interpretation",
      idempotencyKey: `interpret:${source.id}`,
      payload: { sourceId: source.id, userId: context.user.id, inventionId },
    });
    if (result.ok) lastJobId = result.job.id;
  }
  redirect(studioPath(inventionId, lastJobId ? `?job=${lastJobId}` : "?error=nothing_to_interpret"));
}

/** Enqueue the record-level distillation job (FR-INT-4). */
export async function distillAction(formData: FormData): Promise<void> {
  const context = await requireOnboarded();
  if (!can(context.membership.role, "draft.generate")) {
    redirect("/wepatent/app?error=forbidden");
  }
  const inventionId = String(formData.get("inventionId") ?? "");
  const idempotencyKey = String(formData.get("idempotencyKey") ?? "") || randomUUID();
  const { data } = getAdapters();
  const invention = await data.getInvention(context.organization.id, inventionId);
  if (!invention) redirect("/wepatent/app");
  const result = await enqueueJob({
    organizationId: context.organization.id,
    kind: "distillation",
    idempotencyKey,
    payload: { inventionId, userId: context.user.id },
  });
  redirect(
    studioPath(inventionId, result.ok ? `?job=${result.job.id}` : "?error=invalid_input"),
  );
}

export async function addPairAction(formData: FormData): Promise<void> {
  const context = await requireOnboarded();
  const inventionId = String(formData.get("inventionId") ?? "");
  const kind = String(formData.get("kind") ?? "");
  if (kind !== "problem" && kind !== "solution") {
    redirect(studioPath(inventionId, "?error=invalid_input"));
  }
  const result = await addManualPair({
    organizationId: context.organization.id,
    userId: context.user.id,
    inventionId,
    kind: kind as "problem" | "solution",
    statement: String(formData.get("statement") ?? ""),
  });
  redirect(studioPath(inventionId, result.ok ? "" : `?error=${result.error}`));
}

export async function confirmPairAction(formData: FormData): Promise<void> {
  const context = await requireOnboarded();
  const inventionId = String(formData.get("inventionId") ?? "");
  const result = await confirmPair({
    organizationId: context.organization.id,
    userId: context.user.id,
    pairId: String(formData.get("pairId") ?? ""),
  });
  redirect(studioPath(inventionId, result.ok ? "" : `?error=${result.error}`));
}

export async function editPairAction(formData: FormData): Promise<void> {
  const context = await requireOnboarded();
  const inventionId = String(formData.get("inventionId") ?? "");
  const result = await editPair({
    organizationId: context.organization.id,
    userId: context.user.id,
    pairId: String(formData.get("pairId") ?? ""),
    statement: String(formData.get("statement") ?? ""),
  });
  redirect(studioPath(inventionId, result.ok ? "" : `?error=${result.error}`));
}

export async function deletePairAction(formData: FormData): Promise<void> {
  const context = await requireOnboarded();
  const inventionId = String(formData.get("inventionId") ?? "");
  const result = await deletePair({
    organizationId: context.organization.id,
    userId: context.user.id,
    pairId: String(formData.get("pairId") ?? ""),
  });
  redirect(studioPath(inventionId, result.ok ? "" : `?error=${result.error}`));
}

export async function linkPairsAction(formData: FormData): Promise<void> {
  const context = await requireOnboarded();
  const inventionId = String(formData.get("inventionId") ?? "");
  const result = await linkPairs({
    organizationId: context.organization.id,
    userId: context.user.id,
    problemId: String(formData.get("problemId") ?? ""),
    solutionId: String(formData.get("solutionId") ?? ""),
  });
  redirect(studioPath(inventionId, result.ok ? "" : `?error=${result.error}`));
}

export async function setTitleAction(formData: FormData): Promise<void> {
  const context = await requireOnboarded();
  const inventionId = String(formData.get("inventionId") ?? "");
  const result = await setWorkingTitle({
    organizationId: context.organization.id,
    userId: context.user.id,
    inventionId,
    text: String(formData.get("text") ?? ""),
  });
  redirect(studioPath(inventionId, result.ok ? "" : `?error=${result.error}`));
}

/**
 * M3 re-distillation diff review: bulk accept/reject of the CURRENT AI
 * proposals. Each item still passes the per-item guard + event trail;
 * confirmed/edited items are structurally untouchable.
 */
export async function bulkReviewAction(formData: FormData): Promise<void> {
  const context = await requireOnboarded();
  const inventionId = String(formData.get("inventionId") ?? "");
  const action = String(formData.get("action") ?? "");
  if (action !== "confirm" && action !== "reject") {
    redirect(studioPath(inventionId, "?error=invalid_input"));
  }
  const result = await bulkReviewProposals({
    organizationId: context.organization.id,
    userId: context.user.id,
    inventionId,
    action: action as "confirm" | "reject",
  });
  redirect(studioPath(inventionId, result.ok ? "" : `?error=${result.error}`));
}

/** M3 ledger polish (feature PRD §5.4): merge two same-kind pairs. */
export async function mergePairsAction(formData: FormData): Promise<void> {
  const context = await requireOnboarded();
  const inventionId = String(formData.get("inventionId") ?? "");
  const result = await mergePairs({
    organizationId: context.organization.id,
    userId: context.user.id,
    primaryId: String(formData.get("primaryId") ?? ""),
    secondaryId: String(formData.get("secondaryId") ?? ""),
  });
  redirect(studioPath(inventionId, result.ok ? "" : `?error=${result.error}`));
}

/** M3 ledger polish (feature PRD §5.4): split a pair into statements. */
export async function splitPairAction(formData: FormData): Promise<void> {
  const context = await requireOnboarded();
  const inventionId = String(formData.get("inventionId") ?? "");
  const statements = String(formData.get("statements") ?? "")
    .split(/\r?\n/)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
  const result = await splitPair({
    organizationId: context.organization.id,
    userId: context.user.id,
    pairId: String(formData.get("pairId") ?? ""),
    statements,
  });
  redirect(studioPath(inventionId, result.ok ? "" : `?error=${result.error}`));
}
