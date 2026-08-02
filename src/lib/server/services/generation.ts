import "server-only";

import { randomUUID } from "node:crypto";
import { isUnresolved } from "@/lib/wepatent/domain/facts";
import {
  estimateUsage,
  release,
  reserve,
  settle,
  type UsageEstimate,
} from "@/lib/wepatent/domain/usage";
import { getAdapters } from "../adapters";
import {
  getModelTier,
  isWorkflowAllowed,
  WORKFLOW_TITLES,
  type ModelTier,
} from "../model-registry";
import type {
  CorpusSnippet, DraftVersionRecord, DraftWorkflow, Id } from "../adapters/types";

/** Fixed estimation profile for the local workflows (tokens). */
const ESTIMATE_PROFILE = {
  outputLow: 600,
  outputHighFactor: 1, // maxOutputTokens × factor is the reserved ceiling
};

export function estimateForTier(
  tier: ModelTier,
  approximateInputTokens: number,
): UsageEstimate {
  return estimateUsage({
    rate: tier.rate,
    estimatedInputTokens: approximateInputTokens,
    estimatedOutputTokensLow: ESTIMATE_PROFILE.outputLow,
    estimatedOutputTokensHigh: tier.maxOutputTokens * ESTIMATE_PROFILE.outputHighFactor,
  });
}

export type GenerationResult =
  | { ok: true; version: DraftVersionRecord; draftId: Id }
  | {
      ok: false;
      error:
        | "invention_not_found"
        | "workflow_not_allowed"
        | "model_not_found"
        | "insufficient_funds"
        | "generation_failed";
    };

/**
 * Draft generation (PRD §7.4): estimate → idempotent reservation → gateway →
 * versioned working draft → settlement from provider-reported usage.
 *
 * No generation begins when the reservation fails; a retry with the same
 * idempotency key cannot double-charge; the stored version carries model,
 * costs, unresolved-fact count, and the required-review label. Model output
 * is stored as text only — it cannot mutate facts or approve itself.
 */
export async function runGeneration(params: {
  organizationId: Id;
  userId: Id;
  inventionId: Id;
  workflow: DraftWorkflow;
  tierId: string;
  idempotencyKey: string;
}): Promise<GenerationResult> {
  const { data, modelGateway, corpus } = getAdapters();

  const invention = await data.getInvention(params.organizationId, params.inventionId);
  if (!invention) return { ok: false, error: "invention_not_found" };

  if (!isWorkflowAllowed(params.workflow, params.tierId)) {
    return { ok: false, error: "workflow_not_allowed" };
  }
  const tier = getModelTier(params.tierId);
  if (!tier) return { ok: false, error: "model_not_found" };

  const facts = await data.listFacts(params.organizationId, params.inventionId);
  const contributors = await data.listContributors(params.organizationId, params.inventionId);
  const sources = await data.listSources(params.organizationId, params.inventionId);

  // Allowlisted public-corpus references (§7.4 step 4). Corpus degradation
  // must not block drafting — the draft simply carries no references and
  // the UI shows the degraded state.
  let corpusSnippets: CorpusSnippet[] = [];
  try {
    corpusSnippets = await corpus.searchAllowlisted(
      `${invention.title} ${params.workflow.replaceAll("_", " ")}`,
      3,
    );
  } catch {
    corpusSnippets = [];
  }

  const approximateInputTokens = Math.max(
    200,
    Math.ceil(
      (invention.summary.length +
        invention.problem.length +
        invention.solution.length +
        facts.reduce((sum, fact) => sum + fact.statement.length, 0)) /
        4,
    ),
  );
  const estimate = estimateForTier(tier, approximateInputTokens);

  // Reserve the high-bound customer charge against the wallet.
  const wallet = (await data.getWallet(params.organizationId)) ?? {
    organizationId: params.organizationId,
    balanceCents: 0,
    reservedCents: 0,
  };
  const existing = await data.listReservations(params.organizationId);
  const reserveResult = reserve(
    { balanceCents: wallet.balanceCents, reservedCents: wallet.reservedCents },
    existing,
    {
      id: randomUUID(),
      idempotencyKey: params.idempotencyKey,
      amountCents: estimate.customerHighCents,
      rateVersion: tier.rate.rateVersion,
    },
  );
  if (!reserveResult.ok) return { ok: false, error: "insufficient_funds" };

  if (reserveResult.deduplicated) {
    // A retry with the same idempotency key: return the already-produced
    // version if one exists instead of double-charging (PRD §7.4).
    const priorVersion = await findVersionByReservation(
      params.organizationId,
      reserveResult.reservation.id,
    );
    if (priorVersion) {
      return { ok: true, version: priorVersion.version, draftId: priorVersion.draftId };
    }
  }

  await data.saveWallet({ organizationId: params.organizationId, ...reserveResult.wallet });
  const reservationRecord = {
    ...reserveResult.reservation,
    organizationId: params.organizationId,
    createdAt: new Date().toISOString(),
  };
  await data.saveReservation(reservationRecord);

  let generation;
  try {
    generation = await modelGateway.generate({
      workflow: params.workflow,
      modelId: tier.modelId,
      invention,
      facts,
      contributors,
      sources,
      corpusSnippets,
      maxOutputTokens: tier.maxOutputTokens,
    });
  } catch {
    // Failed run: release the hold, never charge (PRD §7.4).
    const released = release(reserveResult.wallet, reserveResult.reservation);
    if (released.ok) {
      await data.saveWallet({ organizationId: params.organizationId, ...released.wallet });
      await data.saveReservation({
        ...reservationRecord,
        status: released.reservation.status,
      });
      await data.appendLedgerEntry({
        organizationId: params.organizationId,
        kind: "release",
        amountCents: 0,
        reservationId: reservationRecord.id,
        note: "Generation failed; reservation released without charge.",
      });
    }
    return { ok: false, error: "generation_failed" };
  }

  // Settle from provider-reported usage at cost × 1.50.
  const settled = settle(
    reserveResult.wallet,
    reserveResult.reservation,
    generation.providerCostCents,
  );
  if (!settled.ok) return { ok: false, error: "generation_failed" };

  await data.saveWallet({ organizationId: params.organizationId, ...settled.wallet });
  await data.saveReservation({
    ...reservationRecord,
    status: settled.reservation.status,
    settledProviderCostCents: settled.reservation.settledProviderCostCents,
    settledCustomerChargeCents: settled.reservation.settledCustomerChargeCents,
  });
  await data.appendLedgerEntry({
    organizationId: params.organizationId,
    kind: "settlement",
    amountCents: -settled.customerChargeCents,
    reservationId: reservationRecord.id,
    note: `AI usage settlement (${tier.rate.rateVersion}); provider cost × 1.50.`,
  });
  await data.appendUsageEvent({
    organizationId: params.organizationId,
    reservationId: reservationRecord.id,
    modelId: tier.modelId,
    rateVersion: tier.rate.rateVersion,
    providerCostCents: generation.providerCostCents,
    customerChargeCents: settled.customerChargeCents,
    inputTokens: generation.inputTokens,
    outputTokens: generation.outputTokens,
  });

  const draft = await data.createDraft({
    organizationId: params.organizationId,
    inventionId: params.inventionId,
    workflow: params.workflow,
    title: WORKFLOW_TITLES[params.workflow],
  });
  const unresolvedFactCount = facts.filter((fact) => isUnresolved(fact.provenance)).length;
  const extractedCount = sources.filter((source) => source.status === "extracted").length;
  const version = await data.createDraftVersion({
    organizationId: params.organizationId,
    draftId: draft.id,
    content: generation.content,
    modelId: tier.modelId,
    rateVersion: tier.rate.rateVersion,
    estimateCustomerHighCents: estimate.customerHighCents,
    actualProviderCostCents: generation.providerCostCents,
    actualCustomerChargeCents: settled.customerChargeCents,
    unresolvedFactCount,
    sourceStatusSummary: `${extractedCount} of ${sources.length} sources extracted`,
    reservationId: reservationRecord.id,
  });

  // §7.4 step 6: link the stored version to its source/fact/corpus
  // references so provenance is queryable, not just embedded in prose.
  for (const source of sources) {
    await data.createDraftCitation({
      organizationId: params.organizationId,
      draftVersionId: version.id,
      sourceId: source.id,
      factId: null,
      locator: `source:${source.name} (${source.status})`,
    });
  }
  for (const fact of facts) {
    await data.createDraftCitation({
      organizationId: params.organizationId,
      draftVersionId: version.id,
      sourceId: null,
      factId: fact.id,
      locator: `fact:${fact.category}/${fact.provenance}`,
    });
  }
  for (const snippet of corpusSnippets) {
    await data.createDraftCitation({
      organizationId: params.organizationId,
      draftVersionId: version.id,
      sourceId: null,
      factId: null,
      locator: `corpus:${snippet.citation} (as of ${snippet.effectiveDate ?? "n/a"}) ${snippet.canonicalUrl}`,
    });
  }

  await data.appendAuditEvent({
    organizationId: params.organizationId,
    actor: params.userId,
    action: "draft.generated",
    target: version.id,
    meta: {
      workflow: params.workflow,
      modelId: tier.modelId,
      reservationId: reservationRecord.id,
    },
  });

  return { ok: true, version, draftId: draft.id };
}

/**
 * Exact retry deduplication: every stored version records the reservation it
 * settled against, so a duplicate idempotency key resolves to at most one
 * version (PRD §7.4 — "a retry cannot double-charge or produce an untracked
 * duplicate").
 */
async function findVersionByReservation(
  organizationId: Id,
  reservationId: Id,
): Promise<{ version: DraftVersionRecord; draftId: Id } | null> {
  const { data } = getAdapters();
  const inventions = await data.listInventions(organizationId);
  for (const invention of inventions) {
    const drafts = await data.listDrafts(organizationId, invention.id);
    for (const draft of drafts) {
      const versions = await data.listDraftVersions(organizationId, draft.id);
      const match = versions.find((v) => v.reservationId === reservationId);
      if (match) return { version: match, draftId: draft.id };
    }
  }
  return null;
}
