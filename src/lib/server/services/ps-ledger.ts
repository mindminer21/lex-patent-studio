import "server-only";

import {
  applyPsAction,
  deletionEventKind,
  type PsPairKind,
} from "@/lib/wepatent/domain/ps-ledger";
import {
  aggregateCoverage,
  computeSolutionCoverage,
  COVERAGE_MODEL_VERSION,
  type SolutionCoverage,
} from "@/lib/wepatent/domain/coverage";
import { getAdapters } from "../adapters";
import type {
  AssociationRecord,
  ComponentRecord,
  EnablementCoverageRecord,
  Id,
  PsLinkRecord,
  PsPairRecord,
  WorkingTitleRecord,
} from "../adapters/types";

/**
 * Problem/Solution ledger service (Intake Studio FR-INT-5).
 *
 * ALL user-lane mutations flow through here and through the domain guard
 * (`applyPsAction` with actor "user"). The model actor has no path into
 * this module — AI proposals are written only by the distillation service,
 * which can only create `ai_proposed` rows. AI can never set a confirmed
 * state (invariant 13).
 */

export type PsMutationResult =
  | { ok: true; pair: PsPairRecord | null }
  | { ok: false; error: "not_found" | "forbidden_transition" | "invalid_input" };

export async function addManualPair(params: {
  organizationId: Id;
  userId: Id;
  inventionId: Id;
  kind: PsPairKind;
  statement: string;
}): Promise<PsMutationResult> {
  const statement = params.statement.trim();
  if (statement.length < 3 || statement.length > 4000) {
    return { ok: false, error: "invalid_input" };
  }
  const { data } = getAdapters();
  const invention = await data.getInvention(params.organizationId, params.inventionId);
  if (!invention) return { ok: false, error: "not_found" };

  const guard = applyPsAction("user", "propose", null);
  if (!guard.allowed || !guard.nextState) return { ok: false, error: "forbidden_transition" };

  const pair = await data.createPsPair({
    organizationId: params.organizationId,
    inventionId: params.inventionId,
    kind: params.kind,
    statement,
    state: guard.nextState,
    origin: "manual",
    createdByActor: "user",
    sourceAnchors: [],
  });
  await data.appendPsEvent({
    organizationId: params.organizationId,
    inventionId: params.inventionId,
    pairId: pair.id,
    kind: "proposed",
    actor: `user:${params.userId}`,
    detail: `manual ${params.kind} added`,
  });
  await recomputeCoverage(params.organizationId, params.inventionId);
  return { ok: true, pair };
}

export async function confirmPair(params: {
  organizationId: Id;
  userId: Id;
  pairId: Id;
}): Promise<PsMutationResult> {
  const { data } = getAdapters();
  const pair = await data.getPsPair(params.organizationId, params.pairId);
  if (!pair) return { ok: false, error: "not_found" };
  const guard = applyPsAction("user", "confirm", pair.state);
  if (!guard.allowed || !guard.nextState) return { ok: false, error: "forbidden_transition" };
  const updated = await data.updatePsPair(params.organizationId, params.pairId, {
    state: guard.nextState,
  });
  await data.appendPsEvent({
    organizationId: params.organizationId,
    inventionId: pair.inventionId,
    pairId: pair.id,
    kind: "confirmed",
    actor: `user:${params.userId}`,
    detail: "",
  });
  await recomputeCoverage(params.organizationId, pair.inventionId);
  return { ok: true, pair: updated };
}

export async function editPair(params: {
  organizationId: Id;
  userId: Id;
  pairId: Id;
  statement: string;
}): Promise<PsMutationResult> {
  const statement = params.statement.trim();
  if (statement.length < 3 || statement.length > 4000) {
    return { ok: false, error: "invalid_input" };
  }
  const { data } = getAdapters();
  const pair = await data.getPsPair(params.organizationId, params.pairId);
  if (!pair) return { ok: false, error: "not_found" };
  const guard = applyPsAction("user", "edit", pair.state);
  if (!guard.allowed || !guard.nextState) return { ok: false, error: "forbidden_transition" };
  const updated = await data.updatePsPair(params.organizationId, params.pairId, {
    statement,
    state: guard.nextState,
  });
  await data.appendPsEvent({
    organizationId: params.organizationId,
    inventionId: pair.inventionId,
    pairId: pair.id,
    kind: "edited",
    actor: `user:${params.userId}`,
    detail: "",
  });
  await recomputeCoverage(params.organizationId, pair.inventionId);
  return { ok: true, pair: updated };
}

export async function deletePair(params: {
  organizationId: Id;
  userId: Id;
  pairId: Id;
}): Promise<PsMutationResult> {
  const { data } = getAdapters();
  const pair = await data.getPsPair(params.organizationId, params.pairId);
  if (!pair) return { ok: false, error: "not_found" };
  const guard = applyPsAction("user", "delete", pair.state);
  if (!guard.allowed) return { ok: false, error: "forbidden_transition" };
  // Rejecting an AI proposal is a recorded signal (feature PRD §5.4).
  const eventKind = deletionEventKind(pair.state);
  await data.deletePsPair(params.organizationId, params.pairId);
  await data.appendPsEvent({
    organizationId: params.organizationId,
    inventionId: pair.inventionId,
    pairId: null,
    kind: eventKind,
    actor: `user:${params.userId}`,
    detail: `${pair.kind}: ${pair.statement.slice(0, 200)}`,
  });
  await recomputeCoverage(params.organizationId, pair.inventionId);
  return { ok: true, pair: null };
}

export async function linkPairs(params: {
  organizationId: Id;
  userId: Id;
  problemId: Id;
  solutionId: Id;
}): Promise<{ ok: true; link: PsLinkRecord } | { ok: false; error: "not_found" | "invalid_input" }> {
  const { data } = getAdapters();
  const problem = await data.getPsPair(params.organizationId, params.problemId);
  const solution = await data.getPsPair(params.organizationId, params.solutionId);
  if (!problem || !solution) return { ok: false, error: "not_found" };
  if (
    problem.kind !== "problem" ||
    solution.kind !== "solution" ||
    problem.inventionId !== solution.inventionId
  ) {
    return { ok: false, error: "invalid_input" };
  }
  const existing = await data.listPsLinks(params.organizationId, problem.inventionId);
  const duplicate = existing.find(
    (link) => link.problemId === problem.id && link.solutionId === solution.id,
  );
  if (duplicate) return { ok: true, link: duplicate };
  const link = await data.createPsLink({
    organizationId: params.organizationId,
    inventionId: problem.inventionId,
    problemId: problem.id,
    solutionId: solution.id,
    state: "user_confirmed",
  });
  await data.appendPsEvent({
    organizationId: params.organizationId,
    inventionId: problem.inventionId,
    pairId: solution.id,
    kind: "linked",
    actor: `user:${params.userId}`,
    detail: `problem:${problem.id}`,
  });
  await recomputeCoverage(params.organizationId, problem.inventionId);
  return { ok: true, link };
}

/** User working-title change: appended to the proposal history. */
export async function setWorkingTitle(params: {
  organizationId: Id;
  userId: Id;
  inventionId: Id;
  text: string;
}): Promise<{ ok: true; title: WorkingTitleRecord } | { ok: false; error: "not_found" | "invalid_input" }> {
  const text = params.text.trim();
  if (text.length < 3 || text.length > 400) return { ok: false, error: "invalid_input" };
  const { data } = getAdapters();
  const invention = await data.getInvention(params.organizationId, params.inventionId);
  if (!invention) return { ok: false, error: "not_found" };
  const title = await data.createWorkingTitle({
    organizationId: params.organizationId,
    inventionId: params.inventionId,
    text,
    state: "user_edited",
    createdByActor: "user",
  });
  await data.appendPsEvent({
    organizationId: params.organizationId,
    inventionId: params.inventionId,
    pairId: null,
    kind: "title_edited",
    actor: `user:${params.userId}`,
    detail: text.slice(0, 200),
  });
  return { ok: true, title };
}

/* ------------------------- ledger read model ---------------------------- */

export type LedgerView = {
  pairs: PsPairRecord[];
  links: PsLinkRecord[];
  components: ComponentRecord[];
  associations: AssociationRecord[];
  currentTitle: WorkingTitleRecord | null;
  coverage: {
    perSolution: SolutionCoverage[];
    aggregate: { satisfied: number; total: number; percent: number };
    version: string;
  };
};

export async function getLedger(organizationId: Id, inventionId: Id): Promise<LedgerView> {
  const { data } = getAdapters();
  const [pairs, links, components, associations, titles] = await Promise.all([
    data.listPsPairs(organizationId, inventionId),
    data.listPsLinks(organizationId, inventionId),
    data.listComponents(organizationId, inventionId),
    data.listAssociations(organizationId, inventionId),
    data.listWorkingTitles(organizationId, inventionId),
  ]);
  const perSolution = await computeCoverageView(organizationId, inventionId, {
    pairs,
    links,
    components,
    associations,
  });
  return {
    pairs,
    links,
    components,
    associations,
    currentTitle: titles.length > 0 ? titles[titles.length - 1] : null,
    coverage: {
      perSolution,
      aggregate: aggregateCoverage(perSolution),
      version: COVERAGE_MODEL_VERSION,
    },
  };
}

/* --------------------- deterministic coverage (FR-INT-8) ---------------- */

async function computeCoverageView(
  organizationId: Id,
  inventionId: Id,
  preloaded?: {
    pairs: PsPairRecord[];
    links: PsLinkRecord[];
    components: ComponentRecord[];
    associations: AssociationRecord[];
  },
): Promise<SolutionCoverage[]> {
  const { data } = getAdapters();
  const pairs = preloaded?.pairs ?? (await data.listPsPairs(organizationId, inventionId));
  const links = preloaded?.links ?? (await data.listPsLinks(organizationId, inventionId));
  const components =
    preloaded?.components ?? (await data.listComponents(organizationId, inventionId));
  const associations =
    preloaded?.associations ?? (await data.listAssociations(organizationId, inventionId));
  const facts = await data.listFacts(organizationId, inventionId);
  const invention = await data.getInvention(organizationId, inventionId);

  const componentById = new Map(components.map((component) => [component.id, component]));
  const solutions = pairs.filter((pair) => pair.kind === "solution");
  return solutions.map((solution) =>
    computeSolutionCoverage({
      solution: { id: solution.id, statement: solution.statement },
      linkedProblemIds: links
        .filter((link) => link.solutionId === solution.id)
        .map((link) => link.problemId),
      associatedComponentNames: associations
        .filter((association) => association.solutionId === solution.id)
        .map((association) =>
          association.componentId
            ? (componentById.get(association.componentId)?.name ?? "")
            : "",
        )
        .filter((name) => name.length > 0),
      facts: facts.map((fact) => ({ category: fact.category, statement: fact.statement })),
      businessContext: invention?.businessContext ?? "",
    }),
  );
}

/**
 * Recompute + persist the deterministic coverage snapshot. Called after
 * every ledger mutation and after distillation; history is append-only.
 */
export async function recomputeCoverage(
  organizationId: Id,
  inventionId: Id,
): Promise<EnablementCoverageRecord[]> {
  const { data } = getAdapters();
  const perSolution = await computeCoverageView(organizationId, inventionId);
  const rows = perSolution.flatMap((coverage) =>
    (Object.keys(coverage.dimensions) as Array<keyof typeof coverage.dimensions>).map(
      (dimension) => ({
        organizationId,
        inventionId,
        solutionId: coverage.solutionId,
        dimension,
        status: coverage.dimensions[dimension].status,
        evidence: coverage.dimensions[dimension].evidence,
        coverageVersion: COVERAGE_MODEL_VERSION,
      }),
    ),
  );
  return data.appendEnablementCoverage(rows);
}
