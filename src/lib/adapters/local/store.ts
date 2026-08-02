import { randomUUID } from "node:crypto";
import type {
  AuditEvent,
  ClaimRecord,
  DeadlineObservation,
  ExportRecord,
  FactEvent,
  Matter,
  MatterFact,
  MatterSource,
  ReviewDecisionRecord,
  ReviewItem,
  RunStageCheckpoint,
  UploadTarget,
  WalletReservation,
  WorkflowRun,
  WorkProductDocument,
} from "@/lib/domain/schemas";
import type { RunState } from "@/lib/domain/run-state";
import {
  DEMO_WALLET_BALANCE_USD,
  SEED_AUDIT_EVENTS,
  SEED_CLAIMS,
  SEED_DEADLINES,
  SEED_DECISIONS,
  SEED_DOCUMENTS,
  SEED_FACTS,
  SEED_MATTERS,
  SEED_REVIEW_ITEMS,
  SEED_RUNS,
  SEED_SOURCES,
} from "./seed";

/**
 * In-memory local-mode store. Zero credentials, synthetic data only.
 * Production replaces this with the Supabase adapter under RLS.
 */

/** Orchestration plan for a run created in this process (simulated). */
export interface RunPlan {
  runId: string;
  /** Wall-clock ISO time the simulated pipeline started. */
  startedAt: string;
  /** Deterministic per-stage durations in ms (simulated timing). */
  stageDurationsMs: Partial<Record<RunState, number>>;
  /** Local-mode failure injection: the stage at which the run fails. */
  failAtStage?: RunState;
  /** Local-mode verifier-failure injection: tamper one evidence quote. */
  tamperQuote?: boolean;
  /** Reserved (held) amount and the deterministic settlement amount. */
  heldUsd: number;
  expectedUsd: number;
}

/** Stored idempotency-key replay record (money/job endpoints). */
export interface IdempotencyRecord {
  key: string;
  endpoint: string;
  requestHash: string;
  status: number;
  body: unknown;
  createdAt: string;
}

export interface LocalStore {
  matters: Matter[];
  facts: MatterFact[];
  factEvents: FactEvent[];
  sources: MatterSource[];
  claims: ClaimRecord[];
  runs: WorkflowRun[];
  runStages: RunStageCheckpoint[];
  runPlans: RunPlan[];
  reservations: WalletReservation[];
  documents: WorkProductDocument[];
  reviewItems: ReviewItem[];
  decisions: ReviewDecisionRecord[];
  deadlines: DeadlineObservation[];
  auditEvents: AuditEvent[];
  uploadTargets: UploadTarget[];
  exports: ExportRecord[];
  idempotency: IdempotencyRecord[];
  walletBalanceUsd: number;
}

declare global {
  var __lexLocalStore: LocalStore | undefined;
}

function newStore(): LocalStore {
  // Structured clone keeps seed modules immutable across dev-server reloads.
  return structuredClone({
    matters: SEED_MATTERS,
    facts: SEED_FACTS,
    factEvents: [],
    sources: SEED_SOURCES,
    claims: SEED_CLAIMS,
    runs: SEED_RUNS,
    runStages: [],
    runPlans: [],
    reservations: [],
    documents: SEED_DOCUMENTS,
    reviewItems: SEED_REVIEW_ITEMS,
    decisions: SEED_DECISIONS,
    deadlines: SEED_DEADLINES,
    auditEvents: SEED_AUDIT_EVENTS,
    uploadTargets: [],
    exports: [],
    idempotency: [],
    walletBalanceUsd: DEMO_WALLET_BALANCE_USD,
  });
}

export function getLocalStore(): LocalStore {
  if (!globalThis.__lexLocalStore) {
    globalThis.__lexLocalStore = newStore();
  }
  return globalThis.__lexLocalStore;
}

/** Test seam: reset the in-memory store to the seed state. */
export function resetLocalStore(): void {
  globalThis.__lexLocalStore = newStore();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

export function appendAudit(
  store: LocalStore,
  event: Omit<AuditEvent, "id" | "createdAt">,
): AuditEvent {
  const full: AuditEvent = {
    ...event,
    id: newId("aud"),
    createdAt: nowIso(),
  };
  store.auditEvents.push(full);
  return full;
}
