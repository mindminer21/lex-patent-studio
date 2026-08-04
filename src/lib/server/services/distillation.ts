import "server-only";

import { randomUUID } from "node:crypto";
import { normalizeRegion } from "@/lib/wepatent/domain/evidence";
import { applyPsAction } from "@/lib/wepatent/domain/ps-ledger";
import { interpretationClassFor } from "@/lib/wepatent/domain/uploads";
import { release, reserve, settle, type UsageEstimate } from "@/lib/wepatent/domain/usage";
import { getAdapters } from "../adapters";
import { getModelTier } from "../model-registry";
import { estimateForTier } from "./generation";
import { recomputeCoverage } from "./ps-ledger";
import type { Id } from "../adapters/types";

/**
 * Record-level distillation (Intake Studio §5.3, FR-INT-4).
 *
 * Synthesizes across interpreted artifacts + existing facts and writes a
 * working title, problems, solutions, pairings, and solution↔component
 * associations — ALL as `ai_proposed` through the domain guard (invariant
 * 13). It only ADDS proposals: user_confirmed / user_edited items are never
 * mutated, and statements that already exist are not re-proposed
 * (acceptance criterion 4). Re-runnable on demand; retries with the same
 * idempotency key can never double-charge (FR-6 reservation semantics).
 */

const DISTILLATION_TIER = "advanced"; // the quality-critical pass (feature PRD §10)

export type DistillationRunResult =
  | {
      ok: true;
      workingTitleId: Id;
      problemCount: number;
      solutionCount: number;
      linkCount: number;
      deduplicated: boolean;
    }
  | {
      ok: false;
      error:
        | "invention_not_found"
        | "nothing_to_distill"
        | "insufficient_funds"
        | "distillation_failed";
    };

/** Estimate for the UI cost preview (FR-INT-10). */
export async function estimateDistillation(
  organizationId: Id,
  inventionId: Id,
): Promise<{ estimate: UsageEstimate; artifactCount: number } | null> {
  const { data } = getAdapters();
  const tier = getModelTier(DISTILLATION_TIER);
  const invention = await data.getInvention(organizationId, inventionId);
  if (!tier || !invention) return null;
  const artifacts = await data.listExtractionArtifacts(organizationId, inventionId);
  const facts = await data.listFacts(organizationId, inventionId);
  const inputChars =
    artifacts.reduce((sum, artifact) => sum + artifact.content.length, 0) +
    facts.reduce((sum, fact) => sum + fact.statement.length, 0) +
    invention.summary.length +
    invention.problem.length +
    invention.solution.length +
    400;
  return {
    estimate: estimateForTier(tier, Math.max(300, Math.ceil(inputChars / 4))),
    artifactCount: artifacts.filter(
      (artifact) =>
        artifact.type === "interpretation_summary" || artifact.type === "transcript",
    ).length,
  };
}

export async function runDistillation(params: {
  organizationId: Id;
  userId: Id;
  inventionId: Id;
  idempotencyKey: string;
}): Promise<DistillationRunResult> {
  const { data, modelGateway } = getAdapters();
  const invention = await data.getInvention(params.organizationId, params.inventionId);
  if (!invention) return { ok: false, error: "invention_not_found" };

  const tier = getModelTier(DISTILLATION_TIER);
  if (!tier) return { ok: false, error: "distillation_failed" };

  const [allArtifacts, facts, components, sources] = await Promise.all([
    data.listExtractionArtifacts(params.organizationId, params.inventionId),
    data.listFacts(params.organizationId, params.inventionId),
    data.listComponents(params.organizationId, params.inventionId),
    data.listSources(params.organizationId, params.inventionId),
  ]);
  // Transcripts (M3 A/V) join distillation like any text source; their
  // content stays inside the delimited untrusted evidence blocks.
  const artifacts = allArtifacts.filter(
    (artifact) =>
      artifact.type === "interpretation_summary" || artifact.type === "transcript",
  );
  const hasRecordContent =
    invention.problem.trim().length > 0 ||
    invention.solution.trim().length > 0 ||
    facts.length > 0;
  if (artifacts.length === 0 && !hasRecordContent) {
    return { ok: false, error: "nothing_to_distill" };
  }

  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const artifactInputs = artifacts.map((artifact) => {
    const source = sourceById.get(artifact.sourceId);
    return {
      sourceName: source?.name ?? artifact.sourceId,
      content: artifact.content,
      sourceClass: source
        ? interpretationClassFor(source.mimeType, source.originalFilename ?? source.name)
        : undefined,
    };
  });

  const inputChars =
    artifactInputs.reduce((sum, artifact) => sum + artifact.content.length, 0) +
    facts.reduce((sum, fact) => sum + fact.statement.length, 0) +
    400;
  const estimate = estimateForTier(tier, Math.max(300, Math.ceil(inputChars / 4)));

  const wallet = (await data.getWallet(params.organizationId)) ?? {
    organizationId: params.organizationId,
    balanceCents: 0,
    reservedCents: 0,
  };
  const existingReservations = await data.listReservations(params.organizationId);
  const reserveResult = reserve(
    { balanceCents: wallet.balanceCents, reservedCents: wallet.reservedCents },
    existingReservations,
    {
      id: randomUUID(),
      idempotencyKey: params.idempotencyKey,
      amountCents: estimate.customerHighCents,
      rateVersion: tier.rate.rateVersion,
    },
  );
  if (!reserveResult.ok) return { ok: false, error: "insufficient_funds" };

  if (reserveResult.deduplicated) {
    // Retry of a distillation that already wrote its proposals: the event
    // log carries the reservation id, so the same key never re-charges or
    // re-proposes (PRD §7.4 semantics).
    const events = await data.listPsEvents(params.organizationId, params.inventionId);
    const prior = events.find(
      (event) =>
        event.kind === "title_proposed" &&
        event.detail.includes(`reservation:${reserveResult.reservation.id}`),
    );
    if (prior) {
      const pairs = await data.listPsPairs(params.organizationId, params.inventionId);
      const links = await data.listPsLinks(params.organizationId, params.inventionId);
      const titles = await data.listWorkingTitles(params.organizationId, params.inventionId);
      return {
        ok: true,
        workingTitleId: titles[titles.length - 1]?.id ?? "",
        problemCount: pairs.filter((pair) => pair.kind === "problem").length,
        solutionCount: pairs.filter((pair) => pair.kind === "solution").length,
        linkCount: links.length,
        deduplicated: true,
      };
    }
  }

  await data.saveWallet({ organizationId: params.organizationId, ...reserveResult.wallet });
  const reservationRecord = {
    ...reserveResult.reservation,
    organizationId: params.organizationId,
    createdAt: new Date().toISOString(),
  };
  await data.saveReservation(reservationRecord);

  let result;
  try {
    result = await modelGateway.distill({
      modelId: tier.modelId,
      invention,
      facts,
      artifacts: artifactInputs,
      componentNames: components.map((component) => component.name),
      maxOutputTokens: tier.maxOutputTokens,
    });
  } catch {
    const released = release(reserveResult.wallet, reserveResult.reservation);
    if (released.ok) {
      await data.saveWallet({ organizationId: params.organizationId, ...released.wallet });
      await data.saveReservation({ ...reservationRecord, status: released.reservation.status });
      await data.appendLedgerEntry({
        organizationId: params.organizationId,
        kind: "release",
        amountCents: 0,
        reservationId: reservationRecord.id,
        note: "Distillation failed; reservation released without charge.",
      });
    }
    return { ok: false, error: "distillation_failed" };
  }

  const settled = settle(
    reserveResult.wallet,
    reserveResult.reservation,
    result.providerCostCents,
  );
  if (!settled.ok) return { ok: false, error: "distillation_failed" };
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
    note: `Distillation settlement (${tier.rate.rateVersion}); provider cost × 1.50.`,
  });
  await data.appendUsageEvent({
    organizationId: params.organizationId,
    reservationId: reservationRecord.id,
    modelId: tier.modelId,
    rateVersion: tier.rate.rateVersion,
    providerCostCents: result.providerCostCents,
    customerChargeCents: settled.customerChargeCents,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  });

  // ---- Write proposals (model actor: ai_proposed ONLY, via the guard) ----
  const modelGuard = applyPsAction("model", "propose", null);
  if (!modelGuard.allowed || modelGuard.nextState !== "ai_proposed") {
    // Structurally unreachable; kept as a hard stop for invariant 13.
    return { ok: false, error: "distillation_failed" };
  }

  const existingPairs = await data.listPsPairs(params.organizationId, params.inventionId);
  const knownStatements = new Set(
    existingPairs.map((pair) => `${pair.kind}:${pair.statement.trim().toLowerCase()}`),
  );

  const title = await data.createWorkingTitle({
    organizationId: params.organizationId,
    inventionId: params.inventionId,
    text: result.output.workingTitle.slice(0, 400),
    state: modelGuard.nextState,
    createdByActor: "model",
  });
  await data.appendPsEvent({
    organizationId: params.organizationId,
    inventionId: params.inventionId,
    pairId: null,
    kind: "title_proposed",
    actor: `model:${tier.modelId}`,
    detail: `reservation:${reservationRecord.id}`,
  });

  const problemIds: Array<Id | null> = [];
  for (const problem of result.output.problems) {
    const statement = problem.statement.trim().slice(0, 4000);
    const key = `problem:${statement.toLowerCase()}`;
    if (!statement || knownStatements.has(key)) {
      const existing = existingPairs.find(
        (pair) => pair.kind === "problem" && pair.statement.trim().toLowerCase() === statement.toLowerCase(),
      );
      problemIds.push(existing?.id ?? null);
      continue;
    }
    knownStatements.add(key);
    const pair = await data.createPsPair({
      organizationId: params.organizationId,
      inventionId: params.inventionId,
      kind: "problem",
      statement,
      state: modelGuard.nextState,
      origin: "upload_distillation",
      createdByActor: "model",
      sourceAnchors: problem.sourceAnchors.slice(0, 10),
    });
    problemIds.push(pair.id);
    await data.appendPsEvent({
      organizationId: params.organizationId,
      inventionId: params.inventionId,
      pairId: pair.id,
      kind: "proposed",
      actor: `model:${tier.modelId}`,
      detail: `reservation:${reservationRecord.id}`,
    });
  }

  const componentByName = new Map(
    (await data.listComponents(params.organizationId, params.inventionId)).map((component) => [
      component.name.toLowerCase(),
      component,
    ]),
  );
  const solutionIds: Array<Id | null> = [];
  for (const solution of result.output.solutions) {
    const statement = solution.statement.trim().slice(0, 4000);
    const key = `solution:${statement.toLowerCase()}`;
    if (!statement || knownStatements.has(key)) {
      const existing = existingPairs.find(
        (pair) => pair.kind === "solution" && pair.statement.trim().toLowerCase() === statement.toLowerCase(),
      );
      solutionIds.push(existing?.id ?? null);
      continue;
    }
    knownStatements.add(key);
    const pair = await data.createPsPair({
      organizationId: params.organizationId,
      inventionId: params.inventionId,
      kind: "solution",
      statement,
      state: modelGuard.nextState,
      origin: "upload_distillation",
      createdByActor: "model",
      sourceAnchors: solution.sourceAnchors.slice(0, 10),
    });
    solutionIds.push(pair.id);
    await data.appendPsEvent({
      organizationId: params.organizationId,
      inventionId: params.inventionId,
      pairId: pair.id,
      kind: "proposed",
      actor: `model:${tier.modelId}`,
      detail: `reservation:${reservationRecord.id}`,
    });
    // Solution ↔ component evidence associations (feature PRD §7).
    for (const componentName of solution.componentNames.slice(0, 20)) {
      const component = componentByName.get(componentName.trim().toLowerCase());
      if (!component) continue;
      await data.createAssociation({
        organizationId: params.organizationId,
        inventionId: params.inventionId,
        solutionId: pair.id,
        componentId: component.id,
        extractionArtifactId: null,
        sourceId: null,
        region: null,
        interviewTurnId: null,
        createdByActor: "model",
        state: modelGuard.nextState,
      });
    }
    // M3 (FR-INT-9): AI-proposed REGION anchors on named sources. Each
    // lands `ai_proposed` and renders as an editable overlay in the source
    // viewer until the user confirms, redraws, or rejects it.
    for (const anchor of (solution.regionAnchors ?? []).slice(0, 10)) {
      const anchorSource = sources.find((candidate) => candidate.name === anchor.sourceName);
      if (!anchorSource) continue;
      const region = normalizeRegion({
        page: anchor.page ?? undefined,
        x: anchor.x,
        y: anchor.y,
        w: anchor.w,
        h: anchor.h,
      });
      if (!region) continue;
      await data.createAssociation({
        organizationId: params.organizationId,
        inventionId: params.inventionId,
        solutionId: pair.id,
        componentId: null,
        extractionArtifactId: null,
        sourceId: anchorSource.id,
        region,
        interviewTurnId: null,
        createdByActor: "model",
        state: modelGuard.nextState,
      });
    }
  }

  const existingLinks = await data.listPsLinks(params.organizationId, params.inventionId);
  const linkKeys = new Set(existingLinks.map((link) => `${link.problemId}:${link.solutionId}`));
  let linkCount = existingLinks.length;
  for (const pairing of result.output.pairings) {
    const problemId = problemIds[pairing.problemIndex] ?? null;
    const solutionId = solutionIds[pairing.solutionIndex] ?? null;
    if (!problemId || !solutionId) continue;
    if (linkKeys.has(`${problemId}:${solutionId}`)) continue;
    linkKeys.add(`${problemId}:${solutionId}`);
    await data.createPsLink({
      organizationId: params.organizationId,
      inventionId: params.inventionId,
      problemId,
      solutionId,
      state: modelGuard.nextState,
    });
    linkCount += 1;
  }

  // Observations are recorded as proposal events — never advice, never a
  // state change (feature PRD §5.3 step 4).
  for (const observation of result.output.observations.slice(0, 5)) {
    await data.appendPsEvent({
      organizationId: params.organizationId,
      inventionId: params.inventionId,
      pairId: null,
      kind: "proposed",
      actor: `model:${tier.modelId}`,
      detail: `observation: ${observation.slice(0, 500)}`,
    });
  }

  await data.appendAuditEvent({
    organizationId: params.organizationId,
    actor: params.userId,
    action: "studio.distilled",
    target: params.inventionId,
    meta: {
      modelId: tier.modelId,
      reservationId: reservationRecord.id,
      problems: problemIds.filter(Boolean).length,
      solutions: solutionIds.filter(Boolean).length,
    },
  });

  // Deterministic coverage recompute (never model output — FR-INT-8).
  await recomputeCoverage(params.organizationId, params.inventionId);

  const pairs = await data.listPsPairs(params.organizationId, params.inventionId);
  return {
    ok: true,
    workingTitleId: title.id,
    problemCount: pairs.filter((pair) => pair.kind === "problem").length,
    solutionCount: pairs.filter((pair) => pair.kind === "solution").length,
    linkCount,
    deduplicated: false,
  };
}
