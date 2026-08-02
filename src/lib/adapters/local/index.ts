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
  chatPostSchema,
  factCreateSchema,
  matterCreateSchema,
  matterPatchSchema,
  runRequestSchema,
  uploadSignSchema,
  type ChatMessage,
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
import {
  PLAYBOOK_CHAIN_GENESIS,
  playbookContentSha256,
  playbookEntryHash,
  playbookPublishSchema,
  styleProfileCreateSchema,
  styleProfileVersionLabel,
  verifyPlaybookChain,
  type PlaybookEntry,
  type StyleProfile,
} from "@/lib/domain/styles";
import {
  getRegistryEntry,
  searchCorpus,
  verifyQuote,
} from "@/lib/knowledge";
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

    // FR-7: a run records workflow version + model + corpus release + style
    // profile version. Matter-selected profile wins; otherwise the platform
    // neutral default.
    const styleProfile =
      (matter.styleProfileId &&
        store.styleProfiles.find(
          (p) => p.organizationId === organizationId && p.id === matter.styleProfileId,
        )) ||
      store.styleProfiles.find(
        (p) => p.organizationId === organizationId && p.platformDefault,
      );

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
      styleProfileVersion: styleProfile
        ? styleProfileVersionLabel(styleProfile)
        : undefined,
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
      tamperQuote: req.simulate?.tamperQuote,
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

  async listChatMessages(organizationId, matterId) {
    return getLocalStore()
      .chatMessages.filter(
        (m) => m.organizationId === organizationId && m.matterId === matterId,
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },

  async postChatMessage(organizationId, matterId, input, actor) {
    // Chat is a research surface: contributor seats cannot use it
    // (Invariant 21 — server-side policy, not UI hiding).
    if (!canInvokeWorkflow(actor.role, "B")) {
      return {
        ok: false,
        error: `Role "${actor.role}" may not use the grounded chat (research surface).`,
      };
    }
    const parsed = chatPostSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid chat message." };

    const store = getLocalStore();
    const matter = store.matters.find(
      (m) => m.organizationId === organizationId && m.id === matterId,
    );
    if (!matter) return { ok: false, error: "Matter not found in this tenant." };
    if (matter.lifecycle !== "active") {
      return { ok: false, error: "Chat requires an active matter." };
    }

    const asOfDate = parsed.data.asOfDate ?? new Date().toISOString().slice(0, 10);
    const question: ChatMessage = {
      id: newId("chat"),
      organizationId,
      matterId,
      author: "user",
      authorUserId: actor.userId,
      body: parsed.data.question,
      citations: [],
      createdAt: nowIso(),
    };
    store.chatMessages.push(question);

    // Grounded reply: REAL retrieval against the license-gated corpus with
    // matter isolation (only this matter's thread + public corpus; no other
    // matter's content is reachable from here by construction).
    const search = searchCorpus({
      query: parsed.data.question,
      jurisdiction: "US",
      asOfDate,
      limit: 4,
    });

    const citations: ChatMessage["citations"] = [];
    search.hits.forEach((hit, i) => {
      const entry = getRegistryEntry(hit.documentId);
      const section = entry?.sections.find((s) => s.id === hit.sectionId);
      if (!entry || !section) return;
      let quote = section.text.slice(0, 140);
      const lastSpace = quote.lastIndexOf(" ");
      if (lastSpace > 40) quote = quote.slice(0, lastSpace);
      const verification = verifyQuote({
        corpusDocumentId: hit.documentId,
        quote,
      });
      citations.push({
        id: `${question.id}_cit_${i + 1}`,
        kind: "authority",
        corpusDocumentId: hit.documentId,
        citation: hit.citation,
        quote,
        verification: verification.state,
        note: hit.authorityNote ?? hit.supersessionNote,
      });
    });

    const replyBody = search.insufficiencyWarning
      ? `${search.insufficiencyWarning} No authority is quoted because none was retrievable — Lex does not guess (§6.2).`
      : `Grounded on ${citations.length} retrieved authorit${citations.length === 1 ? "y" : "ies"} as of ${asOfDate} (corpus ${CORPUS_RELEASE}). Every quotation below passed the verifier; anything beyond the quoted text is labeled analysis for practitioner evaluation — this workspace never gives advice to an end client. [SIMULATED local mode: retrieval-only reply; no model call, no charge.]`;

    if (!search.insufficiencyWarning) {
      citations.push({
        id: `${question.id}_cit_analysis`,
        kind: "analysis",
        citation: "Analysis (no authority quoted)",
        verification: "unverified",
        note: "Labeled analysis — synthesis across the quoted authorities is drafting judgment, not quotation.",
      });
    }

    const reply: ChatMessage = {
      id: newId("chat"),
      organizationId,
      matterId,
      author: "lex",
      authorUserId: "system:lex",
      body: replyBody,
      citations,
      asOfDate,
      corpusRelease: CORPUS_RELEASE,
      createdAt: nowIso(),
    };
    store.chatMessages.push(reply);

    appendAudit(store, {
      organizationId,
      matterId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: "chat.post",
      subjectType: "chat_message",
      subjectId: question.id,
      detail: `Grounded chat exchange (${citations.filter((c) => c.kind === "authority").length} authority citation(s), as of ${asOfDate}). SIMULATED retrieval-only reply.`,
    });
    return { ok: true, question, reply };
  },

  async listStyleProfiles(organizationId) {
    return getLocalStore()
      .styleProfiles.filter((p) => p.organizationId === organizationId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },

  async createStyleProfile(organizationId, input, actor) {
    if (!can(actor.role, "styles.manage")) {
      return { ok: false, error: `Role "${actor.role}" may not manage style profiles.` };
    }
    const parsed = styleProfileCreateSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid style profile input." };

    const store = getLocalStore();
    const priorVersions = store.styleProfiles.filter(
      (p) => p.organizationId === organizationId && p.name === parsed.data.name,
    );
    if (priorVersions.some((p) => p.platformDefault)) {
      return {
        ok: false,
        error: "The platform default profile cannot be replaced; create a new named profile.",
      };
    }
    const profile: StyleProfile = {
      id: newId("style"),
      organizationId,
      name: parsed.data.name,
      kind: parsed.data.kind,
      rules: parsed.data.rules,
      version: priorVersions.length + 1,
      platformDefault: false,
      createdBy: actor.userId,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    store.styleProfiles.push(profile);
    appendAudit(store, {
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: "styles.manage",
      subjectType: "style_profile",
      subjectId: profile.id,
      detail: `Created style profile ${styleProfileVersionLabel(profile)} (${profile.kind}, ${profile.rules.length} rule(s)).`,
    });
    return { ok: true, profile };
  },

  async listPlaybookEntries(organizationId) {
    const entries = getLocalStore()
      .playbookEntries.filter((e) => e.organizationId === organizationId)
      .sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
    // Chain verification runs on EVERY read — tampering is always visible.
    return { entries, chain: verifyPlaybookChain(entries) };
  },

  async publishPlaybookEntry(organizationId, input, actor) {
    // §5.4 publication pipeline: reviewer identity, timestamp, immutable
    // content hash, chained to the tenant's previous entry.
    if (!can(actor.role, "playbook.publish")) {
      return { ok: false, error: `Role "${actor.role}" may not publish playbook entries.` };
    }
    const parsed = playbookPublishSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid playbook entry." };

    const store = getLocalStore();
    const tenantEntries = store.playbookEntries
      .filter((e) => e.organizationId === organizationId)
      .sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
    const prevEntryHash =
      tenantEntries.at(-1)?.entryHash ?? PLAYBOOK_CHAIN_GENESIS;

    const base = {
      id: newId("pb"),
      organizationId,
      title: parsed.data.title,
      category: parsed.data.category,
      body: parsed.data.body,
      publishedBy: actor.userId,
      publishedByRole: actor.role,
      publishedAt: nowIso(),
      prevEntryHash,
    };
    const contentSha256 = playbookContentSha256(base);
    const entry: PlaybookEntry = {
      ...base,
      contentSha256,
      entryHash: playbookEntryHash({ ...base, contentSha256 }),
    };
    store.playbookEntries.push(entry);
    appendAudit(store, {
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: "playbook.publish",
      subjectType: "playbook_entry",
      subjectId: entry.id,
      detail: `Published "${entry.title}" (${entry.category}) — content sha256 ${contentSha256.slice(0, 12)}…, chained to ${prevEntryHash === PLAYBOOK_CHAIN_GENESIS ? "genesis" : prevEntryHash.slice(0, 12) + "…"}.`,
    });
    return { ok: true, entry };
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
