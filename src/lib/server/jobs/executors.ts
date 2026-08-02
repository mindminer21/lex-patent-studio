import "server-only";

import type { DraftWorkflow, JobKind, JobRecord } from "../adapters/types";
import { runGeneration } from "../services/generation";

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

const EXECUTORS: Partial<Record<JobKind, JobExecutor>> = {
  generation: generationExecutor,
};

export function registerExecutor(kind: JobKind, executor: JobExecutor): void {
  EXECUTORS[kind] = executor;
}

export function getExecutor(kind: JobKind): JobExecutor | null {
  return EXECUTORS[kind] ?? null;
}
