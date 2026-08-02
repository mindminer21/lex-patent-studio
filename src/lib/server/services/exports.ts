import "server-only";

import { createHash } from "node:crypto";
import { isUnresolved } from "@/lib/domain/facts";
import { getAdapters } from "../adapters";
import type { ExportManifest, ExportRecordEntry, Id } from "../adapters/types";

export const EXPORT_NOTICE =
  "Working materials prepared with wepatent. Not legal advice. Every included draft is an automated working draft that requires review and approval by qualified patent counsel before filing, disclosure, legal reliance, or other consequential use.";

export type CreateExportResult =
  | { ok: true; record: ExportRecordEntry }
  | { ok: false; error: "invention_not_found" | "draft_version_not_found" };

/**
 * Counsel-ready export (PRD §7.5): a version-locked manifest referencing
 * immutable draft-version ids with a checksum. Later record changes never
 * silently alter an existing export. DOCX/PDF/manifest artifacts render
 * through the export_render durable job with per-artifact SHA-256s.
 */
export async function createExport(params: {
  organizationId: Id;
  userId: Id;
  inventionId: Id;
  draftVersionId: Id | null;
  sections: string[];
}): Promise<CreateExportResult> {
  const { data } = getAdapters();
  const invention = await data.getInvention(params.organizationId, params.inventionId);
  if (!invention) return { ok: false, error: "invention_not_found" };

  let draftLabel = "no draft included";
  if (params.draftVersionId) {
    const version = await data.getDraftVersion(params.organizationId, params.draftVersionId);
    if (!version) return { ok: false, error: "draft_version_not_found" };
    draftLabel = `working draft v${version.version} (${version.modelId}) — counsel review required`;
  }

  const facts = await data.listFacts(params.organizationId, params.inventionId);
  const contributors = await data.listContributors(params.organizationId, params.inventionId);
  const events = await data.listDisclosureEvents(params.organizationId, params.inventionId);
  const sources = await data.listSources(params.organizationId, params.inventionId);

  const manifest: ExportManifest = {
    inventionId: invention.id,
    inventionTitle: invention.title,
    sections: params.sections,
    draftVersionId: params.draftVersionId,
    draftLabel,
    factCount: facts.length,
    unresolvedFactCount: facts.filter((fact) => isUnresolved(fact.provenance)).length,
    contributorCount: contributors.length,
    disclosureEventCount: events.length,
    sourceCount: sources.length,
    generatedAt: new Date().toISOString(),
    notice: EXPORT_NOTICE,
  };

  const checksum = createHash("sha256").update(JSON.stringify(manifest)).digest("hex");

  const record = await data.createExport({
    organizationId: params.organizationId,
    inventionId: params.inventionId,
    draftVersionId: params.draftVersionId,
    manifest,
    checksum,
  });

  // Artifact rendering happens off the request path (PRD §14); the export
  // page reports job progress via findJobByKey(export_render, record.id).
  const { enqueueJob } = await import("../jobs/runner");
  await enqueueJob({
    organizationId: params.organizationId,
    kind: "export_render",
    idempotencyKey: record.id,
    payload: { exportId: record.id },
  });

  await data.appendAuditEvent({
    organizationId: params.organizationId,
    actor: params.userId,
    action: "export.created",
    target: record.id,
    meta: { checksum },
  });

  return { ok: true, record };
}
