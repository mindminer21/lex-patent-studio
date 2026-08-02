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
import {
  can,
  canInvokeWorkflow,
  type Role,
} from "@/lib/domain/roles";
import { canTransitionFact, isDraftableProvenance } from "@/lib/domain/provenance";
import { effectiveTier, WORKFLOW_TIER_FLOOR } from "@/lib/domain/tiers";
import { getWorkflowMeta } from "@/lib/domain/workflow-meta";
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
  factCreateSchema,
  matterCreateSchema,
  matterPatchSchema,
  runRequestSchema,
  uploadSignSchema,
  type ExportRecord,
  type FactEvent,
  type Matter,
  type MatterFact,
  type ReviewDecisionRecord,
  type ReviewItem,
  type RunRequest,
  type UploadTarget,
  type WorkflowRun,
} from "@/lib/domain/schemas";
import { renderUsptoDocx } from "@/lib/export/docx";
import { buildExportManifest, exportFileName } from "@/lib/export/manifest";
import { CORPUS_RELEASE, DEMO_SESSION } from "./seed";
import {
  advanceAllRuns,
  advanceRun,
  cancelRun as orchestratorCancelRun,
  startRunPlan,
} from "./orchestrator";
import { appendAudit, getLocalStore, newId, nowIso } from "./store";

/**
 * Local-mode adapters: fully in-memory, zero credentials, synthetic data.
 *
 * TODO(adapter seam): the production DataAdapter is a Supabase-backed
 * implementation (see src/lib/adapters/supabase.ts) operating under RLS with
 * organization_id derived from the authenticated session. This local store
 * mirrors that contract so route/server-action code is adapter-agnostic.
 */

export { getLocalStore, resetLocalStore } from "./store";

const DEFAULT_WORKLOAD: TokenWorkload = {
  inputTokens: 60_000,
  outputTokens: 12_000,
  variance: 0.35,
};

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
    // Hard guarantee: no live paid API is reachable in local mode.
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

  async createMatter(organizationId, input, actor) {
    if (!can(actor.role, "matter.create")) {
      return { ok: false, error: `Role "${actor.role}" may not create matters.` };
    }
    const parsed = matterCreateSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid matter input." };

    const store = getLocalStore();
    if (
      store.matters.some(
        (m) =>
          m.organizationId === organizationId &&
          m.matterNumber === parsed.data.matterNumber,
      )
    ) {
      return { ok: false, error: "Matter number already exists in this tenant." };
    }

    const matter: Matter = {
      id: newId("matter"),
      organizationId,
      ...parsed.data,
      lifecycle: "active",
      synthetic: true,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    store.matters.push(matter);
    appendAudit(store, {
      organizationId,
      matterId: matter.id,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: "matter.create",
      subjectType: "matter",
      subjectId: matter.id,
      detail: `Created matter ${matter.matterNumber} — ${matter.title}`,
    });
    return { ok: true, matter };
  },

  async updateMatter(organizationId, matterId, patch, actor) {
    if (!can(actor.role, "matter.edit")) {
      return { ok: false, error: `Role "${actor.role}" may not edit matters.` };
    }
    const parsed = matterPatchSchema.safeParse(patch);
    if (!parsed.success) return { ok: false, error: "Invalid matter patch." };

    const store = getLocalStore();
    const matter = store.matters.find(
      (m) => m.organizationId === organizationId && m.id === matterId,
    );
    if (!matter) return { ok: false, error: "Matter not found in this tenant." };
    if (parsed.data.lifecycle === "closed" && !can(actor.role, "matter.close")) {
      return { ok: false, error: `Role "${actor.role}" may not close matters.` };
    }

    Object.assign(matter, parsed.data);
    matter.updatedAt = nowIso();
    appendAudit(store, {
      organizationId,
      matterId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: "matter.edit",
      subjectType: "matter",
      subjectId: matterId,
      detail: `Updated fields: ${Object.keys(parsed.data).join(", ")}`,
    });
    return { ok: true, matter };
  },

  async listFacts(organizationId, matterId) {
    return getLocalStore().facts.filter(
      (f) => f.organizationId === organizationId && f.matterId === matterId,
    );
  },

  async createFact(organizationId, matterId, input, actor) {
    if (!can(actor.role, "facts.contribute")) {
      return { ok: false, error: `Role "${actor.role}" may not contribute facts.` };
    }
    const parsed = factCreateSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid fact input." };

    const store = getLocalStore();
    const matter = store.matters.find(
      (m) => m.organizationId === organizationId && m.id === matterId,
    );
    if (!matter) return { ok: false, error: "Matter not found in this tenant." };

    const fact: MatterFact = {
      id: newId("fact"),
      organizationId,
      matterId,
      category: parsed.data.category,
      text: parsed.data.text,
      provenance: "user_asserted",
      sourceIds: parsed.data.sourceIds,
      contributedBy: actor.userId,
      version: 1,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    store.facts.push(fact);

    const event: FactEvent = {
      id: newId("fev"),
      organizationId,
      matterId,
      factId: fact.id,
      eventType: "created",
      toProvenance: "user_asserted",
      actorUserId: actor.userId,
      actorRole: actor.role,
      createdAt: nowIso(),
    };
    store.factEvents.push(event);
    appendAudit(store, {
      organizationId,
      matterId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: "facts.contribute",
      subjectType: "matter_fact",
      subjectId: fact.id,
      detail: `Added ${fact.category} fact (user_asserted)`,
    });
    return { ok: true, fact };
  },

  async approveFact(organizationId, matterId, factId, actor) {
    // Invariant-16 analog for facts: counsel review is a HUMAN practitioner
    // action; model and system actors have no path here.
    if (!can(actor.role, "facts.approve")) {
      return { ok: false, error: `Role "${actor.role}" may not approve facts.` };
    }
    const store = getLocalStore();
    const fact = store.facts.find(
      (f) =>
        f.organizationId === organizationId &&
        f.matterId === matterId &&
        f.id === factId,
    );
    if (!fact) return { ok: false, error: "Fact not found in this matter." };

    const from = fact.provenance;
    if (!canTransitionFact(from, "counsel_reviewed", "human")) {
      return {
        ok: false,
        error: `Fact provenance "${from}" cannot transition to counsel_reviewed.`,
      };
    }
    fact.provenance = "counsel_reviewed";
    fact.version += 1;
    fact.updatedAt = nowIso();

    const event: FactEvent = {
      id: newId("fev"),
      organizationId,
      matterId,
      factId,
      eventType: "approved",
      fromProvenance: from,
      toProvenance: "counsel_reviewed",
      actorUserId: actor.userId,
      actorRole: actor.role,
      note: actor.note,
      createdAt: nowIso(),
    };
    store.factEvents.push(event);
    appendAudit(store, {
      organizationId,
      matterId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: "facts.approve",
      subjectType: "matter_fact",
      subjectId: factId,
      detail: `Fact approved: ${from} → counsel_reviewed (v${fact.version})`,
    });
    return { ok: true, fact, event };
  },

  async listFactEvents(organizationId, matterId) {
    return getLocalStore()
      .factEvents.filter(
        (e) => e.organizationId === organizationId && e.matterId === matterId,
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async listSources(organizationId, matterId) {
    return getLocalStore().sources.filter(
      (s) => s.organizationId === organizationId && s.matterId === matterId,
    );
  },

  async createUploadTarget(organizationId, matterId, input, actor) {
    if (!can(actor.role, "sources.upload")) {
      return { ok: false, error: `Role "${actor.role}" may not upload sources.` };
    }
    const parsed = uploadSignSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Invalid upload request.",
      };
    }
    const store = getLocalStore();
    const matter = store.matters.find(
      (m) => m.organizationId === organizationId && m.id === matterId,
    );
    if (!matter) return { ok: false, error: "Matter not found in this tenant." };

    // TODO(adapter seam): production issues a short-lived signed Supabase
    // Storage URL, then routes the object through malware scan → quarantine
    // → extraction (FR-4). Local mode issues a simulated target that no
    // network path accepts.
    const target: UploadTarget = {
      id: newId("upl"),
      organizationId,
      matterId,
      fileName: parsed.data.fileName,
      contentType: parsed.data.contentType,
      maxBytes: parsed.data.sizeBytes,
      uploadUrl: `local-sim://uploads/${matterId}/${encodeURIComponent(parsed.data.fileName)}`,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      createdBy: actor.userId,
      createdAt: nowIso(),
      simulated: true,
    };
    store.uploadTargets.push(target);
    appendAudit(store, {
      organizationId,
      matterId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: "sources.upload.sign",
      subjectType: "upload_target",
      subjectId: target.id,
      detail: `Signed upload target for ${target.fileName} (${target.contentType}, ≤${target.maxBytes} bytes). SIMULATED — local mode accepts no bytes.`,
    });
    return { ok: true, target };
  },

  async listClaims(organizationId, matterId) {
    return getLocalStore()
      .claims.filter(
        (c) => c.organizationId === organizationId && c.matterId === matterId,
      )
      .sort((a, b) => a.claimNumber - b.claimNumber);
  },

  async listRuns(organizationId, matterId) {
    const store = getLocalStore();
    advanceAllRuns(store);
    return store.runs
      .filter(
        (r) =>
          r.organizationId === organizationId &&
          (!matterId || r.matterId === matterId),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async getRun(organizationId, runId) {
    const store = getLocalStore();
    advanceRun(store, runId);
    const run = store.runs.find(
      (r) => r.organizationId === organizationId && r.id === runId,
    );
    if (!run) return null;
    const stages = store.runStages
      .filter((s) => s.runId === runId)
      .sort((a, b) => a.enteredAt.localeCompare(b.enteredAt));
    const reservation =
      store.reservations.find((r) => r.runId === runId) ?? null;
    return { run, stages, reservation };
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
    if (matter.lifecycle !== "active") {
      return { ok: false, error: "Runs require an active matter." };
    }

    // Server-side role policy — never UI hiding alone (Invariant 21).
    const tier = effectiveTier(req.workflowKey);
    if (!canInvokeWorkflow(context.role, tier)) {
      return {
        ok: false,
        error: `Role "${context.role}" may not invoke Tier-${tier} workflow "${req.workflowKey}".`,
      };
    }

    // PRD §9.2: no drafting run starts without approved facts.
    if (req.workflowKey === "section_draft" || req.workflowKey === "claim_tree_draft") {
      const approved = store.facts.filter(
        (f) =>
          f.organizationId === organizationId &&
          f.matterId === req.matterId &&
          isDraftableProvenance(f.provenance),
      );
      if (approved.length === 0) {
        return {
          ok: false,
          error:
            "Drafting is blocked: this matter has zero counsel-reviewed facts. Approve a fact baseline first.",
        };
      }
    }

    const model = getModel(req.modelId);
    if (!model) return { ok: false, error: "Unknown model." };

    const workload = getWorkflowMeta(req.workflowKey)?.workload ?? DEFAULT_WORKLOAD;
    const estimate = estimateCharge(model, workload);
    if (!walletSufficient(store.walletBalanceUsd, estimate)) {
      return {
        ok: false,
        error: "Wallet balance is insufficient to reserve this run.",
      };
    }

    const run: WorkflowRun = {
      id: newId("run"),
      organizationId,
      matterId: req.matterId,
      workflowKey: req.workflowKey,
      workflowVersion: `${req.workflowKey}@local-0.2`,
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

    // Reservation before run (FR-9) + simulated pipeline registration.
    startRunPlan(store, {
      run,
      heldUsd: estimate.highChargeUsd,
      expectedUsd: estimate.expectedChargeUsd,
      failAtStage: req.simulate?.failAtStage,
    });

    appendAudit(store, {
      organizationId,
      matterId: req.matterId,
      actorUserId: context.requestedBy,
      actorRole: context.role,
      action: "run.create",
      subjectType: "workflow_run",
      subjectId: run.id,
      detail: `Queued ${req.workflowKey} (Tier ${tier}, ${model.displayName}, est. $${estimate.lowChargeUsd.toFixed(2)}–$${estimate.highChargeUsd.toFixed(2)}; $${estimate.highChargeUsd.toFixed(2)} reserved). SIMULATED pipeline — no provider call is made.`,
    });

    return { ok: true, run };
  },

  async cancelRun(organizationId, runId, actor) {
    return orchestratorCancelRun(getLocalStore(), organizationId, runId, actor);
  },

  async listReviewItems(organizationId, filter) {
    const store = getLocalStore();
    advanceAllRuns(store);
    return store.reviewItems
      .filter(
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
      id: newId("dec"),
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
    const store = getLocalStore();
    advanceAllRuns(store);
    return store.documents.filter(
      (d) =>
        d.organizationId === organizationId &&
        (!matterId || d.matterId === matterId),
    );
  },

  async getDocument(organizationId, documentId) {
    const store = getLocalStore();
    return (
      store.documents.find(
        (d) => d.organizationId === organizationId && d.id === documentId,
      ) ?? null
    );
  },

  async listDecisionsForDocument(organizationId, documentId) {
    const store = getLocalStore();
    const doc = store.documents.find(
      (d) => d.organizationId === organizationId && d.id === documentId,
    );
    if (!doc) return [];
    const itemIds = new Set(
      store.reviewItems
        .filter((i) => i.organizationId === organizationId && i.runId === doc.runId)
        .map((i) => i.id),
    );
    return store.decisions
      .filter((d) => d.organizationId === organizationId && itemIds.has(d.reviewItemId))
      .sort((a, b) => a.decidedAt.localeCompare(b.decidedAt));
  },

  async createExport(organizationId, documentId, actor) {
    const store = getLocalStore();
    const doc = store.documents.find(
      (d) => d.organizationId === organizationId && d.id === documentId,
    );
    if (!doc) return { ok: false, error: "Document not found in this tenant." };

    // Export-as-approved is a separate right from draft export (FR-8).
    const requiredAction =
      doc.reviewState === "approved" ? "export.approved" : "export.draft";
    if (!can(actor.role, requiredAction)) {
      return {
        ok: false,
        error: `Role "${actor.role}" may not export this document (${requiredAction} required).`,
      };
    }

    // Version-locked immutability: an export for this document version is
    // created at most once; re-export returns the existing artifact.
    const existing = store.exports.find(
      (e) =>
        e.organizationId === organizationId &&
        e.documentId === documentId &&
        e.documentVersion === doc.version,
    );
    if (existing) return { ok: true, record: existing, reused: true };

    const exportId = newId("exp");
    const generatedAt = nowIso();
    const docxBuffer = await renderUsptoDocx(doc);
    const decisions = await localData.listDecisionsForDocument(
      organizationId,
      documentId,
    );
    const manifest = buildExportManifest({
      exportId,
      document: doc,
      decisions,
      docxBuffer,
      generatedBy: actor.userId,
      generatedAt,
    });

    const record: ExportRecord = {
      id: exportId,
      organizationId,
      matterId: doc.matterId,
      documentId,
      documentVersion: doc.version,
      fileName: exportFileName(doc),
      docxSha256: manifest.checksums.docxSha256,
      manifest,
      docxBase64: docxBuffer.toString("base64"),
      createdBy: actor.userId,
      createdAt: generatedAt,
    };
    store.exports.push(record);

    appendAudit(store, {
      organizationId,
      matterId: doc.matterId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: doc.reviewState === "approved" ? "export.approved" : "export.draft",
      subjectType: "export",
      subjectId: exportId,
      detail: `Exported "${doc.title}" v${doc.version} (${record.fileName}, sha256 ${record.docxSha256.slice(0, 12)}…)${manifest.watermark ? ` watermarked "${manifest.watermark}"` : " as approved work product"}.`,
    });
    return { ok: true, record, reused: false };
  },

  async listExports(organizationId, matterId) {
    return getLocalStore()
      .exports.filter(
        (e) =>
          e.organizationId === organizationId &&
          (!matterId || e.matterId === matterId),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async getExport(organizationId, exportId) {
    return (
      getLocalStore().exports.find(
        (e) => e.organizationId === organizationId && e.id === exportId,
      ) ?? null
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

export type { ReviewDecision, ReviewItem, Role };
