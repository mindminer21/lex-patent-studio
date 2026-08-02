import "server-only";

import { canRetryJob, canTransitionJob } from "@/lib/domain/jobs";
import { getAdapters } from "../adapters";
import type { Id, JobKind, JobRecord } from "../adapters/types";
import { getExecutor } from "./executors";

/**
 * Local durable-job runner (PRD §14).
 *
 * - Enqueueing is idempotent: the same (organization, kind, key) resolves to
 *   the same job row. A key whose job already succeeded returns that job —
 *   it never runs twice.
 * - A failed or cancelled job re-queues under the same key (attempts
 *   increment); executors are written so retries never double-charge
 *   (generation passes the job's idempotency key into the reservation
 *   layer, which deduplicates by key — see services/generation.ts).
 * - Request handlers never await the work (PRD §14): the job is scheduled
 *   onto the event loop and progress is observed via GET /api/jobs/:id.
 *
 * Production swaps this scheduling for a real queue/worker (approval-gated
 * infrastructure); the DataPort job records and executors are unchanged.
 */
export type EnqueueResult =
  | { ok: true; job: JobRecord; deduplicated: boolean }
  | { ok: false; error: "unknown_kind" };

export async function enqueueJob(
  input: {
    organizationId: Id;
    kind: JobKind;
    idempotencyKey: string;
    payload: JobRecord["payload"];
  },
  options?: { defer?: boolean },
): Promise<EnqueueResult> {
  if (!getExecutor(input.kind)) return { ok: false, error: "unknown_kind" };
  const { data } = getAdapters();

  const existing = await data.findJobByKey(
    input.organizationId,
    input.kind,
    input.idempotencyKey,
  );
  if (existing) {
    if (canRetryJob(existing.status)) {
      // Explicit retry path: re-queue the same job row under the same key.
      const requeued = await data.updateJob(input.organizationId, existing.id, {
        status: "queued",
        errorSummary: null,
      });
      if (requeued && !options?.defer) schedule(input.organizationId, requeued.id);
      return { ok: true, job: requeued ?? existing, deduplicated: true };
    }
    // queued / running / succeeded: never a second execution for this key.
    return { ok: true, job: existing, deduplicated: true };
  }

  const job = await data.createJob({
    organizationId: input.organizationId,
    kind: input.kind,
    idempotencyKey: input.idempotencyKey,
    payload: input.payload,
  });
  if (!options?.defer) schedule(input.organizationId, job.id);
  return { ok: true, job, deduplicated: false };
}

function schedule(organizationId: Id, jobId: Id): void {
  setTimeout(() => {
    void processJob(organizationId, jobId).catch(() => {
      // processJob records its own failure state; never crash the server.
    });
  }, 0);
}

/** Runs one queued job to completion. Exposed for tests and local draining. */
export async function processJob(organizationId: Id, jobId: Id): Promise<JobRecord | null> {
  const { data } = getAdapters();
  const job = await data.getJob(organizationId, jobId);
  if (!job || job.status !== "queued") return job;

  const executor = getExecutor(job.kind);
  if (!executor) {
    return data.updateJob(organizationId, jobId, {
      status: "failed",
      errorSummary: "no_executor",
      finishedAt: new Date().toISOString(),
    });
  }

  await data.updateJob(organizationId, jobId, {
    status: "running",
    attempts: job.attempts + 1,
    startedAt: new Date().toISOString(),
  });

  try {
    const result = await executor({ ...job, status: "running", attempts: job.attempts + 1 });
    return await data.updateJob(organizationId, jobId, {
      status: "succeeded",
      result,
      finishedAt: new Date().toISOString(),
    });
  } catch (error) {
    return await data.updateJob(organizationId, jobId, {
      status: "failed",
      // Generic summaries only — provider/internal detail stays server-side
      // in structured logs (PRD §10).
      errorSummary: error instanceof Error ? error.message.slice(0, 200) : "job_failed",
      finishedAt: new Date().toISOString(),
    });
  }
}

/** Cancels a queued job. Running/terminal jobs are not interruptible locally. */
export async function cancelJob(organizationId: Id, jobId: Id): Promise<JobRecord | null> {
  const { data } = getAdapters();
  const job = await data.getJob(organizationId, jobId);
  if (!job) return null;
  if (!canTransitionJob(job.status, "cancelled")) return job;
  if (job.status === "running") return job; // local runner cannot interrupt
  return data.updateJob(organizationId, jobId, {
    status: "cancelled",
    finishedAt: new Date().toISOString(),
  });
}
