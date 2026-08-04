"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { FACT_PROVENANCE_STATES, type FactProvenance } from "@/lib/wepatent/domain/facts";
import { can } from "@/lib/wepatent/domain/roles";
import { getAdapters } from "@/lib/server/adapters";
import { requireOnboarded } from "@/lib/server/session";
import {
  addFact,
  updateFactProvenance,
} from "@/lib/server/services/inventions";
import { enqueueJob } from "@/lib/server/jobs/runner";
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
    `/wepatent/app/inventions/${inventionId}/facts${result.ok ? "" : `?error=${result.error}`}`,
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
    redirect(`/wepatent/app/inventions/${inventionId}/facts?error=invalid_state`);
  }
  const result = await updateFactProvenance({
    organizationId: context.organization.id,
    factId,
    actor: "user",
    to: to as FactProvenance,
    actorUserId: context.user.id,
  });
  redirect(
    `/wepatent/app/inventions/${inventionId}/facts${result.ok ? "" : `?error=${result.error}`}`,
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
    redirect(`/wepatent/app/inventions/${inventionId}/contributors?error=invalid_input`);
  }
  const { data } = getAdapters();
  const invention = await data.getInvention(context.organization.id, inventionId);
  if (!invention) redirect("/wepatent/app");
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
  redirect(`/wepatent/app/inventions/${inventionId}/contributors`);
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
    redirect(`/wepatent/app/inventions/${inventionId}/timeline?error=invalid_input`);
  }
  const { data } = getAdapters();
  const invention = await data.getInvention(context.organization.id, inventionId);
  if (!invention) redirect("/wepatent/app");
  await data.createDisclosureEvent({
    organizationId: context.organization.id,
    inventionId,
    ...parsed.data,
  });
  redirect(`/wepatent/app/inventions/${inventionId}/timeline`);
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
    redirect(`/wepatent/app/inventions/${inventionId}/sources?error=invalid_input`);
  }
  const { data } = getAdapters();
  const invention = await data.getInvention(context.organization.id, inventionId);
  if (!invention) redirect("/wepatent/app");
  await data.createSource({
    organizationId: context.organization.id,
    inventionId,
    name: parsed.data.name,
    kind: parsed.data.kind,
    note: parsed.data.note,
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
  redirect(`/wepatent/app/inventions/${inventionId}/sources`);
}

/**
 * Enqueues a durable generation job (PRD §7.4, §14). The request path never
 * waits for the model; the drafts screen polls /api/jobs/:id for progress.
 * The idempotency key travels into the reservation layer so a retry can
 * never double-charge.
 */
export async function generateDraftAction(formData: FormData): Promise<void> {
  const context = await requireOnboarded();
  const inventionId = String(formData.get("inventionId") ?? "");
  const workflow = String(formData.get("workflow") ?? "");
  const tierId = String(formData.get("tierId") ?? "");
  const idempotencyKey = String(formData.get("idempotencyKey") ?? "");
  if (!WORKFLOWS.includes(workflow as DraftWorkflow) || !idempotencyKey) {
    redirect(`/wepatent/app/inventions/${inventionId}/drafts?error=invalid_input`);
  }
  const { data } = getAdapters();
  const invention = await data.getInvention(context.organization.id, inventionId);
  if (!invention) redirect("/wepatent/app");
  const result = await enqueueJob({
    organizationId: context.organization.id,
    kind: "generation",
    idempotencyKey,
    payload: {
      inventionId,
      workflow,
      tierId,
      userId: context.user.id,
    },
  });
  if (!result.ok) {
    redirect(`/wepatent/app/inventions/${inventionId}/drafts?error=invalid_input`);
  }
  redirect(`/wepatent/app/inventions/${inventionId}/drafts?job=${result.job.id}`);
}

/** Retries a failed/cancelled generation job under its original key. */
export async function retryGenerationAction(formData: FormData): Promise<void> {
  const context = await requireOnboarded();
  const jobId = String(formData.get("jobId") ?? "");
  const { data } = getAdapters();
  const job = await data.getJob(context.organization.id, jobId);
  if (!job || job.kind !== "generation") redirect("/wepatent/app");
  const inventionId = String(job.payload.inventionId ?? "");
  const result = await enqueueJob({
    organizationId: context.organization.id,
    kind: "generation",
    idempotencyKey: job.idempotencyKey,
    payload: job.payload,
  });
  redirect(
    `/wepatent/app/inventions/${inventionId}/drafts${result.ok ? `?job=${result.job.id}` : "?error=invalid_input"}`,
  );
}

export async function createExportAction(formData: FormData): Promise<void> {
  const context = await requireOnboarded();
  const inventionId = String(formData.get("inventionId") ?? "");
  const draftVersionId = String(formData.get("draftVersionId") ?? "") || null;
  const sections = [
    "facts",
    "contributors",
    "timeline",
    "sources",
    "ps_ledger",
    "coverage",
  ].filter((section) => formData.get(`section_${section}`) === "on");
  const result = await createExport({
    organizationId: context.organization.id,
    userId: context.user.id,
    inventionId,
    draftVersionId,
    sections,
  });
  redirect(
    `/wepatent/app/inventions/${inventionId}/export${result.ok ? "" : `?error=${result.error}`}`,
  );
}

/**
 * FR-3 soft deletion: the record leaves active lists immediately and is
 * permanently purged after the organization's retention window (see
 * Settings → Retention & deletion).
 */
export async function softDeleteInventionAction(formData: FormData): Promise<void> {
  const context = await requireOnboarded();
  if (!can(context.membership.role, "invention.edit")) {
    redirect("/wepatent/app?error=forbidden");
  }
  const inventionId = String(formData.get("inventionId") ?? "");
  const { data } = getAdapters();
  const invention = await data.getInvention(context.organization.id, inventionId);
  if (!invention) redirect("/wepatent/app?error=not_found");
  await data.softDeleteInvention(context.organization.id, inventionId);
  await data.appendAuditEvent({
    organizationId: context.organization.id,
    actor: `user:${context.user.id}`,
    action: "invention.soft_deleted",
    target: inventionId,
    meta: {},
  });
  redirect("/wepatent/app?deleted=1");
}
