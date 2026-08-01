"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { FACT_PROVENANCE_STATES, type FactProvenance } from "@/lib/domain/facts";
import { getAdapters } from "@/lib/server/adapters";
import { requireOnboarded } from "@/lib/server/session";
import {
  addFact,
  updateFactProvenance,
} from "@/lib/server/services/inventions";
import { runGeneration } from "@/lib/server/services/generation";
import { createExport } from "@/lib/server/services/exports";
import type { DraftWorkflow } from "@/lib/server/adapters/types";

const WORKFLOWS: DraftWorkflow[] = [
  "invention_disclosure_summary",
  "counsel_question_list",
  "gap_analysis",
];

export async function addFactAction(formData: FormData): Promise<void> {
  const context = await requireOnboarded();
  const inventionId = String(formData.get("inventionId") ?? "");
  const result = await addFact({
    organizationId: context.organization.id,
    inventionId,
    userId: context.user.id,
    category: String(formData.get("category") ?? ""),
    statement: String(formData.get("statement") ?? ""),
  });
  redirect(
    `/app/inventions/${inventionId}/facts${result.ok ? "" : `?error=${result.error}`}`,
  );
}

/**
 * User-actor provenance changes only. There is intentionally no code path
 * from model output to this action; counsel_reviewed is rejected here
 * because the ordinary app lane has no counsel actor (PRD FR-3).
 */
export async function factProvenanceAction(formData: FormData): Promise<void> {
  const context = await requireOnboarded();
  const inventionId = String(formData.get("inventionId") ?? "");
  const factId = String(formData.get("factId") ?? "");
  const to = String(formData.get("to") ?? "");
  if (!FACT_PROVENANCE_STATES.includes(to as FactProvenance)) {
    redirect(`/app/inventions/${inventionId}/facts?error=invalid_state`);
  }
  const result = await updateFactProvenance({
    organizationId: context.organization.id,
    factId,
    actor: "user",
    to: to as FactProvenance,
    actorUserId: context.user.id,
  });
  redirect(
    `/app/inventions/${inventionId}/facts${result.ok ? "" : `?error=${result.error}`}`,
  );
}

const contributorInput = z.object({
  name: z.string().trim().min(1).max(400),
  email: z.email().optional().or(z.literal("")),
  contribution: z.string().trim().min(3).max(8000),
});

export async function addContributorAction(formData: FormData): Promise<void> {
  const context = await requireOnboarded();
  const inventionId = String(formData.get("inventionId") ?? "");
  const parsed = contributorInput.safeParse({
    name: formData.get("name"),
    email: formData.get("email") || "",
    contribution: formData.get("contribution"),
  });
  if (!parsed.success) {
    redirect(`/app/inventions/${inventionId}/contributors?error=invalid_input`);
  }
  const { data } = getAdapters();
  const invention = await data.getInvention(context.organization.id, inventionId);
  if (!invention) redirect("/app");
  await data.createContributor({
    organizationId: context.organization.id,
    inventionId,
    name: parsed.data.name,
    email: parsed.data.email || null,
    contribution: parsed.data.contribution,
  });
  await data.createFact({
    organizationId: context.organization.id,
    inventionId,
    category: "contributor",
    statement: `${parsed.data.name} contributed: ${parsed.data.contribution}`,
    provenance: "user_asserted",
    createdBy: "user",
  });
  redirect(`/app/inventions/${inventionId}/contributors`);
}

const eventInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kind: z.string().trim().min(1).max(60),
  description: z.string().trim().min(3).max(8000),
  underNda: z.boolean(),
});

export async function addDisclosureEventAction(formData: FormData): Promise<void> {
  const context = await requireOnboarded();
  const inventionId = String(formData.get("inventionId") ?? "");
  const parsed = eventInput.safeParse({
    date: formData.get("date"),
    kind: formData.get("kind"),
    description: formData.get("description"),
    underNda: formData.get("underNda") === "on",
  });
  if (!parsed.success) {
    redirect(`/app/inventions/${inventionId}/timeline?error=invalid_input`);
  }
  const { data } = getAdapters();
  const invention = await data.getInvention(context.organization.id, inventionId);
  if (!invention) redirect("/app");
  await data.createDisclosureEvent({
    organizationId: context.organization.id,
    inventionId,
    ...parsed.data,
  });
  redirect(`/app/inventions/${inventionId}/timeline`);
}

const sourceInput = z.object({
  name: z.string().trim().min(1).max(400),
  kind: z.string().trim().min(1).max(60),
  note: z.string().trim().max(1000),
});

export async function addSourceAction(formData: FormData): Promise<void> {
  const context = await requireOnboarded();
  const inventionId = String(formData.get("inventionId") ?? "");
  const parsed = sourceInput.safeParse({
    name: formData.get("name"),
    kind: formData.get("kind"),
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) {
    redirect(`/app/inventions/${inventionId}/sources?error=invalid_input`);
  }
  const { data } = getAdapters();
  const invention = await data.getInvention(context.organization.id, inventionId);
  if (!invention) redirect("/app");
  await data.createSource({
    organizationId: context.organization.id,
    inventionId,
    name: parsed.data.name,
    kind: parsed.data.kind,
    note: parsed.data.note,
    status: "registered",
    synthetic: false,
  });
  redirect(`/app/inventions/${inventionId}/sources`);
}

export async function generateDraftAction(formData: FormData): Promise<void> {
  const context = await requireOnboarded();
  const inventionId = String(formData.get("inventionId") ?? "");
  const workflow = String(formData.get("workflow") ?? "");
  const tierId = String(formData.get("tierId") ?? "");
  const idempotencyKey = String(formData.get("idempotencyKey") ?? "");
  if (!WORKFLOWS.includes(workflow as DraftWorkflow) || !idempotencyKey) {
    redirect(`/app/inventions/${inventionId}/drafts?error=invalid_input`);
  }
  const result = await runGeneration({
    organizationId: context.organization.id,
    userId: context.user.id,
    inventionId,
    workflow: workflow as DraftWorkflow,
    tierId,
    idempotencyKey,
  });
  if (!result.ok) {
    redirect(`/app/inventions/${inventionId}/drafts?error=${result.error}`);
  }
  redirect(`/app/inventions/${inventionId}/drafts?version=${result.version.id}`);
}

export async function createExportAction(formData: FormData): Promise<void> {
  const context = await requireOnboarded();
  const inventionId = String(formData.get("inventionId") ?? "");
  const draftVersionId = String(formData.get("draftVersionId") ?? "") || null;
  const sections = ["facts", "contributors", "timeline", "sources"].filter(
    (section) => formData.get(`section_${section}`) === "on",
  );
  const result = await createExport({
    organizationId: context.organization.id,
    userId: context.user.id,
    inventionId,
    draftVersionId,
    sections,
  });
  redirect(
    `/app/inventions/${inventionId}/export${result.ok ? "" : `?error=${result.error}`}`,
  );
}
