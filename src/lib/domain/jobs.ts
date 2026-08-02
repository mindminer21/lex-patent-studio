/**
 * Durable-job state machine (PRD §14): long work runs outside the request
 * path with explicit `queued → running → succeeded | failed | cancelled`
 * states and safe, idempotent retry behavior.
 */
export const JOB_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const;

export type JobStatusValue = (typeof JOB_STATUSES)[number];

const TRANSITIONS: Record<JobStatusValue, readonly JobStatusValue[]> = {
  queued: ["running", "cancelled"],
  running: ["succeeded", "failed", "cancelled"],
  succeeded: [],
  failed: ["queued"], // explicit retry re-queues; nothing else
  cancelled: ["queued"], // explicit retry after cancel is allowed
};

export function canTransitionJob(from: JobStatusValue, to: JobStatusValue): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminalJobStatus(status: JobStatusValue): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

/** A retry may only be requested for failed or cancelled jobs. */
export function canRetryJob(status: JobStatusValue): boolean {
  return status === "failed" || status === "cancelled";
}
