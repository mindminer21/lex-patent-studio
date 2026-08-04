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

/**
 * Patent figure generation (spec §5). Idempotent under retry: the job's
 * idempotency key flows into the reservation layer, and an unchanged draft
 * resolves to the existing figure set without a second charge.
 *
 * When the job carries a `draftSetId` it is the FIGURES STAGE of the
 * three-pass flow: the pipeline runs off the Pass-1 illustrations brief
 * (consuming its numerals rather than inventing any), and its outcome moves
 * the draft set on — to FIGURES_READY, which chains Pass 2 automatically, or
 * to the honest interruption state. Zero user steps either way.
 */
async function figurePlanExecutor(job: JobRecord): Promise<JobRecord["result"]> {
  const { runFigurePipeline } = await import("../services/figures");
  const draftSetId = job.payload.draftSetId ? String(job.payload.draftSetId) : null;
  const userId = String(job.payload.userId ?? "");

  let briefNumerals: Array<{
    numeral: string;
    partLabel: string;
    componentId: string | null;
  }> | null = null;
  let product = "wepatent";
  let tierId = "standard";
  if (draftSetId) {
    const { getAdapters } = await import("../adapters");
    const set = await getAdapters().data.getDraftSet(job.organizationId, draftSetId);
    const brief = set?.illustrationsBrief as
      | { numerals?: Array<{ numeral: string; partLabel: string; componentId: string | null }> }
      | undefined;
    briefNumerals = brief?.numerals ?? null;
    product = String(job.payload.product ?? "wepatent");
    tierId = String(job.payload.tierId ?? "standard");
  }

  const result = await runFigurePipeline({
    organizationId: job.organizationId,
    userId,
    inventionId: String(job.payload.inventionId ?? ""),
    draftVersionId: job.payload.draftVersionId ? String(job.payload.draftVersionId) : null,
    idempotencyKey: job.idempotencyKey,
    draftSetId,
    briefNumerals,
  });

  if (!result.ok) {
    // Caps are not failures: the pipeline paused and said why, and the
    // stored figure set carries that reason for the user to act on.
    const paused =
      result.error === "budget_cap_reached" || result.error === "org_daily_cap_reached";
    if (draftSetId) {
      const { onFiguresSettled } = await import("../services/draft-passes");
      await onFiguresSettled({
        organizationId: job.organizationId,
        userId,
        draftSetId,
        tierId,
        product: product === "lex" ? "lex" : "wepatent",
        outcome: paused
          ? { kind: "paused_budget", figureSetId: null, detail: result.detail }
          : { kind: "failed", detail: result.detail },
      });
    }
    if (paused) return { paused: true, reason: result.error, detail: result.detail };
    throw new Error(result.error);
  }

  if (draftSetId) {
    const { onFiguresSettled } = await import("../services/draft-passes");
    await onFiguresSettled({
      organizationId: job.organizationId,
      userId,
      draftSetId,
      tierId,
      product: product === "lex" ? "lex" : "wepatent",
      outcome:
        result.state === "ready"
          ? { kind: "ready", figureSetId: result.figureSetId }
          : result.state === "needs_input"
            ? {
                kind: "needs_input",
                figureSetId: result.figureSetId,
                detail:
                  "One or more figures could not be drawn from the record. Answer the open figure questions and the run resumes at the figures stage.",
              }
            : {
                kind: "failed",
                detail: `The figure stage finished in an unexpected state (${result.state}).`,
              },
    });
  }

  return {
    figureSetId: result.figureSetId,
    state: result.state,
    deduplicated: result.deduplicated,
    noop: result.noop,
  };
}

/**
 * Three-pass drafting, Pass 1: the application draft PLUS the illustrations
 * brief with its reference-numeral assignments. Idempotent under retry — the
 * job's key flows into the per-pass reservation, so a retry that already
 * settled returns the existing version and never charges twice.
 */
async function draftPassOneExecutor(job: JobRecord): Promise<JobRecord["result"]> {
  const { runDraftPassOne } = await import("../services/draft-passes");
  const product = String(job.payload.product ?? "wepatent");
  const result = await runDraftPassOne({
    organizationId: job.organizationId,
    userId: String(job.payload.userId ?? ""),
    draftSetId: String(job.payload.draftSetId ?? ""),
    tierId: String(job.payload.tierId ?? "standard"),
    product: product === "lex" ? "lex" : "wepatent",
    idempotencyKey: job.idempotencyKey,
  });
  if (!result.ok) {
    // A pause or a question is an honest outcome the user must see, not a
    // job failure to retry blindly.
    if (result.error === "insufficient_funds") {
      return { paused: true, reason: result.error, detail: result.detail };
    }
    throw new Error(result.error);
  }
  return { draftSetId: result.draftSetId, state: result.state, versionId: result.versionId };
}

/**
 * Three-pass drafting, Pass 2: the enablement revision against the figures
 * ACTUALLY produced, gated on the two-way §608.02 reconciliation.
 */
async function draftPassTwoExecutor(job: JobRecord): Promise<JobRecord["result"]> {
  const { runDraftPassTwo } = await import("../services/draft-passes");
  const product = String(job.payload.product ?? "wepatent");
  const result = await runDraftPassTwo({
    organizationId: job.organizationId,
    userId: String(job.payload.userId ?? ""),
    draftSetId: String(job.payload.draftSetId ?? ""),
    tierId: String(job.payload.tierId ?? "standard"),
    product: product === "lex" ? "lex" : "wepatent",
    idempotencyKey: job.idempotencyKey,
  });
  if (!result.ok) {
    // An unreconciled set is NOT a job failure: Pass 2 ran, produced a
    // version, and the gate held. The user has something to act on.
    if (result.error === "reconciliation_failed" || result.error === "insufficient_funds") {
      return { blocked: true, reason: result.error, detail: result.detail };
    }
    throw new Error(result.error);
  }
  return { draftSetId: result.draftSetId, state: result.state, versionId: result.versionId };
}

const EXECUTORS: Partial<Record<JobKind, JobExecutor>> = {
  draft_pass_1: draftPassOneExecutor,
  draft_pass_2: draftPassTwoExecutor,
  figure_plan: figurePlanExecutor,
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
