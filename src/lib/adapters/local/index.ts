import { randomUUID } from "node:crypto";
import type {
  Adapters,
  AuthAdapter,
  BillingAdapter,
  DataAdapter,
  ModelGatewayAdapter,
  Session,
} from "@/lib/adapters/types";
import {
  applyReviewDecision,
  type ReviewDecision,
} from "@/lib/domain/review";
import { canInvokeWorkflow } from "@/lib/domain/roles";
import { effectiveTier, WORKFLOW_TIER_FLOOR } from "@/lib/domain/tiers";
import {
  estimateCharge,
  getModel,
  MODEL_CATALOG,
  walletSufficient,
  type ChargeEstimate,
  type ModelCatalogEntry,
  type TokenWorkload,
} from "@/lib/domain/pricing";
import {
  runRequestSchema,
  type AuditEvent,
  type ClaimRecord,
  type DeadlineObservation,
  type Matter,
  type MatterFact,
  type MatterSource,
  type ReviewDecisionRecord,
  type ReviewItem,
  type RunRequest,
  type WorkflowRun,
  type WorkProductDocument,
} from "@/lib/domain/schemas";
import {
  CORPUS_RELEASE,
  DEMO_SESSION,
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
 * Local-mode adapters: fully in-memory, zero credentials, synthetic data.
 *
 * TODO(adapter seam): the production DataAdapter is a Supabase-backed
 * implementation (see src/lib/adapters/supabase.ts) operating under RLS with
 * organization_id derived from the authenticated session. This local store
 * mirrors that contract so route/server-action code is adapter-agnostic.
 */

interface LocalStore {
  matters: Matter[];
  facts: MatterFact[];
  sources: MatterSource[];
  claims: ClaimRecord[];
  runs: WorkflowRun[];
  documents: WorkProductDocument[];
  reviewItems: ReviewItem[];
  decisions: ReviewDecisionRecord[];
  deadlines: DeadlineObservation[];
  auditEvents: AuditEvent[];
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
    sources: SEED_SOURCES,
    claims: SEED_CLAIMS,
    runs: SEED_RUNS,
    documents: SEED_DOCUMENTS,
    reviewItems: SEED_REVIEW_ITEMS,
    decisions: SEED_DECISIONS,
    deadlines: SEED_DEADLINES,
    auditEvents: SEED_AUDIT_EVENTS,
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

function nowIso(): string {
  return new Date().toISOString();
}

function appendAudit(
  store: LocalStore,
  event: Omit<AuditEvent, "id" | "createdAt">,
): AuditEvent {
  const full: AuditEvent = {
    ...event,
    id: `aud_${randomUUID()}`,
    createdAt: nowIso(),
  };
  store.auditEvents.push(full);
  return full;
}

const localAuth: AuthAdapter = {
  async getSession(): Promise<Session | null> {
    // TODO(adapter seam): production uses Supabase Auth via HTTP-only
    // cookies; local mode signs in a synthetic practitioner automatically.
    return DEMO_SESSION;
  },
};

const localBilling: BillingAdapter = {
  async getWalletBalanceUsd(organizationId: string): Promise<number> {
    void organizationId;
    // TODO(adapter seam): production reads wallet_accounts/wallet_ledger via
    // Stripe-reconciled balances. Local mode returns the synthetic balance.
    return getLocalStore().walletBalanceUsd;
  },
};

const localModelGateway: ModelGatewayAdapter = {
  listModels(): ModelCatalogEntry[] {
    return MODEL_CATALOG;
  },
  estimate(modelId: string, workload: TokenWorkload): ChargeEstimate {
    const model = getModel(modelId);
    if (!model) throw new Error(`Unknown model: ${modelId}`);
    return estimateCharge(model, workload);
  },
  isLive(): boolean {
    // Hard Round-1 guarantee: no live paid API is reachable.
    return false;
  },
};

const localData: DataAdapter = {
  async listMatters(organizationId) {
    return getLocalStore().matters.filter(
      (m) => m.organizationId === organizationId,
    );
  },

  async getMatter(organizationId, matterId) {
    return (
      getLocalStore().matters.find(
        (m) => m.organizationId === organizationId && m.id === matterId,
      ) ?? null
    );
  },

  async listFacts(organizationId, matterId) {
    return getLocalStore().facts.filter(
      (f) => f.organizationId === organizationId && f.matterId === matterId,
    );
  },

  async listSources(organizationId, matterId) {
    return getLocalStore().sources.filter(
      (s) => s.organizationId === organizationId && s.matterId === matterId,
    );
  },

  async listClaims(organizationId, matterId) {
    return getLocalStore()
      .claims.filter(
        (c) => c.organizationId === organizationId && c.matterId === matterId,
      )
      .sort((a, b) => a.claimNumber - b.claimNumber);
  },

  async listRuns(organizationId, matterId) {
    return getLocalStore()
      .runs.filter(
        (r) =>
          r.organizationId === organizationId &&
          (!matterId || r.matterId === matterId),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async createRun(organizationId, request, context) {
    const parsed = runRequestSchema.safeParse(request);
    if (!parsed.success) {
      return { ok: false, error: "Invalid run request." };
    }
    const req: RunRequest = parsed.data;
    const store = getLocalStore();

    const matter = store.matters.find(
      (m) => m.organizationId === organizationId && m.id === req.matterId,
    );
    if (!matter) return { ok: false, error: "Matter not found in this tenant." };

    // Server-side role policy — never UI hiding alone (Invariant 21).
    const tier = effectiveTier(req.workflowKey);
    if (!canInvokeWorkflow(context.role, tier)) {
      return {
        ok: false,
        error: `Role "${context.role}" may not invoke Tier-${tier} workflow "${req.workflowKey}".`,
      };
    }

    const model = getModel(req.modelId);
    if (!model) return { ok: false, error: "Unknown model." };

    const estimate = estimateCharge(model, {
      inputTokens: 60_000,
      outputTokens: 12_000,
      variance: 0.35,
    });
    if (!walletSufficient(store.walletBalanceUsd, estimate)) {
      return {
        ok: false,
        error: "Wallet balance is insufficient to reserve this run.",
      };
    }

    const run: WorkflowRun = {
      id: `run_${randomUUID()}`,
      organizationId,
      matterId: req.matterId,
      workflowKey: req.workflowKey,
      workflowVersion: `${req.workflowKey}@local-0.1`,
      tier,
      state: "QUEUED",
      jurisdiction: req.jurisdiction,
      asOfDate: req.asOfDate,
      modelId: model.id,
      modelTier: model.tier,
      corpusRelease: CORPUS_RELEASE,
      deliverableType: req.deliverableType,
      qualityControls: req.qualityControls,
      estimatedChargeLowUsd: estimate.lowChargeUsd,
      estimatedChargeHighUsd: estimate.highChargeUsd,
      requestedBy: context.requestedBy,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    store.runs.push(run);

    appendAudit(store, {
      organizationId,
      matterId: req.matterId,
      actorUserId: context.requestedBy,
      actorRole: context.role,
      action: "run.create",
      subjectType: "workflow_run",
      subjectId: run.id,
      detail: `Queued ${req.workflowKey} (Tier ${tier}, ${model.displayName}, est. $${estimate.lowChargeUsd.toFixed(2)}–$${estimate.highChargeUsd.toFixed(2)}). Local mode: no provider call is made.`,
    });

    // TODO(adapter seam): production enqueues a durable job that walks the
    // FR-7 state machine with per-stage checkpoints. Local mode leaves the
    // run QUEUED as a visible synthetic artifact.
    return { ok: true, run };
  },

  async listReviewItems(organizationId, filter) {
    return getLocalStore()
      .reviewItems.filter(
        (i) =>
          i.organizationId === organizationId &&
          (!filter?.matterId || i.matterId === filter.matterId) &&
          (!filter?.state || i.state === filter.state),
      )
      .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));
  },

  async decideReviewItem(organizationId, reviewItemId, decision, actor) {
    const store = getLocalStore();
    const item = store.reviewItems.find(
      (i) => i.organizationId === organizationId && i.id === reviewItemId,
    );
    if (!item) return { ok: false, error: "Review item not found." };

    // The single Invariant-16 gate: authenticated human + role policy +
    // legal state transition. Model/system actors are impossible here by
    // construction, but the domain gate still enforces it.
    const result = applyReviewDecision({
      current: item.state,
      decision,
      tier: item.tier,
      actor: {
        type: "human",
        userId: actor.userId,
        role: actor.role,
        authenticated: true,
      },
    });
    if (!result.ok) return { ok: false, error: result.error };

    item.state = result.nextState;
    item.updatedAt = nowIso();

    const doc = store.documents.find((d) => d.runId === item.runId);
    if (doc) {
      doc.reviewState = result.nextState;
      doc.updatedAt = nowIso();
    }

    const record: ReviewDecisionRecord = {
      id: `dec_${randomUUID()}`,
      organizationId,
      reviewItemId,
      decision,
      note: actor.note,
      actorUserId: actor.userId,
      actorRole: actor.role,
      documentVersionHash: item.documentVersionHash,
      decidedAt: nowIso(),
    };
    store.decisions.push(record);

    appendAudit(store, {
      organizationId,
      matterId: item.matterId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: `review.${decision}`,
      subjectType: "review_item",
      subjectId: reviewItemId,
      detail: `${decision} on "${item.documentTitle}" (Tier ${item.tier}, doc hash ${item.documentVersionHash})${actor.note ? ` — note: ${actor.note}` : ""}`,
    });

    return { ok: true, item, record };
  },

  async listDocuments(organizationId, matterId) {
    return getLocalStore().documents.filter(
      (d) =>
        d.organizationId === organizationId &&
        (!matterId || d.matterId === matterId),
    );
  },

  async listDeadlines(organizationId) {
    return getLocalStore()
      .deadlines.filter((d) => d.organizationId === organizationId)
      .sort((a, b) => a.observedDate.localeCompare(b.observedDate));
  },

  async listAuditEvents(organizationId, filter) {
    const events = getLocalStore()
      .auditEvents.filter(
        (e) =>
          e.organizationId === organizationId &&
          (!filter?.matterId || e.matterId === filter.matterId),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return filter?.limit ? events.slice(0, filter.limit) : events;
  },
};

export const localAdapters: Adapters = {
  auth: localAuth,
  data: localData,
  billing: localBilling,
  modelGateway: localModelGateway,
};

export { WORKFLOW_TIER_FLOOR };

export type { ReviewDecision };
