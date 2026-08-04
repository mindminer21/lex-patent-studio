import "server-only";

import {
  applyPsAction,
  deletionEventKind,
  type PsPairKind,
} from "@/lib/wepatent/domain/ps-ledger";
import { formatRegionAnchor, normalizeRegion } from "@/lib/wepatent/domain/evidence";
import { interpretationClassFor } from "@/lib/wepatent/domain/uploads";
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

/**
 * User working-title change: appended to the proposal history. Saving a
 * working title is the user's confirmation of it, so the invention record
 * title updates to match — a record created with the neutral placeholder
 * picks up the real title the moment the user confirms one. The record
 * title column allows 3–200 characters, so longer working titles are
 * truncated on the record only (the full text stays in the ledger).
 */
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
  await data.updateInventionTitle(params.organizationId, params.inventionId, text.slice(0, 200));
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

/* ------------------- M3: visual evidence associations ------------------- */

export type AssociationMutationResult =
  | { ok: true; association: AssociationRecord | null }
  | { ok: false; error: "not_found" | "forbidden_transition" | "invalid_input" };

/**
 * User-drawn region anchor (FR-INT-9): links a solution to a rectangle on
 * a source. A human drew it, so it starts `user_confirmed` via the guard.
 */
export async function addRegionAssociation(params: {
  organizationId: Id;
  userId: Id;
  solutionId: Id;
  sourceId: Id;
  region: unknown;
}): Promise<AssociationMutationResult> {
  const region = normalizeRegion(params.region);
  if (!region) return { ok: false, error: "invalid_input" };
  const { data } = getAdapters();
  const solution = await data.getPsPair(params.organizationId, params.solutionId);
  if (!solution || solution.kind !== "solution") return { ok: false, error: "not_found" };
  const source = await data.getSource(params.organizationId, params.sourceId);
  if (!source || source.inventionId !== solution.inventionId) {
    return { ok: false, error: "not_found" };
  }
  const guard = applyPsAction("user", "propose", null);
  if (!guard.allowed || !guard.nextState) return { ok: false, error: "forbidden_transition" };
  const association = await data.createAssociation({
    organizationId: params.organizationId,
    inventionId: solution.inventionId,
    solutionId: solution.id,
    componentId: null,
    extractionArtifactId: null,
    sourceId: source.id,
    region,
    interviewTurnId: null,
    createdByActor: "user",
    state: guard.nextState,
  });
  await data.appendPsEvent({
    organizationId: params.organizationId,
    inventionId: solution.inventionId,
    pairId: solution.id,
    kind: "linked",
    actor: `user:${params.userId}`,
    detail: `region anchor drawn on source:${source.name} (${formatRegionAnchor(source.name, region)})`,
  });
  await recomputeCoverage(params.organizationId, solution.inventionId);
  return { ok: true, association };
}

/** Redraw/adjust an anchor's region — a user edit through the guard. */
export async function updateAssociationRegion(params: {
  organizationId: Id;
  userId: Id;
  associationId: Id;
  region: unknown;
}): Promise<AssociationMutationResult> {
  const region = normalizeRegion(params.region);
  if (!region) return { ok: false, error: "invalid_input" };
  const { data } = getAdapters();
  const association = await data.getAssociation(params.organizationId, params.associationId);
  if (!association) return { ok: false, error: "not_found" };
  if (!association.sourceId) return { ok: false, error: "invalid_input" };
  const guard = applyPsAction("user", "edit", association.state);
  if (!guard.allowed || !guard.nextState) return { ok: false, error: "forbidden_transition" };
  const updated = await data.updateAssociation(params.organizationId, params.associationId, {
    region,
    state: guard.nextState,
  });
  await data.appendPsEvent({
    organizationId: params.organizationId,
    inventionId: association.inventionId,
    pairId: association.solutionId,
    kind: "edited",
    actor: `user:${params.userId}`,
    detail: `region anchor adjusted (association:${association.id})`,
  });
  return { ok: true, association: updated };
}

/** Confirm an AI-proposed anchor (the ONLY path out of ai_proposed). */
export async function confirmAssociation(params: {
  organizationId: Id;
  userId: Id;
  associationId: Id;
}): Promise<AssociationMutationResult> {
  const { data } = getAdapters();
  const association = await data.getAssociation(params.organizationId, params.associationId);
  if (!association) return { ok: false, error: "not_found" };
  const guard = applyPsAction("user", "confirm", association.state);
  if (!guard.allowed || !guard.nextState) return { ok: false, error: "forbidden_transition" };
  const updated = await data.updateAssociation(params.organizationId, params.associationId, {
    state: guard.nextState,
  });
  await data.appendPsEvent({
    organizationId: params.organizationId,
    inventionId: association.inventionId,
    pairId: association.solutionId,
    kind: "confirmed",
    actor: `user:${params.userId}`,
    detail: `association:${association.id}`,
  });
  return { ok: true, association: updated };
}

/** Delete an anchor; rejecting an AI proposal records the rejection signal. */
export async function deleteAssociation(params: {
  organizationId: Id;
  userId: Id;
  associationId: Id;
}): Promise<AssociationMutationResult> {
  const { data } = getAdapters();
  const association = await data.getAssociation(params.organizationId, params.associationId);
  if (!association) return { ok: false, error: "not_found" };
  const guard = applyPsAction("user", "delete", association.state);
  if (!guard.allowed) return { ok: false, error: "forbidden_transition" };
  await data.deleteAssociation(params.organizationId, params.associationId);
  await data.appendPsEvent({
    organizationId: params.organizationId,
    inventionId: association.inventionId,
    pairId: association.solutionId,
    kind: deletionEventKind(association.state),
    actor: `user:${params.userId}`,
    detail: `association removed (association:${association.id})`,
  });
  await recomputeCoverage(params.organizationId, association.inventionId);
  return { ok: true, association: null };
}

/* -------------------- M3: merge / split (feature PRD §5.4) --------------- */

/**
 * Merge two same-kind pairs: the primary keeps its identity, absorbs the
 * secondary's statement + anchors, and inherits its links/associations;
 * the secondary is deleted. A human judgment call → `user_edited`.
 */
export async function mergePairs(params: {
  organizationId: Id;
  userId: Id;
  primaryId: Id;
  secondaryId: Id;
}): Promise<PsMutationResult> {
  if (params.primaryId === params.secondaryId) return { ok: false, error: "invalid_input" };
  const { data } = getAdapters();
  const primary = await data.getPsPair(params.organizationId, params.primaryId);
  const secondary = await data.getPsPair(params.organizationId, params.secondaryId);
  if (!primary || !secondary) return { ok: false, error: "not_found" };
  if (primary.kind !== secondary.kind || primary.inventionId !== secondary.inventionId) {
    return { ok: false, error: "invalid_input" };
  }
  const guard = applyPsAction("user", "edit", primary.state);
  if (!guard.allowed || !guard.nextState) return { ok: false, error: "forbidden_transition" };

  const mergedStatement = `${primary.statement.trim()} ${secondary.statement.trim()}`.slice(0, 4000);
  const mergedAnchors = [
    ...new Set([...primary.sourceAnchors, ...secondary.sourceAnchors]),
  ].slice(0, 20);
  const updated = await data.updatePsPair(params.organizationId, params.primaryId, {
    statement: mergedStatement,
    state: guard.nextState,
    sourceAnchors: mergedAnchors,
  });

  // Re-home the secondary's links and (for solutions) evidence associations
  // BEFORE the delete cascades them away.
  const links = await data.listPsLinks(params.organizationId, primary.inventionId);
  const linkKeys = new Set(links.map((link) => `${link.problemId}:${link.solutionId}`));
  for (const link of links) {
    const problemId = link.problemId === secondary.id ? primary.id : link.problemId;
    const solutionId = link.solutionId === secondary.id ? primary.id : link.solutionId;
    if (problemId === link.problemId && solutionId === link.solutionId) continue;
    if (problemId === solutionId) continue;
    if (linkKeys.has(`${problemId}:${solutionId}`)) continue;
    linkKeys.add(`${problemId}:${solutionId}`);
    await data.createPsLink({
      organizationId: params.organizationId,
      inventionId: primary.inventionId,
      problemId,
      solutionId,
      state: link.state,
    });
  }
  if (primary.kind === "solution") {
    const associations = await data.listAssociations(params.organizationId, primary.inventionId);
    for (const association of associations) {
      if (association.solutionId !== secondary.id) continue;
      await data.createAssociation({
        organizationId: params.organizationId,
        inventionId: primary.inventionId,
        solutionId: primary.id,
        componentId: association.componentId,
        extractionArtifactId: association.extractionArtifactId,
        sourceId: association.sourceId,
        region: association.region,
        interviewTurnId: association.interviewTurnId,
        createdByActor: association.createdByActor,
        state: association.state,
      });
    }
  }

  await data.deletePsPair(params.organizationId, secondary.id);
  await data.appendPsEvent({
    organizationId: params.organizationId,
    inventionId: primary.inventionId,
    pairId: primary.id,
    kind: "merged",
    actor: `user:${params.userId}`,
    detail: `absorbed ${secondary.kind}: ${secondary.statement.slice(0, 200)}`,
  });
  await recomputeCoverage(params.organizationId, primary.inventionId);
  return { ok: true, pair: updated };
}

/**
 * Split one pair into several statements: the original keeps the first
 * statement (with its links/associations); each additional statement
 * becomes a sibling pair carrying the same source anchors.
 */
export async function splitPair(params: {
  organizationId: Id;
  userId: Id;
  pairId: Id;
  statements: string[];
}): Promise<PsMutationResult> {
  const statements = params.statements
    .map((statement) => statement.trim())
    .filter((statement) => statement.length >= 3 && statement.length <= 4000);
  if (statements.length < 2 || statements.length > 5) {
    return { ok: false, error: "invalid_input" };
  }
  const { data } = getAdapters();
  const pair = await data.getPsPair(params.organizationId, params.pairId);
  if (!pair) return { ok: false, error: "not_found" };
  const guard = applyPsAction("user", "edit", pair.state);
  if (!guard.allowed || !guard.nextState) return { ok: false, error: "forbidden_transition" };

  const updated = await data.updatePsPair(params.organizationId, params.pairId, {
    statement: statements[0],
    state: guard.nextState,
  });
  for (const statement of statements.slice(1)) {
    const sibling = await data.createPsPair({
      organizationId: params.organizationId,
      inventionId: pair.inventionId,
      kind: pair.kind,
      statement,
      state: "user_edited",
      origin: "manual",
      createdByActor: "user",
      sourceAnchors: pair.sourceAnchors,
    });
    await data.appendPsEvent({
      organizationId: params.organizationId,
      inventionId: pair.inventionId,
      pairId: sibling.id,
      kind: "split",
      actor: `user:${params.userId}`,
      detail: `split from ${pair.kind}:${pair.id}`,
    });
  }
  await data.appendPsEvent({
    organizationId: params.organizationId,
    inventionId: pair.inventionId,
    pairId: pair.id,
    kind: "split",
    actor: `user:${params.userId}`,
    detail: `split into ${statements.length} statements`,
  });
  await recomputeCoverage(params.organizationId, pair.inventionId);
  return { ok: true, pair: updated };
}

/* --------------- M3: re-distillation diff review (bulk acts) ------------- */

/**
 * Bulk-review the current AI proposals (re-distillation diff review):
 * confirm-all or reject-all across `ai_proposed` pairs. Each item still
 * flows through the same per-item guard + event trail as a single action;
 * confirmed/edited items are untouchable by construction.
 */
export async function bulkReviewProposals(params: {
  organizationId: Id;
  userId: Id;
  inventionId: Id;
  action: "confirm" | "reject";
}): Promise<{ ok: true; affected: number } | { ok: false; error: "not_found" }> {
  const { data } = getAdapters();
  const invention = await data.getInvention(params.organizationId, params.inventionId);
  if (!invention) return { ok: false, error: "not_found" };
  const pairs = await data.listPsPairs(params.organizationId, params.inventionId);
  let affected = 0;
  for (const pair of pairs) {
    if (pair.state !== "ai_proposed") continue;
    const result =
      params.action === "confirm"
        ? await confirmPair({
            organizationId: params.organizationId,
            userId: params.userId,
            pairId: pair.id,
          })
        : await deletePair({
            organizationId: params.organizationId,
            userId: params.userId,
            pairId: pair.id,
          });
    if (result.ok) affected += 1;
  }
  return { ok: true, affected };
}

/* ------------------- M3: solution evidence gallery view ------------------ */

export type EvidenceItem =
  | {
      kind: "component";
      associationId: Id;
      state: PsPairRecord["state"];
      componentName: string;
      componentDescription: string;
    }
  | {
      kind: "region";
      associationId: Id;
      state: PsPairRecord["state"];
      sourceId: Id;
      sourceName: string;
      sourceMimeType: string | null;
      sourceClass: string;
      region: NonNullable<AssociationRecord["region"]>;
      locator: string;
    }
  | {
      kind: "text_snippet";
      anchor: string;
      sourceId: Id | null;
      sourceName: string;
      excerpt: string;
      artifactType: string;
    }
  | {
      kind: "geometry";
      sourceId: Id;
      sourceName: string;
      summary: string;
    }
  | {
      kind: "interview_turn";
      turnId: Id;
      question: string;
      answerExcerpt: string;
    };

export type SolutionEvidenceView = {
  solution: PsPairRecord;
  items: EvidenceItem[];
};

/**
 * Full evidence set for one solution (feature PRD §7): components, region
 * crops, quoted text snippets with anchors, 3D geometry summaries, and
 * interview-turn excerpts — each with enough source metadata for the
 * gallery to open the source viewer at the anchor.
 */
export async function getSolutionEvidence(
  organizationId: Id,
  solutionId: Id,
): Promise<SolutionEvidenceView | null> {
  const { data } = getAdapters();
  const solution = await data.getPsPair(organizationId, solutionId);
  if (!solution || solution.kind !== "solution") return null;
  const [associations, components, sources, artifacts] = await Promise.all([
    data.listAssociations(organizationId, solution.inventionId),
    data.listComponents(organizationId, solution.inventionId),
    data.listSources(organizationId, solution.inventionId),
    data.listExtractionArtifacts(organizationId, solution.inventionId),
  ]);
  const componentById = new Map(components.map((component) => [component.id, component]));
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const sourceByName = new Map(sources.map((source) => [source.name, source]));
  const items: EvidenceItem[] = [];

  for (const association of associations) {
    if (association.solutionId !== solution.id) continue;
    if (association.componentId) {
      const component = componentById.get(association.componentId);
      if (component) {
        items.push({
          kind: "component",
          associationId: association.id,
          state: association.state,
          componentName: component.name,
          componentDescription: component.description,
        });
      }
    }
    if (association.sourceId && association.region) {
      const source = sourceById.get(association.sourceId);
      if (source) {
        items.push({
          kind: "region",
          associationId: association.id,
          state: association.state,
          sourceId: source.id,
          sourceName: source.name,
          sourceMimeType: source.mimeType,
          sourceClass: interpretationClassFor(
            source.mimeType,
            source.originalFilename ?? source.name,
          ),
          region: association.region,
          locator: formatRegionAnchor(source.name, association.region),
        });
      }
    }
    if (association.interviewTurnId) {
      const turn = await data.getInterviewTurn(organizationId, association.interviewTurnId);
      if (turn) {
        items.push({
          kind: "interview_turn",
          turnId: turn.id,
          question: turn.question.slice(0, 300),
          answerExcerpt: (turn.answerText ?? "").slice(0, 300),
        });
      }
    }
  }

  // Anchor-derived evidence from the solution's own sourceAnchors:
  // quoted text snippets, geometry summaries, and interview-turn excerpts.
  for (const anchor of solution.sourceAnchors) {
    if (anchor.startsWith("source:")) {
      const sourceName = anchor.slice("source:".length);
      const source = sourceByName.get(sourceName) ?? null;
      const artifact = artifacts.find(
        (candidate) =>
          (source ? candidate.sourceId === source.id : false) &&
          (candidate.type === "interpretation_summary" || candidate.type === "transcript"),
      );
      const geometry = source
        ? artifacts.find(
            (candidate) =>
              candidate.sourceId === source.id && candidate.type === "geometry_summary",
          )
        : undefined;
      if (geometry && source) {
        items.push({
          kind: "geometry",
          sourceId: source.id,
          sourceName,
          summary: geometry.content.slice(0, 600),
        });
      }
      items.push({
        kind: "text_snippet",
        anchor,
        sourceId: source?.id ?? null,
        sourceName,
        excerpt: (artifact?.content ?? "No interpreted excerpt available for this source.").slice(
          0,
          400,
        ),
        artifactType: artifact?.type ?? "none",
      });
    }
    if (anchor.startsWith("turn:")) {
      const turn = await data.getInterviewTurn(organizationId, anchor.slice("turn:".length));
      if (turn) {
        items.push({
          kind: "interview_turn",
          turnId: turn.id,
          question: turn.question.slice(0, 300),
          answerExcerpt: (turn.answerText ?? "").slice(0, 300),
        });
      }
    }
  }

  return { solution, items };
}
