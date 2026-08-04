import "server-only";

import { createHash } from "node:crypto";
import { isUnresolved } from "@/lib/wepatent/domain/facts";
import {
  describeDeliveryBlockers,
  type DeliveryBlocker,
} from "@/lib/shared/drafting";
import { getAdapters } from "../adapters";
import type { ExportManifest, ExportRecordEntry, Id } from "../adapters/types";

export const EXPORT_NOTICE =
  "Working materials prepared with wepatent. Not legal advice. Every included draft is an automated working draft that requires review and approval by qualified patent counsel before filing, disclosure, legal reliance, or other consequential use.";

export type CreateExportResult =
  | { ok: true; record: ExportRecordEntry }
  | { ok: false; error: "invention_not_found" | "draft_version_not_found" }
  /**
   * THE CLIENT DELIVERY GATE (Jeff's directive, 2026-08-04). The set has not
   * reached READY_FOR_REVIEW with a human acceptance, so no counsel/client
   * package is emitted. `blockers` names exactly what is wrong and what the
   * product needs — never a bare "not ready".
   */
  | {
      ok: false;
      error: "delivery_blocked";
      blockers: DeliveryBlocker[];
      detail: string;
    };

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
  /**
   * Escape hatch for the pre-three-pass export paths (a single-shot draft
   * with no draft set). It does NOT bypass the gate for a record that has
   * one: when a draft set exists, the gate always applies.
   */
  allowWithoutDraftSet?: boolean;
}): Promise<CreateExportResult> {
  const { data } = getAdapters();
  const invention = await data.getInvention(params.organizationId, params.inventionId);
  if (!invention) return { ok: false, error: "invention_not_found" };

  /* ---- THE DELIVERY GATE -------------------------------------------- */
  //
  // "Nothing is exported/delivered as a counsel/client package until the set
  // reaches READY_FOR_REVIEW *and* a human accepts."
  //
  // The gate is evaluated from the LATEST draft set for this record. If one
  // exists, it must be open — there is no path that emits a Pass-1-only
  // package. If none exists, this is a pre-three-pass record and the legacy
  // single-shot export still works.
  const draftSets = await data.listDraftSets(params.organizationId, params.inventionId);
  const latestSet = draftSets[draftSets.length - 1] ?? null;
  let deliveredDraftSetId: Id | null = null;
  if (latestSet) {
    const { evaluateDeliveryFor } = await import("./draft-passes");
    const decision = await evaluateDeliveryFor(params.organizationId, latestSet.id);
    if (!decision.allowed) {
      return {
        ok: false,
        error: "delivery_blocked",
        blockers: decision.blockers,
        detail: describeDeliveryBlockers(decision.blockers),
      };
    }
    deliveredDraftSetId = latestSet.id;
  }

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
  // Intake Studio M1: P/S ledger + deterministic coverage summary travel in
  // the manifest so the package is self-describing (FR-INT-8 export caveat
  // is rendered by export-render.ts).
  const { getLedger } = await import("./ps-ledger");
  const ledger = await getLedger(params.organizationId, params.inventionId);

  // Patent figures ride along in the counsel package with the same
  // manifest/checksum semantics as everything else (spec §4). The manifest
  // carries the validation status and rules version so the package is
  // self-describing about WHAT was checked and what was not.
  const { getLatestFigureSetView } = await import("./figures");
  const figureView = await getLatestFigureSetView(params.organizationId, params.inventionId);
  const figureFailures = figureView.validations.filter((entry) => entry.status === "fail").length;
  const figureReviews = figureView.validations.filter(
    (entry) => entry.status === "needs_human_review",
  ).length;

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
    psProblemCount: ledger.pairs.filter((pair) => pair.kind === "problem").length,
    psSolutionCount: ledger.pairs.filter((pair) => pair.kind === "solution").length,
    psConfirmedCount: ledger.pairs.filter((pair) => pair.state !== "ai_proposed").length,
    coverageSatisfied: ledger.coverage.aggregate.satisfied,
    coverageTotal: ledger.coverage.aggregate.total,
    coverageVersion: ledger.coverage.version,
    // M3: per-solution evidence travels in the package (FR-INT-9 export
    // integration); the manifest carries the association/anchor counts.
    psAssociationCount: ledger.associations.length,
    psRegionAnchorCount: ledger.associations.filter(
      (association) => association.region !== null,
    ).length,
    figureCount: figureView.figures.length,
    figureSheetCount: figureView.sheets.length,
    figureValidationStatus: figureView.set
      ? figureFailures > 0
        ? `${figureFailures} mechanical formality checks not met; ${figureReviews} need a person to confirm`
        : `mechanical formality checks met; ${figureReviews} need a person to confirm`
      : "no figures in this package",
    figureRulesVersion: figureView.set?.rulesVersion ?? "",
    figureBriefDescription: figureView.figures
      .filter((figure) => figure.briefDescription.length > 0)
      .map((figure) => figure.briefDescription),
  };

  const checksum = createHash("sha256").update(JSON.stringify(manifest)).digest("hex");

  const record = await data.createExport({
    organizationId: params.organizationId,
    inventionId: params.inventionId,
    draftVersionId: params.draftVersionId,
    figureSetId: figureView.set?.id ?? null,
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
    meta: {
      checksum,
      // Which accepted draft set this package delivered, so the audit trail
      // ties a package to the human who accepted it.
      draftSetId: deliveredDraftSetId ?? "",
    },
  });

  return { ok: true, record };
}
