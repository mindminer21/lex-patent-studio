import { getAdapters, type Session } from "@/lib/adapters";
import {
  can,
  canInvokeWorkflow,
  invokeActionForTier,
} from "@/lib/domain/roles";
import { effectiveTier } from "@/lib/domain/tiers";
import { getWorkflowMeta } from "@/lib/domain/workflow-meta";
import { estimateCharge, getModel, walletSufficient } from "@/lib/domain/pricing";
import {
  factCreateSchema,
  matterCreateSchema,
  matterPatchSchema,
  reviewDecisionSchema,
  runEstimateSchema,
  runRequestSchema,
  uploadSignSchema,
} from "@/lib/domain/schemas";
import { z } from "zod";
import {
  apiResult,
  badRequest,
  forbidden,
  mapAdapterError,
  notFound,
  type ApiResult,
} from "./http";

/**
 * Endpoint implementations (PRD §12). Pure functions of (session, input) so
 * the role × endpoint authorization matrix is unit-testable without HTTP.
 * Every mutation re-validates with Zod and re-checks role policy server-side;
 * the adapters enforce the same invariants a second time.
 */

const data = () => getAdapters().data;
const billing = () => getAdapters().billing;

// ---------------------------------------------------------------------------
// Matters
// ---------------------------------------------------------------------------

export async function listMattersEndpoint(session: Session): Promise<ApiResult> {
  if (!can(session.role, "matter.view")) return forbidden();
  const matters = await data().listMatters(session.organizationId);
  return apiResult(200, { matters });
}

export async function createMatterEndpoint(
  session: Session,
  body: unknown,
): Promise<ApiResult> {
  if (!can(session.role, "matter.create")) return forbidden();
  const parsed = matterCreateSchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid matter input.");
  const result = await data().createMatter(session.organizationId, parsed.data, {
    userId: session.userId,
    role: session.role,
  });
  if (!result.ok) return mapAdapterError(result.error);
  return apiResult(201, { matter: result.matter });
}

export async function getMatterEndpoint(
  session: Session,
  matterId: string,
): Promise<ApiResult> {
  if (!can(session.role, "matter.view")) return forbidden();
  const matter = await data().getMatter(session.organizationId, matterId);
  if (!matter) return notFound();
  return apiResult(200, { matter });
}

export async function patchMatterEndpoint(
  session: Session,
  matterId: string,
  body: unknown,
): Promise<ApiResult> {
  if (!can(session.role, "matter.edit")) return forbidden();
  const parsed = matterPatchSchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid matter patch.");
  const result = await data().updateMatter(
    session.organizationId,
    matterId,
    parsed.data,
    { userId: session.userId, role: session.role },
  );
  if (!result.ok) return mapAdapterError(result.error);
  return apiResult(200, { matter: result.matter });
}

// ---------------------------------------------------------------------------
// Facts + approval (fact_events)
// ---------------------------------------------------------------------------

export async function listFactsEndpoint(
  session: Session,
  matterId: string,
): Promise<ApiResult> {
  if (!can(session.role, "matter.view")) return forbidden();
  const matter = await data().getMatter(session.organizationId, matterId);
  if (!matter) return notFound();
  const [facts, events] = await Promise.all([
    data().listFacts(session.organizationId, matterId),
    data().listFactEvents(session.organizationId, matterId),
  ]);
  return apiResult(200, { facts, events });
}

export async function createFactEndpoint(
  session: Session,
  matterId: string,
  body: unknown,
): Promise<ApiResult> {
  if (!can(session.role, "facts.contribute")) return forbidden();
  const parsed = factCreateSchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid fact input.");
  const result = await data().createFact(
    session.organizationId,
    matterId,
    parsed.data,
    { userId: session.userId, role: session.role },
  );
  if (!result.ok) return mapAdapterError(result.error);
  return apiResult(201, { fact: result.fact });
}

const approveNoteSchema = z.object({ note: z.string().max(2000).optional() });

export async function approveFactEndpoint(
  session: Session,
  matterId: string,
  factId: string,
  body: unknown,
): Promise<ApiResult> {
  // Human practitioner approval only (Invariant-16 analog for facts).
  if (!can(session.role, "facts.approve")) return forbidden();
  const parsed = approveNoteSchema.safeParse(body ?? {});
  if (!parsed.success) return badRequest();
  const result = await data().approveFact(session.organizationId, matterId, factId, {
    userId: session.userId,
    role: session.role,
    note: parsed.data.note,
  });
  if (!result.ok) return mapAdapterError(result.error);
  return apiResult(200, { fact: result.fact, event: result.event });
}

// ---------------------------------------------------------------------------
// Uploads (signed target seam)
// ---------------------------------------------------------------------------

export async function signUploadEndpoint(
  session: Session,
  matterId: string,
  body: unknown,
): Promise<ApiResult> {
  if (!can(session.role, "sources.upload")) return forbidden();
  const parsed = uploadSignSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Invalid upload request.");
  }
  const result = await data().createUploadTarget(
    session.organizationId,
    matterId,
    parsed.data,
    { userId: session.userId, role: session.role },
  );
  if (!result.ok) return mapAdapterError(result.error);
  return apiResult(201, { target: result.target });
}

// ---------------------------------------------------------------------------
// Runs: estimate, create, status, cancel
// ---------------------------------------------------------------------------

export async function estimateRunEndpoint(
  session: Session,
  matterId: string,
  body: unknown,
): Promise<ApiResult> {
  const parsed = runEstimateSchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid estimate request.");

  const tier = effectiveTier(parsed.data.workflowKey);
  if (!canInvokeWorkflow(session.role, tier)) {
    return forbidden(
      `Role "${session.role}" may not invoke Tier-${tier} workflows.`,
    );
  }
  const matter = await data().getMatter(session.organizationId, matterId);
  if (!matter) return notFound();

  const model = getModel(parsed.data.modelId);
  if (!model) return badRequest("Unknown model.");
  const meta = getWorkflowMeta(parsed.data.workflowKey);
  if (!meta) return badRequest("Workflow is not available in the composer.");

  const estimate = estimateCharge(model, meta.workload);
  const walletBalanceUsd = await billing().getWalletBalanceUsd(session.organizationId);
  return apiResult(200, {
    workflowKey: parsed.data.workflowKey,
    tier,
    model: { id: model.id, displayName: model.displayName, tier: model.tier },
    estimate,
    walletBalanceUsd,
    sufficient: walletSufficient(walletBalanceUsd, estimate),
    note: "Estimate = provider cost × 1.50 with the disclosed variance band. Reservation holds the high end before any execution.",
  });
}

export async function createRunEndpoint(
  session: Session,
  matterId: string,
  body: unknown,
): Promise<ApiResult> {
  const parsed = runRequestSchema.safeParse(
    typeof body === "object" && body !== null ? { ...body, matterId } : body,
  );
  if (!parsed.success) return badRequest("Invalid run request.");

  const tier = effectiveTier(parsed.data.workflowKey);
  if (!canInvokeWorkflow(session.role, tier)) {
    return forbidden(
      `Role "${session.role}" may not invoke Tier-${tier} workflows.`,
    );
  }
  const result = await data().createRun(session.organizationId, parsed.data, {
    requestedBy: session.userId,
    role: session.role,
  });
  if (!result.ok) return mapAdapterError(result.error);
  return apiResult(201, { run: result.run });
}

export async function listRunsEndpoint(
  session: Session,
  matterId?: string,
): Promise<ApiResult> {
  if (!can(session.role, "matter.view")) return forbidden();
  const runs = await data().listRuns(session.organizationId, matterId);
  return apiResult(200, { runs });
}

export async function getRunEndpoint(
  session: Session,
  runId: string,
): Promise<ApiResult> {
  if (!can(session.role, "matter.view")) return forbidden();
  const detail = await data().getRun(session.organizationId, runId);
  if (!detail) return notFound();
  return apiResult(200, detail);
}

export async function cancelRunEndpoint(
  session: Session,
  runId: string,
): Promise<ApiResult> {
  const detail = await data().getRun(session.organizationId, runId);
  if (!detail) return notFound();
  // Cancellation requires the same right the run's tier required to start.
  if (!can(session.role, invokeActionForTier(detail.run.tier))) {
    return forbidden(
      `Role "${session.role}" may not cancel Tier-${detail.run.tier} runs.`,
    );
  }
  const result = await data().cancelRun(session.organizationId, runId, {
    userId: session.userId,
    role: session.role,
  });
  if (!result.ok) return mapAdapterError(result.error);
  return apiResult(200, { run: result.run });
}

// ---------------------------------------------------------------------------
// Documents + export
// ---------------------------------------------------------------------------

export async function listDocumentsEndpoint(
  session: Session,
  matterId: string,
): Promise<ApiResult> {
  if (!can(session.role, "matter.view")) return forbidden();
  const matter = await data().getMatter(session.organizationId, matterId);
  if (!matter) return notFound();
  const [documents, exports] = await Promise.all([
    data().listDocuments(session.organizationId, matterId),
    data().listExports(session.organizationId, matterId),
  ]);
  return apiResult(200, {
    documents,
    exports: exports.map(exportSummary),
  });
}

function exportSummary(record: {
  id: string;
  documentId: string;
  documentVersion: number;
  fileName: string;
  docxSha256: string;
  manifest: unknown;
  createdAt: string;
  createdBy: string;
}) {
  return {
    id: record.id,
    documentId: record.documentId,
    documentVersion: record.documentVersion,
    fileName: record.fileName,
    docxSha256: record.docxSha256,
    manifest: record.manifest,
    createdAt: record.createdAt,
    createdBy: record.createdBy,
    downloadPath: `/api/exports/${record.id}`,
  };
}

export async function exportDocumentEndpoint(
  session: Session,
  documentId: string,
): Promise<ApiResult> {
  if (!can(session.role, "export.draft")) return forbidden();
  const result = await data().createExport(session.organizationId, documentId, {
    userId: session.userId,
    role: session.role,
  });
  if (!result.ok) return mapAdapterError(result.error);
  return apiResult(result.reused ? 200 : 201, {
    export: exportSummary(result.record),
    reused: result.reused,
  });
}

// ---------------------------------------------------------------------------
// Knowledge: corpus search + quote verification (FR-5, §12)
// ---------------------------------------------------------------------------

const knowledgeSearchSchema = z.object({
  q: z.string().min(2).max(200),
  asOfDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD")
    .optional(),
  collection: z
    .enum([
      "prosecution",
      "drafting",
      "litigation",
      "ptab",
      "foreign_pct",
      "technical_prior_art",
    ])
    .optional(),
  includeInternational: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(25).optional(),
});

export async function knowledgeSearchEndpoint(
  session: Session,
  query: unknown,
): Promise<ApiResult> {
  // License-gated public corpus; contributor seats are limited to intake and
  // status visibility (PRD §3), so knowledge.search is a distinct right.
  if (!can(session.role, "knowledge.search")) return forbidden();
  const parsed = knowledgeSearchSchema.safeParse(query);
  if (!parsed.success) return badRequest("Invalid knowledge search.");
  const { searchCorpus } = await import("@/lib/knowledge");
  const result = searchCorpus({
    query: parsed.data.q,
    jurisdiction: "US",
    asOfDate: parsed.data.asOfDate ?? new Date().toISOString().slice(0, 10),
    collection: parsed.data.collection,
    includeInternational: parsed.data.includeInternational,
    limit: parsed.data.limit,
  });
  return apiResult(200, result);
}

const verifyQuoteSchema = z.object({
  corpusDocumentId: z.string().min(1).max(120),
  quote: z.string().min(1).max(2000),
});

export async function verifyQuoteEndpoint(
  session: Session,
  query: unknown,
): Promise<ApiResult> {
  if (!can(session.role, "knowledge.search")) return forbidden();
  const parsed = verifyQuoteSchema.safeParse(query);
  if (!parsed.success) return badRequest("Invalid quote-verification request.");
  const { verifyQuote } = await import("@/lib/knowledge");
  const verification = verifyQuote(parsed.data);
  return apiResult(200, { verification });
}

// ---------------------------------------------------------------------------
// Review queue + decisions
// ---------------------------------------------------------------------------

export async function reviewQueueEndpoint(session: Session): Promise<ApiResult> {
  if (!can(session.role, "matter.view")) return forbidden();
  const items = await data().listReviewItems(session.organizationId);
  return apiResult(200, { items });
}

const decisionBodySchema = z.object({
  decision: reviewDecisionSchema,
  note: z.string().max(4000).optional(),
});

export async function decideReviewEndpoint(
  session: Session,
  reviewItemId: string,
  body: unknown,
): Promise<ApiResult> {
  const parsed = decisionBodySchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid decision.");
  // Tier-level decision rights are enforced by the domain gate (Invariant
  // 16): authenticated human + role policy + legal transition.
  const result = await data().decideReviewItem(
    session.organizationId,
    reviewItemId,
    parsed.data.decision,
    { userId: session.userId, role: session.role, note: parsed.data.note },
  );
  if (!result.ok) return mapAdapterError(result.error);
  return apiResult(200, { item: result.item, record: result.record });
}
