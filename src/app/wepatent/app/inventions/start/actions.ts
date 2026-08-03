"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { can } from "@/lib/wepatent/domain/roles";
import { getAdapters } from "@/lib/server/adapters";
import { requireOnboarded } from "@/lib/server/session";

const nameSchema = z.string().trim().min(2).max(300);

/**
 * Path A entry (Intake Studio §4.1, FR-INT-1): the invention record is
 * created on first commit — here, when the user names it and chooses the
 * upload path — and the user lands in the Intake Studio for that record.
 */
export async function startUploadPathAction(formData: FormData): Promise<void> {
  const context = await requireOnboarded();
  if (!can(context.membership.role, "invention.edit")) {
    redirect("/wepatent/app?error=forbidden");
  }
  const parsed = nameSchema.safeParse(formData.get("workingName"));
  if (!parsed.success) {
    redirect("/wepatent/app/inventions/start?error=invalid_name");
  }
  const { data } = getAdapters();
  const invention = await data.createInvention({
    organizationId: context.organization.id,
    title: parsed.data,
    summary: "",
    businessContext: "",
    problem: "",
    solution: "",
    synthetic: false,
  });
  await data.appendAuditEvent({
    organizationId: context.organization.id,
    actor: context.user.id,
    action: "invention.created_via_studio",
    target: invention.id,
    meta: { path: "upload" },
  });
  redirect(`/wepatent/app/inventions/${invention.id}/studio`);
}

/**
 * Path B entry (Intake Studio §4.1, M2): the record is created on first
 * commit and the user lands in the adaptive interview for that record.
 * The guided form intake remains available and writes to the same ledgers.
 */
export async function startInterviewPathAction(formData: FormData): Promise<void> {
  const context = await requireOnboarded();
  if (!can(context.membership.role, "invention.edit")) {
    redirect("/wepatent/app?error=forbidden");
  }
  const parsed = nameSchema.safeParse(formData.get("interviewWorkingName"));
  if (!parsed.success) {
    redirect("/wepatent/app/inventions/start?error=invalid_interview_name");
  }
  const { data } = getAdapters();
  const invention = await data.createInvention({
    organizationId: context.organization.id,
    title: parsed.data,
    summary: "",
    businessContext: "",
    problem: "",
    solution: "",
    synthetic: false,
  });
  await data.appendAuditEvent({
    organizationId: context.organization.id,
    actor: context.user.id,
    action: "invention.created_via_studio",
    target: invention.id,
    meta: { path: "interview" },
  });
  redirect(`/wepatent/app/inventions/${invention.id}/interview`);
}
