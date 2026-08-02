/**
 * Workflow-run state machine (PRD-lex-patent-studio FR-7).
 *
 * QUEUED → INGESTING → RETRIEVING → GENERATING → VERIFYING → RENDERING
 *        → COMPLETED | FAILED | CANCELLED
 *
 * Checkpointed per stage; retries never repeat a billable call with unknown
 * prior outcome (enforced by the orchestrator via stage checkpoints — the
 * state machine here is the single source of allowed transitions).
 */

export const RUN_STATES = [
  "QUEUED",
  "INGESTING",
  "RETRIEVING",
  "GENERATING",
  "VERIFYING",
  "RENDERING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;
export type RunState = (typeof RUN_STATES)[number];

/** The ordered pipeline stages (excludes terminal states). */
export const RUN_PIPELINE: readonly RunState[] = [
  "QUEUED",
  "INGESTING",
  "RETRIEVING",
  "GENERATING",
  "VERIFYING",
  "RENDERING",
] as const;

export const TERMINAL_RUN_STATES: ReadonlySet<RunState> = new Set([
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);

export function isTerminalRunState(state: RunState): boolean {
  return TERMINAL_RUN_STATES.has(state);
}

const TRANSITIONS: Record<RunState, ReadonlySet<RunState>> = {
  QUEUED: new Set(["INGESTING", "FAILED", "CANCELLED"]),
  INGESTING: new Set(["RETRIEVING", "FAILED", "CANCELLED"]),
  RETRIEVING: new Set(["GENERATING", "FAILED", "CANCELLED"]),
  GENERATING: new Set(["VERIFYING", "FAILED", "CANCELLED"]),
  VERIFYING: new Set(["RENDERING", "FAILED", "CANCELLED"]),
  RENDERING: new Set(["COMPLETED", "FAILED", "CANCELLED"]),
  COMPLETED: new Set(),
  FAILED: new Set(),
  CANCELLED: new Set(),
};

export function canTransitionRun(from: RunState, to: RunState): boolean {
  return TRANSITIONS[from]?.has(to) ?? false;
}

export class InvalidRunTransitionError extends Error {
  constructor(
    public readonly from: RunState,
    public readonly to: RunState,
  ) {
    super(`Invalid workflow-run transition: ${from} → ${to}`);
    this.name = "InvalidRunTransitionError";
  }
}

/** Transition guard: returns the new state or throws. */
export function transitionRun(from: RunState, to: RunState): RunState {
  if (!canTransitionRun(from, to)) throw new InvalidRunTransitionError(from, to);
  return to;
}

/** The next pipeline stage after `state`, or null when none (terminal/end). */
export function nextRunStage(state: RunState): RunState | null {
  const idx = RUN_PIPELINE.indexOf(state);
  if (idx === -1) return null;
  return idx + 1 < RUN_PIPELINE.length ? RUN_PIPELINE[idx + 1] : "COMPLETED";
}

/** 0..1 progress indicator for UI stage meters. */
export function runProgress(state: RunState): number {
  if (state === "COMPLETED") return 1;
  if (state === "FAILED" || state === "CANCELLED") return 0;
  const idx = RUN_PIPELINE.indexOf(state);
  return idx === -1 ? 0 : idx / RUN_PIPELINE.length;
}
