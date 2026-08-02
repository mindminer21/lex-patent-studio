"use server";

import { revalidatePath } from "next/cache";
import { getAdapters } from "@/lib/adapters";
import { reviewDecisionSchema, runRequestSchema } from "@/lib/domain/schemas";
import { z } from "zod";

/**
 * Server actions for the authenticated workspace.
 *
 * Authorization derives from the server-resolved session (adapter contract),
 * never from client-supplied role or tenant values (PRD-wepatent Invariant 6).
 * Model output has no path into these actions; every mutation records an
 * audit event in the local store.
 */

export interface ActionState {
  ok: boolean;
  message: string;
}

export async function createRunAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const adapters = getAdapters();
  const session = await adapters.auth.getSession();
  if (!session) return { ok: false, message: "Not authenticated." };

  const parsed = runRequestSchema.safeParse({
    matterId: formData.get("matterId"),
    workflowKey: formData.get("workflowKey"),
    jurisdiction: formData.get("jurisdiction"),
    asOfDate: formData.get("asOfDate"),
    modelId: formData.get("modelId"),
    deliverableType: formData.get("deliverableType"),
    qualityControls: {
      sourceRequired: formData.get("qcSourceRequired") === "on",
      secondModelReview: formData.get("qcSecondModel") === "on",
      quoteVerification: formData.get("qcQuoteVerification") === "on",
    },
    factIds: [],
    sourceIds: [],
  });
  if (!parsed.success) {
    return { ok: false, message: "Please complete every composer field." };
  }

  const result = await adapters.data.createRun(
    session.organizationId,
    parsed.data,
    { requestedBy: session.userId, role: session.role },
  );
  if (!result.ok) return { ok: false, message: result.error };

  revalidatePath(`/app/matters/${parsed.data.matterId}`);
  revalidatePath("/app");
  return {
    ok: true,
    message: `Run queued (Tier ${result.run.tier}, est. $${result.run.estimatedChargeLowUsd.toFixed(2)}–$${result.run.estimatedChargeHighUsd.toFixed(2)}). Local mode: no provider call is made.`,
  };
}

export async function cancelRunAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const adapters = getAdapters();
  const session = await adapters.auth.getSession();
  if (!session) return { ok: false, message: "Not authenticated." };

  const runId = formData.get("runId");
  if (typeof runId !== "string" || !runId) {
    return { ok: false, message: "Invalid run." };
  }
  const result = await adapters.data.cancelRun(session.organizationId, runId, {
    userId: session.userId,
    role: session.role,
  });
  if (!result.ok) return { ok: false, message: result.error };

  revalidatePath(`/app/matters/${result.run.matterId}`);
  revalidatePath("/app");
  return {
    ok: true,
    message: `Run cancelled. ${result.run.actualChargeUsd != null ? `Settled $${result.run.actualChargeUsd.toFixed(2)} for the completed generation stage; remainder returned.` : "Reservation fully released — no charge."}`,
  };
}

const factSchema = z.object({
  matterId: z.string().min(1),
  category: z.enum([
    "problem",
    "solution",
    "component",
    "step",
    "alternative",
    "advantage",
    "contributor",
    "date",
  ]),
  text: z.string().min(1).max(4000),
});

export async function createFactAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const adapters = getAdapters();
  const session = await adapters.auth.getSession();
  if (!session) return { ok: false, message: "Not authenticated." };

  const parsed = factSchema.safeParse({
    matterId: formData.get("matterId"),
    category: formData.get("category"),
    text: formData.get("text"),
  });
  if (!parsed.success) return { ok: false, message: "Please complete the fact fields." };

  const result = await adapters.data.createFact(
    session.organizationId,
    parsed.data.matterId,
    { category: parsed.data.category, text: parsed.data.text, sourceIds: [] },
    { userId: session.userId, role: session.role },
  );
  if (!result.ok) return { ok: false, message: result.error };

  revalidatePath(`/app/matters/${parsed.data.matterId}/facts`);
  revalidatePath(`/app/matters/${parsed.data.matterId}`);
  return {
    ok: true,
    message: `Fact added to the ledger as user_asserted (${result.fact.category}). A practitioner approval moves it to counsel_reviewed.`,
  };
}

export async function approveFactAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const adapters = getAdapters();
  const session = await adapters.auth.getSession();
  if (!session) return { ok: false, message: "Not authenticated." };

  const matterId = formData.get("matterId");
  const factId = formData.get("factId");
  if (typeof matterId !== "string" || typeof factId !== "string") {
    return { ok: false, message: "Invalid fact." };
  }
  const result = await adapters.data.approveFact(
    session.organizationId,
    matterId,
    factId,
    { userId: session.userId, role: session.role },
  );
  if (!result.ok) return { ok: false, message: result.error };

  revalidatePath(`/app/matters/${matterId}/facts`);
  revalidatePath(`/app/matters/${matterId}`);
  return {
    ok: true,
    message: `Fact approved: ${result.event.fromProvenance} → counsel_reviewed (recorded as fact event ${result.event.id}).`,
  };
}

const uploadSchema = z.object({
  matterId: z.string().min(1),
  fileName: z.string().min(1).max(255),
  contentType: z.string().min(1),
  sizeBytes: z.coerce.number().int().positive(),
});

export async function signUploadAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const adapters = getAdapters();
  const session = await adapters.auth.getSession();
  if (!session) return { ok: false, message: "Not authenticated." };

  const parsed = uploadSchema.safeParse({
    matterId: formData.get("matterId"),
    fileName: formData.get("fileName"),
    contentType: formData.get("contentType"),
    sizeBytes: formData.get("sizeBytes"),
  });
  if (!parsed.success) return { ok: false, message: "Please complete the upload fields." };

  const result = await adapters.data.createUploadTarget(
    session.organizationId,
    parsed.data.matterId,
    {
      fileName: parsed.data.fileName,
      contentType: parsed.data.contentType as never,
      sizeBytes: parsed.data.sizeBytes,
    },
    { userId: session.userId, role: session.role },
  );
  if (!result.ok) return { ok: false, message: result.error };

  revalidatePath(`/app/matters/${parsed.data.matterId}/sources`);
  return {
    ok: true,
    message: `Signed upload target issued (SIMULATED, expires ${new Date(result.target.expiresAt).toISOString().slice(11, 16)}Z): ${result.target.uploadUrl}. Local mode accepts no bytes; production routes uploads through malware scan → quarantine → extraction.`,
  };
}

export async function exportDocumentAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const adapters = getAdapters();
  const session = await adapters.auth.getSession();
  if (!session) return { ok: false, message: "Not authenticated." };

  const documentId = formData.get("documentId");
  if (typeof documentId !== "string" || !documentId) {
    return { ok: false, message: "Invalid document." };
  }
  const result = await adapters.data.createExport(
    session.organizationId,
    documentId,
    { userId: session.userId, role: session.role },
  );
  if (!result.ok) return { ok: false, message: result.error };

  revalidatePath(`/app/matters/${result.record.matterId}/documents`);
  return {
    ok: true,
    message: result.reused
      ? `This document version was already exported — returning the existing immutable artifact ${result.record.fileName} (sha256 ${result.record.docxSha256.slice(0, 12)}…).`
      : `Exported ${result.record.fileName}${result.record.manifest.watermark ? ` watermarked "${result.record.manifest.watermark}"` : " as approved work product"} — sha256 ${result.record.docxSha256.slice(0, 12)}…`,
  };
}

const chatActionSchema = z.object({
  matterId: z.string().min(1),
  question: z.string().min(3).max(2000),
});

export async function postChatMessageAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const adapters = getAdapters();
  const session = await adapters.auth.getSession();
  if (!session) return { ok: false, message: "Not authenticated." };

  const parsed = chatActionSchema.safeParse({
    matterId: formData.get("matterId"),
    question: formData.get("question"),
  });
  if (!parsed.success) {
    return { ok: false, message: "Enter a question (3–2000 characters)." };
  }

  const result = await adapters.data.postChatMessage(
    session.organizationId,
    parsed.data.matterId,
    { question: parsed.data.question },
    { userId: session.userId, role: session.role },
  );
  if (!result.ok) return { ok: false, message: result.error };

  revalidatePath(`/app/matters/${parsed.data.matterId}/chat`);
  return {
    ok: true,
    message: `Grounded reply posted with ${result.reply.citations.filter((c) => c.kind === "authority").length} authority citation(s).`,
  };
}

const styleActionSchema = z.object({
  name: z.string().min(1).max(200),
  kind: z.enum(["application_drafting", "search_report", "oa_response"]),
  rulesText: z.string().min(1).max(8000),
});

export async function createStyleProfileAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const adapters = getAdapters();
  const session = await adapters.auth.getSession();
  if (!session) return { ok: false, message: "Not authenticated." };

  const parsed = styleActionSchema.safeParse({
    name: formData.get("name"),
    kind: formData.get("kind"),
    rulesText: formData.get("rulesText"),
  });
  if (!parsed.success) return { ok: false, message: "Please complete the profile fields." };

  const rules = parsed.data.rulesText
    .split("\n")
    .map((r) => r.trim())
    .filter((r) => r.length > 0)
    .slice(0, 24);
  if (rules.length === 0) {
    return { ok: false, message: "Enter at least one style rule (one per line)." };
  }

  const result = await adapters.data.createStyleProfile(
    session.organizationId,
    { name: parsed.data.name, kind: parsed.data.kind, rules },
    { userId: session.userId, role: session.role },
  );
  if (!result.ok) return { ok: false, message: result.error };

  revalidatePath("/app/templates");
  return {
    ok: true,
    message: `Style profile ${result.profile.name}@${result.profile.version} created with ${result.profile.rules.length} rule(s). Future runs on matters using it record this version.`,
  };
}

const playbookActionSchema = z.object({
  title: z.string().min(1).max(300),
  category: z.enum(["approved_argument", "claim_structure", "examiner_note"]),
  body: z.string().min(1).max(8000),
});

export async function publishPlaybookAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const adapters = getAdapters();
  const session = await adapters.auth.getSession();
  if (!session) return { ok: false, message: "Not authenticated." };

  const parsed = playbookActionSchema.safeParse({
    title: formData.get("title"),
    category: formData.get("category"),
    body: formData.get("body"),
  });
  if (!parsed.success) return { ok: false, message: "Please complete the entry fields." };

  const result = await adapters.data.publishPlaybookEntry(
    session.organizationId,
    parsed.data,
    { userId: session.userId, role: session.role },
  );
  if (!result.ok) return { ok: false, message: result.error };

  revalidatePath("/app/templates");
  return {
    ok: true,
    message: `Published "${result.entry.title}" — content hash ${result.entry.contentSha256.slice(0, 12)}…, chained to the previous entry. Publications are immutable.`,
  };
}

const decideSchema = z.object({
  reviewItemId: z.string().min(1),
  decision: reviewDecisionSchema,
  note: z.string().max(4000).optional(),
});

export async function decideReviewAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const adapters = getAdapters();
  const session = await adapters.auth.getSession();
  if (!session) return { ok: false, message: "Not authenticated." };

  const parsed = decideSchema.safeParse({
    reviewItemId: formData.get("reviewItemId"),
    decision: formData.get("decision"),
    note: (formData.get("note") as string | null) || undefined,
  });
  if (!parsed.success) return { ok: false, message: "Invalid decision." };

  const result = await adapters.data.decideReviewItem(
    session.organizationId,
    parsed.data.reviewItemId,
    parsed.data.decision,
    { userId: session.userId, role: session.role, note: parsed.data.note },
  );
  if (!result.ok) return { ok: false, message: result.error };

  revalidatePath("/app/review-queue");
  revalidatePath("/app");
  revalidatePath(`/app/matters/${result.item.matterId}`);
  return {
    ok: true,
    message: `Recorded: ${parsed.data.decision.replace("_", " ")} on "${result.item.documentTitle}" (doc hash ${result.record.documentVersionHash}).`,
  };
}
