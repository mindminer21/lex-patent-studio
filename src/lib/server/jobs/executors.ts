import "server-only";

import type { DraftWorkflow, JobKind, JobRecord } from "../adapters/types";
import { runGeneration } from "../services/generation";
import { performExtraction, performScan } from "../services/upload-pipeline";

/**
 * Job executors by kind. Each executor receives the job row and returns the
 * result payload; throwing marks the job failed with a generic summary.
 *
 * Executors must be idempotent under retry:
 * - generation: passes the job's idempotency key into the usage-reservation
 *   layer; a retry that already settled returns the existing version and
 *   never charges twice (PRD §7.4).
 */
export type JobExecutor = (job: JobRecord) => Promise<JobRecord["result"]>;

async function generationExecutor(job: JobRecord): Promise<JobRecord["result"]> {
  const inventionId = String(job.payload.inventionId ?? "");
  const workflow = String(job.payload.workflow ?? "") as DraftWorkflow;
  const tierId = String(job.payload.tierId ?? "");
  const userId = String(job.payload.userId ?? "");
  const result = await runGeneration({
    organizationId: job.organizationId,
    userId,
    inventionId,
    workflow,
    tierId,
    idempotencyKey: job.idempotencyKey,
  });
  if (!result.ok) {
    throw new Error(result.error);
  }
  return {
    draftId: result.draftId,
    versionId: result.version.id,
    inventionId,
  };
}

async function sourceScanExecutor(job: JobRecord): Promise<JobRecord["result"]> {
  const sourceId = String(job.payload.sourceId ?? "");
  const scan = await performScan(job.organizationId, sourceId);
  if (scan.status === "scanned") {
    // Clean scan releases the file to asynchronous extraction (FR-4).
    const { enqueueJob } = await import("./runner");
    await enqueueJob({
      organizationId: job.organizationId,
      kind: "source_extraction",
      idempotencyKey: `extract:${sourceId}`,
      payload: { sourceId },
    });
  }
  return { sourceId, status: scan.status, reason: scan.reason };
}

async function sourceExtractionExecutor(job: JobRecord): Promise<JobRecord["result"]> {
  const sourceId = String(job.payload.sourceId ?? "");
  const extraction = await performExtraction(job.organizationId, sourceId);
  return { sourceId, status: extraction.status };
}

async function exportRenderExecutor(job: JobRecord): Promise<JobRecord["result"]> {
  const { renderExportArtifacts } = await import("../services/export-render");
  const exportId = String(job.payload.exportId ?? "");
  const rendered = await renderExportArtifacts(job.organizationId, exportId);
  return { exportId, artifactCount: rendered.artifacts.length };
}

/**
 * Intake Studio interpretation (FR-INT-3). Idempotent under retry: the
 * job's idempotency key flows into the reservation layer, and an already
 * interpreted source returns its prior outcome without a second charge.
 */
async function sourceInterpretationExecutor(job: JobRecord): Promise<JobRecord["result"]> {
  const { runInterpretation } = await import("../services/interpretation");
  const result = await runInterpretation({
    organizationId: job.organizationId,
    userId: String(job.payload.userId ?? ""),
    sourceId: String(job.payload.sourceId ?? ""),
    idempotencyKey: job.idempotencyKey,
  });
  if (!result.ok) throw new Error(result.error);
  return { sourceId: result.sourceId, status: result.status, artifactCount: result.artifactCount };
}

/** Intake Studio distillation (FR-INT-4); same idempotency contract. */
async function distillationExecutor(job: JobRecord): Promise<JobRecord["result"]> {
  const { runDistillation } = await import("../services/distillation");
  const result = await runDistillation({
    organizationId: job.organizationId,
    userId: String(job.payload.userId ?? ""),
    inventionId: String(job.payload.inventionId ?? ""),
    idempotencyKey: job.idempotencyKey,
  });
  if (!result.ok) throw new Error(result.error);
  return {
    workingTitleId: result.workingTitleId,
    problemCount: result.problemCount,
    solutionCount: result.solutionCount,
    linkCount: result.linkCount,
    deduplicated: result.deduplicated,
  };
}

const EXECUTORS: Partial<Record<JobKind, JobExecutor>> = {
  generation: generationExecutor,
  source_scan: sourceScanExecutor,
  source_extraction: sourceExtractionExecutor,
  source_interpretation: sourceInterpretationExecutor,
  distillation: distillationExecutor,
  export_render: exportRenderExecutor,
};

export function registerExecutor(kind: JobKind, executor: JobExecutor): void {
  EXECUTORS[kind] = executor;
}

export function getExecutor(kind: JobKind): JobExecutor | null {
  return EXECUTORS[kind] ?? null;
}
