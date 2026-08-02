import "server-only";

import { randomUUID } from "node:crypto";
import { interpretationClassFor } from "@/lib/wepatent/domain/uploads";
import { release, reserve, settle } from "@/lib/wepatent/domain/usage";
import { getAdapters } from "../adapters";
import { getModelTier } from "../model-registry";
import { estimateForTier } from "./generation";
import type { Id, InterpretationOutput, SourceRecord } from "../adapters/types";

/**
 * Per-source interpretation (Intake Studio §5.2, FR-INT-3).
 *
 * - Only files that CLEARED quarantine are eligible (FR-4: scanned/extracted).
 * - Classes without an automated interpreter (3D in M1, unknown formats) get
 *   the honest `stored_uninterpreted` status with a status-note artifact —
 *   never a silent skip, never a fake interpretation, never model spend.
 * - Model-backed classes run estimate → reservation → gateway → settlement
 *   (FR-6 semantics, same reservation layer as drafting). A retry with the
 *   same idempotency key can never double-charge.
 * - File contents are untrusted EVIDENCE (invariant 16): they are passed to
 *   the gateway inside delimited untrusted blocks and nothing in them can
 *   alter engine behavior or ledger state.
 */

const TEXT_MIME_PREFIXES = ["text/", "image/svg"];
const INTERPRETATION_TIER = "standard"; // Fast tier (feature PRD §10)
const MAX_TEXT_CHARS = 100_000;

export type InterpretationRunResult =
  | {
      ok: true;
      sourceId: Id;
      status: "interpreted" | "stored_uninterpreted";
      artifactCount: number;
    }
  | {
      ok: false;
      error:
        | "source_not_found"
        | "source_not_ready"
        | "insufficient_funds"
        | "interpretation_failed";
    };

/**
 * Deterministic best-effort text layer for document-class sources. Text
 * formats decode as UTF-8; binary containers (PDF/DOCX/PPTX/XLSX) yield
 * their printable text runs — honest, deterministic, no fabrication.
 * Production-grade OCR is a later worker concern (parent FR-4).
 */
export function extractTextLayer(source: SourceRecord, bytes: Uint8Array): string {
  const mime = (source.mimeType ?? "").toLowerCase();
  if (TEXT_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix))) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes).slice(0, MAX_TEXT_CHARS);
    } catch {
      /* fall through to printable-run extraction */
    }
  }
  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const runs = decoded.match(/[\x20-\x7E\n\r\t]{6,}/g) ?? [];
  return runs.join("\n").slice(0, MAX_TEXT_CHARS);
}

/** Compose the stored artifact content from structured gateway output. */
export function composeArtifactContent(sourceName: string, output: InterpretationOutput): string {
  const lines: string[] = [];
  lines.push(`Interpretation of "${sourceName}" — ai_proposed working material; counsel review required.`);
  lines.push(output.summary);
  for (const problem of output.problemCandidates) {
    lines.push(`Problem candidate: ${problem}`);
  }
  for (const solution of output.solutionCandidates) {
    lines.push(`Solution candidate: ${solution}`);
  }
  for (const component of output.componentCandidates) {
    lines.push(`Component: ${component.name} — ${component.description}`);
  }
  return lines.join("\n");
}

export async function runInterpretation(params: {
  organizationId: Id;
  userId: Id;
  sourceId: Id;
  idempotencyKey: string;
}): Promise<InterpretationRunResult> {
  const { data, storage, modelGateway } = getAdapters();
  const source = await data.getSource(params.organizationId, params.sourceId);
  if (!source) return { ok: false, error: "source_not_found" };

  // Idempotent re-run: already interpreted → return the prior outcome.
  if (source.interpretationStatus === "interpreted") {
    const artifacts = await data.listExtractionArtifactsForSource(
      params.organizationId,
      params.sourceId,
    );
    return { ok: true, sourceId: source.id, status: "interpreted", artifactCount: artifacts.length };
  }

  // FR-4: interpretation only touches files that cleared quarantine.
  if (source.status !== "scanned" && source.status !== "extracted") {
    return { ok: false, error: "source_not_ready" };
  }

  const invention = await data.getInvention(params.organizationId, source.inventionId);
  if (!invention) return { ok: false, error: "source_not_found" };

  const interpretationClass = interpretationClassFor(
    source.mimeType,
    source.originalFilename ?? source.name,
  );

  // Honest stored_uninterpreted for classes without an M1 interpreter.
  if (interpretationClass === "model3d" || interpretationClass === "stored_only") {
    const existing = await data.listExtractionArtifactsForSource(
      params.organizationId,
      params.sourceId,
    );
    if (source.interpretationStatus !== "stored_uninterpreted") {
      await data.updateSource(params.organizationId, params.sourceId, {
        interpretationStatus: "stored_uninterpreted",
      });
    }
    if (!existing.some((artifact) => artifact.type === "status_note")) {
      await data.createExtractionArtifact({
        organizationId: params.organizationId,
        inventionId: source.inventionId,
        sourceId: source.id,
        type: "status_note",
        content:
          interpretationClass === "model3d"
            ? "Stored, not auto-interpreted: 3D model rendering and vision interpretation ship in M2. The raw file is retained for the counsel package. Please describe what the model shows in your record so counsel has the context."
            : "Stored, not auto-interpreted: no automated interpreter exists for this file type. The file is retained for the counsel package. Please describe its contents in your record.",
        modelId: null,
        costReservationId: null,
      });
      await data.appendAuditEvent({
        organizationId: params.organizationId,
        actor: "system",
        action: "source.stored_uninterpreted",
        target: source.id,
        meta: { interpretationClass },
      });
    }
    return { ok: true, sourceId: source.id, status: "stored_uninterpreted", artifactCount: 1 };
  }

  // ---- Metered model pass (estimate → reserve → run → settle, FR-6) ----
  const tier = getModelTier(INTERPRETATION_TIER);
  if (!tier) return { ok: false, error: "interpretation_failed" };

  const bytes = source.storagePath ? await storage.get(source.storagePath) : null;
  if (!bytes) {
    // Bytes missing (metadata-only registration): store honestly.
    await data.updateSource(params.organizationId, params.sourceId, {
      interpretationStatus: "stored_uninterpreted",
    });
    await data.createExtractionArtifact({
      organizationId: params.organizationId,
      inventionId: source.inventionId,
      sourceId: source.id,
      type: "status_note",
      content:
        "Stored, not auto-interpreted: no file bytes are available for this source (metadata-only registration).",
      modelId: null,
      costReservationId: null,
    });
    return { ok: true, sourceId: source.id, status: "stored_uninterpreted", artifactCount: 1 };
  }

  const text = interpretationClass === "document" ? extractTextLayer(source, bytes) : undefined;
  const approximateInputTokens =
    interpretationClass === "image"
      ? 1_800
      : Math.max(200, Math.ceil(((text?.length ?? 0) + 400) / 4));
  const estimate = estimateForTier(tier, approximateInputTokens);

  const wallet = (await data.getWallet(params.organizationId)) ?? {
    organizationId: params.organizationId,
    balanceCents: 0,
    reservedCents: 0,
  };
  const existingReservations = await data.listReservations(params.organizationId);
  const reserveResult = reserve(
    { balanceCents: wallet.balanceCents, reservedCents: wallet.reservedCents },
    existingReservations,
    {
      id: randomUUID(),
      idempotencyKey: params.idempotencyKey,
      amountCents: estimate.customerHighCents,
      rateVersion: tier.rate.rateVersion,
    },
  );
  if (!reserveResult.ok) return { ok: false, error: "insufficient_funds" };

  if (reserveResult.deduplicated) {
    // Retry of a run that already produced artifacts: never re-charge.
    const artifacts = await data.listExtractionArtifactsForSource(
      params.organizationId,
      params.sourceId,
    );
    const prior = artifacts.find(
      (artifact) => artifact.costReservationId === reserveResult.reservation.id,
    );
    if (prior) {
      return {
        ok: true,
        sourceId: source.id,
        status: "interpreted",
        artifactCount: artifacts.length,
      };
    }
  }

  await data.saveWallet({ organizationId: params.organizationId, ...reserveResult.wallet });
  const reservationRecord = {
    ...reserveResult.reservation,
    organizationId: params.organizationId,
    createdAt: new Date().toISOString(),
  };
  await data.saveReservation(reservationRecord);

  let result;
  try {
    result = await modelGateway.interpret({
      modelId: tier.modelId,
      sourceName: source.name,
      interpretationClass,
      text,
      imageBytes: interpretationClass === "image" ? bytes : undefined,
      imageMimeType: interpretationClass === "image" ? (source.mimeType ?? undefined) : undefined,
      inventionTitle: invention.title,
      maxOutputTokens: tier.maxOutputTokens,
    });
  } catch {
    // Failed run: release the hold (never charge) and store HONESTLY as
    // stored_uninterpreted (acceptance criterion 2) — re-runnable later.
    const released = release(reserveResult.wallet, reserveResult.reservation);
    if (released.ok) {
      await data.saveWallet({ organizationId: params.organizationId, ...released.wallet });
      await data.saveReservation({ ...reservationRecord, status: released.reservation.status });
      await data.appendLedgerEntry({
        organizationId: params.organizationId,
        kind: "release",
        amountCents: 0,
        reservationId: reservationRecord.id,
        note: "Interpretation failed; reservation released without charge.",
      });
    }
    await data.updateSource(params.organizationId, params.sourceId, {
      interpretationStatus: "stored_uninterpreted",
    });
    await data.createExtractionArtifact({
      organizationId: params.organizationId,
      inventionId: source.inventionId,
      sourceId: source.id,
      type: "status_note",
      content:
        "Stored, not auto-interpreted: the interpretation run did not complete. Nothing was charged. The file remains stored and you can re-run interpretation.",
      modelId: null,
      costReservationId: null,
    });
    await data.appendAuditEvent({
      organizationId: params.organizationId,
      actor: "system",
      action: "source.interpretation_failed",
      target: source.id,
      meta: {},
    });
    return { ok: true, sourceId: source.id, status: "stored_uninterpreted", artifactCount: 1 };
  }

  const settled = settle(
    reserveResult.wallet,
    reserveResult.reservation,
    result.providerCostCents,
  );
  if (!settled.ok) return { ok: false, error: "interpretation_failed" };
  await data.saveWallet({ organizationId: params.organizationId, ...settled.wallet });
  await data.saveReservation({
    ...reservationRecord,
    status: settled.reservation.status,
    settledProviderCostCents: settled.reservation.settledProviderCostCents,
    settledCustomerChargeCents: settled.reservation.settledCustomerChargeCents,
  });
  await data.appendLedgerEntry({
    organizationId: params.organizationId,
    kind: "settlement",
    amountCents: -settled.customerChargeCents,
    reservationId: reservationRecord.id,
    note: `Source interpretation settlement (${tier.rate.rateVersion}); provider cost × 1.50.`,
  });
  await data.appendUsageEvent({
    organizationId: params.organizationId,
    reservationId: reservationRecord.id,
    modelId: tier.modelId,
    rateVersion: tier.rate.rateVersion,
    providerCostCents: result.providerCostCents,
    customerChargeCents: settled.customerChargeCents,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  });

  // Store the artifact with model + cost provenance (feature PRD §5.1).
  const artifact = await data.createExtractionArtifact({
    organizationId: params.organizationId,
    inventionId: source.inventionId,
    sourceId: source.id,
    type: "interpretation_summary",
    content: composeArtifactContent(source.name, result.output),
    modelId: tier.modelId,
    costReservationId: reservationRecord.id,
  });

  // Component candidates land as ai_proposed (invariant 13); dedupe by name.
  const existingComponents = await data.listComponents(
    params.organizationId,
    source.inventionId,
  );
  const known = new Set(existingComponents.map((component) => component.name.toLowerCase()));
  for (const candidate of result.output.componentCandidates) {
    const name = candidate.name.trim().slice(0, 200);
    if (!name || known.has(name.toLowerCase())) continue;
    known.add(name.toLowerCase());
    await data.createComponent({
      organizationId: params.organizationId,
      inventionId: source.inventionId,
      name,
      description: candidate.description.slice(0, 2000),
      state: "ai_proposed",
      sourceAnchors: [`source:${source.name}`, `artifact:${artifact.id}`],
    });
  }

  await data.updateSource(params.organizationId, params.sourceId, {
    interpretationStatus: "interpreted",
  });
  await data.appendAuditEvent({
    organizationId: params.organizationId,
    actor: params.userId,
    action: "source.interpreted",
    target: source.id,
    meta: { modelId: tier.modelId, reservationId: reservationRecord.id },
  });

  const artifacts = await data.listExtractionArtifactsForSource(
    params.organizationId,
    params.sourceId,
  );
  return { ok: true, sourceId: source.id, status: "interpreted", artifactCount: artifacts.length };
}
