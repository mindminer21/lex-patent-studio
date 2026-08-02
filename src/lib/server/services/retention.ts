import "server-only";

import { z } from "zod";
import { can, type Role } from "@/lib/domain/roles";
import { getAdapters } from "../adapters";
import type { Id, InventionRecord } from "../adapters/types";
import { incrementCounter, logEvent } from "../observability";

/**
 * FR-3 retention workflows: owner-adjustable retention window plus a
 * retention-aware purge of soft-deleted invention records. Purge removes
 * content permanently (facts, sources, drafts, exports); audit events are
 * retained as deletion evidence (§11 "data deletion and retention workflows
 * with audit evidence").
 */

/** Matches the DB check constraint (0002): 30–3650 days. */
export const retentionDaysSchema = z.coerce.number().int().min(30).max(3650);

export type UpdateRetentionResult =
  | { ok: true; retentionDays: number }
  | { ok: false; error: "forbidden" | "invalid_input" | "not_found" };

export async function updateRetentionPolicy(params: {
  organizationId: Id;
  actorUserId: Id;
  actorRole: Role;
  retentionDays: unknown;
}): Promise<UpdateRetentionResult> {
  if (!can(params.actorRole, "org.manage")) return { ok: false, error: "forbidden" };
  const parsed = retentionDaysSchema.safeParse(params.retentionDays);
  if (!parsed.success) return { ok: false, error: "invalid_input" };

  const { data } = getAdapters();
  const updated = await data.updateOrganizationRetention(params.organizationId, parsed.data);
  if (!updated) return { ok: false, error: "not_found" };

  await data.appendAuditEvent({
    organizationId: params.organizationId,
    actor: `user:${params.actorUserId}`,
    action: "retention.policy_updated",
    target: params.organizationId,
    meta: { retentionDays: parsed.data },
  });
  return { ok: true, retentionDays: parsed.data };
}

/** A soft-deleted record becomes purge-eligible after the retention window. */
export function isPurgeEligible(
  invention: Pick<InventionRecord, "status" | "updatedAt">,
  retentionDays: number,
  now: Date = new Date(),
): boolean {
  if (invention.status !== "soft_deleted") return false;
  const deletedAtMs = new Date(invention.updatedAt).getTime();
  return now.getTime() - deletedAtMs >= retentionDays * 24 * 60 * 60 * 1000;
}

export type PurgeResult =
  | { ok: true; purged: number; pending: number }
  | { ok: false; error: "forbidden" };

/**
 * Purges every purge-eligible soft-deleted invention for the organization.
 * Safe to run repeatedly; each purge is audited with counts only (no
 * content). Returns how many records were purged and how many soft-deleted
 * records remain inside their retention window.
 */
export async function runRetentionPurge(params: {
  organizationId: Id;
  actorUserId: Id;
  actorRole: Role;
  now?: Date;
}): Promise<PurgeResult> {
  if (!can(params.actorRole, "org.manage")) return { ok: false, error: "forbidden" };
  const { data } = getAdapters();
  const organization = await data.getOrganizationById(params.organizationId);
  if (!organization) return { ok: true, purged: 0, pending: 0 };

  const softDeleted = await data.listSoftDeletedInventions(params.organizationId);
  const now = params.now ?? new Date();
  let purged = 0;
  for (const invention of softDeleted) {
    if (!isPurgeEligible(invention, organization.retentionDays, now)) continue;
    const facts = await data.listFacts(params.organizationId, invention.id);
    const sources = await data.listSources(params.organizationId, invention.id);
    await data.hardDeleteInvention(params.organizationId, invention.id);
    purged += 1;
    incrementCounter("retention.purged");
    await data.appendAuditEvent({
      organizationId: params.organizationId,
      actor: `user:${params.actorUserId}`,
      action: "retention.invention_purged",
      target: invention.id,
      // Deletion evidence: counts only, never content (§11, FR-7).
      meta: {
        factCount: facts.length,
        sourceCount: sources.length,
        retentionDays: organization.retentionDays,
        softDeletedAt: invention.updatedAt,
      },
    });
    logEvent({
      level: "info",
      event: "retention.invention_purged",
      correlationId: invention.id,
      meta: { organizationId: params.organizationId },
    });
  }
  return { ok: true, purged, pending: softDeleted.length - purged };
}
