import "server-only";

import {
  canSubmit,
  componentsSchema,
  contributorsSchema,
  identitySchema,
  ownershipSchema,
  problemSolutionSchema,
  sourcesSchema,
  timelineSchema,
  type IntakeState,
} from "@/lib/wepatent/domain/intake";
import {
  factInputSchema,
  transitionFact,
  type FactActor,
  type FactProvenance,
} from "@/lib/wepatent/domain/facts";
import { getAdapters } from "../adapters";
import type { Id, InventionFactRecord, InventionRecord } from "../adapters/types";

export type SubmitIntakeResult =
  | { ok: true; invention: InventionRecord }
  | { ok: false; error: "incomplete_intake" | "invalid_stage_data" };

/**
 * Converts a completed intake session into the canonical invention record
 * (PRD §7.3 stage 8). Facts enter as `user_asserted`; ownership answers of
 * "no"/"unsure" become unresolved facts — never legal conclusions.
 */
export async function submitIntake(params: {
  organizationId: Id;
  userId: Id;
  intake: IntakeState;
}): Promise<SubmitIntakeResult> {
  if (!canSubmit(params.intake)) return { ok: false, error: "incomplete_intake" };

  const identity = identitySchema.safeParse(params.intake.stageData.identity);
  const problemSolution = problemSolutionSchema.safeParse(
    params.intake.stageData.problem_solution,
  );
  const components = componentsSchema.safeParse(params.intake.stageData.components);
  const contributors = contributorsSchema.safeParse(params.intake.stageData.contributors);
  const timeline = timelineSchema.safeParse(params.intake.stageData.timeline);
  const ownership = ownershipSchema.safeParse(params.intake.stageData.ownership);
  const sources = sourcesSchema.safeParse(params.intake.stageData.sources);

  if (
    !identity.success ||
    !problemSolution.success ||
    !components.success ||
    !contributors.success ||
    !timeline.success ||
    !ownership.success ||
    !sources.success
  ) {
    return { ok: false, error: "invalid_stage_data" };
  }

  const { data } = getAdapters();
  const invention = await data.createInvention({
    organizationId: params.organizationId,
    title: identity.data.title,
    summary: identity.data.summary,
    businessContext: identity.data.businessContext ?? "",
    problem: problemSolution.data.problem,
    solution: problemSolution.data.solution,
    synthetic: false,
  });

  for (const component of components.data.components) {
    await data.createFact({
      organizationId: params.organizationId,
      inventionId: invention.id,
      category: "technical",
      statement: component.description
        ? `Component: ${component.name} — ${component.description}`
        : `Component: ${component.name}`,
      provenance: "user_asserted",
      createdBy: "user",
    });
  }
  for (const step of components.data.steps ?? []) {
    await data.createFact({
      organizationId: params.organizationId,
      inventionId: invention.id,
      category: "technical",
      statement: `Method step: ${step}`,
      provenance: "user_asserted",
      createdBy: "user",
    });
  }
  if (components.data.advantages) {
    await data.createFact({
      organizationId: params.organizationId,
      inventionId: invention.id,
      category: "technical",
      statement: `Asserted advantages: ${components.data.advantages}`,
      provenance: "user_asserted",
      createdBy: "user",
    });
  }
  if (components.data.alternatives) {
    await data.createFact({
      organizationId: params.organizationId,
      inventionId: invention.id,
      category: "technical",
      statement: `Alternatives considered: ${components.data.alternatives}`,
      provenance: "user_asserted",
      createdBy: "user",
    });
  }

  for (const contributor of contributors.data.contributors) {
    await data.createContributor({
      organizationId: params.organizationId,
      inventionId: invention.id,
      name: contributor.name,
      email: contributor.email ?? null,
      contribution: contributor.contribution,
    });
    await data.createFact({
      organizationId: params.organizationId,
      inventionId: invention.id,
      category: "contributor",
      statement: `${contributor.name} contributed: ${contributor.contribution}`,
      provenance: "user_asserted",
      createdBy: "user",
    });
  }

  for (const event of timeline.data.events) {
    await data.createDisclosureEvent({
      organizationId: params.organizationId,
      inventionId: invention.id,
      date: event.date,
      kind: event.kind,
      description: event.description,
      underNda: event.underNda ?? false,
    });
    await data.createFact({
      organizationId: params.organizationId,
      inventionId: invention.id,
      category: "timeline",
      statement: `${event.date} (${event.kind}): ${event.description}`,
      provenance: "user_asserted",
      createdBy: "user",
    });
  }

  // Ownership answers are collected as facts with unresolved status when the
  // user is unsure — the software never concludes ownership (PRD §7.3).
  const ownershipUnresolved =
    ownership.data.employmentAgreementsExist === "unsure" ||
    ownership.data.assignmentsExecuted === "unsure" ||
    ownership.data.assignmentsExecuted === "no";
  await data.createFact({
    organizationId: params.organizationId,
    inventionId: invention.id,
    category: "ownership",
    statement: `User reports: employment/IP agreements exist = ${ownership.data.employmentAgreementsExist}; assignments executed = ${ownership.data.assignmentsExecuted}.${ownership.data.thirdPartyObligations ? ` Third-party obligations noted: ${ownership.data.thirdPartyObligations}` : ""}`,
    provenance: ownershipUnresolved ? "needs_confirmation" : "user_asserted",
    createdBy: "user",
  });
  if (ownership.data.openQuestions) {
    await data.createFact({
      organizationId: params.organizationId,
      inventionId: invention.id,
      category: "ownership",
      statement: `Open ownership questions recorded by user: ${ownership.data.openQuestions}`,
      provenance: "needs_confirmation",
      createdBy: "user",
    });
  }

  for (const source of sources.data.sources) {
    await data.createSource({
      organizationId: params.organizationId,
      inventionId: invention.id,
      name: source.name,
      kind: source.kind,
      note: source.note ?? "",
      status: "registered",
      synthetic: false,
      originalFilename: null,
      mimeType: null,
      byteSize: null,
      storagePath: null,
      checksumSha256: null,
      quarantineReason: null,
      interpretationStatus: null,
      derivedFromSourceId: null,
    });
  }

  await data.appendAuditEvent({
    organizationId: params.organizationId,
    actor: params.userId,
    action: "invention.created_from_intake",
    target: invention.id,
    meta: {},
  });

  return { ok: true, invention };
}

export type FactUpdateResult =
  | { ok: true; fact: InventionFactRecord }
  | { ok: false; error: "not_found" | "actor_not_allowed" | "no_change" };

/**
 * Applies a provenance transition through the domain guard. Model actors are
 * rejected by the guard itself — there is deliberately no code path that
 * lets model output reach this function.
 */
export async function updateFactProvenance(params: {
  organizationId: Id;
  factId: Id;
  actor: FactActor;
  to: FactProvenance;
  actorUserId: Id;
}): Promise<FactUpdateResult> {
  const { data } = getAdapters();
  const target = await findFact(params.organizationId, params.factId);
  if (!target) return { ok: false, error: "not_found" };

  const result = transitionFact(params.actor, target.provenance, params.to);
  if (!result.ok) return { ok: false, error: result.error };

  const updated = await data.updateFactProvenance(
    params.organizationId,
    params.factId,
    result.next,
  );
  if (!updated) return { ok: false, error: "not_found" };

  await data.appendAuditEvent({
    organizationId: params.organizationId,
    actor: params.actorUserId,
    action: "fact.provenance_changed",
    target: params.factId,
    meta: { from: target.provenance, to: result.next, actorKind: params.actor },
  });

  return { ok: true, fact: updated };
}

async function findFact(
  organizationId: Id,
  factId: Id,
): Promise<InventionFactRecord | null> {
  const { data } = getAdapters();
  const inventions = await data.listInventions(organizationId);
  for (const invention of inventions) {
    const facts = await data.listFacts(organizationId, invention.id);
    const match = facts.find((fact) => fact.id === factId);
    if (match) return match;
  }
  return null;
}

/** Adds a user-asserted fact (PRD FR-3). Only human users reach this path. */
export async function addFact(params: {
  organizationId: Id;
  inventionId: Id;
  userId: Id;
  category: string;
  statement: string;
}): Promise<{ ok: true; fact: InventionFactRecord } | { ok: false; error: "invalid_input" | "not_found" }> {
  const parsed = factInputSchema.safeParse({
    category: params.category,
    statement: params.statement,
  });
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const { data } = getAdapters();
  const invention = await data.getInvention(params.organizationId, params.inventionId);
  if (!invention) return { ok: false, error: "not_found" };
  const fact = await data.createFact({
    organizationId: params.organizationId,
    inventionId: params.inventionId,
    category: parsed.data.category,
    statement: parsed.data.statement,
    provenance: "user_asserted",
    createdBy: "user",
  });
  await data.appendAuditEvent({
    organizationId: params.organizationId,
    actor: params.userId,
    action: "fact.created",
    target: fact.id,
    meta: { category: parsed.data.category },
  });
  return { ok: true, fact };
}
