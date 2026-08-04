"use server";

import { redirect } from "next/navigation";
import { can } from "@/lib/wepatent/domain/roles";
import { getAdapters } from "@/lib/server/adapters";
import { requireOnboarded } from "@/lib/server/session";

/**
 * Records start with an honest neutral placeholder (DB constraint: 3–200
 * chars). The AI proposes a working title after upload distillation or the
 * interview, and confirming a working title in the studio updates the
 * record title (see setWorkingTitle in services/ps-ledger).
 */
const PLACEHOLDER_TITLE = "Untitled invention";

async function createRecordForPath(path: "upload" | "interview"): Promise<string> {
  const context = await requireOnboarded();
  if (!can(context.membership.role, "invention.edit")) {
    redirect("/wepatent/app?error=forbidden");
  }
  const { data } = getAdapters();
  const invention = await data.createInvention({
    organizationId: context.organization.id,
    title: PLACEHOLDER_TITLE,
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
    meta: { path },
  });
  return invention.id;
}

/**
 * Path A entry (Intake Studio §4.1, FR-INT-1): the invention record is
 * created on first commit — when the user chooses the upload path — and the
 * user lands in the Intake Studio for that record.
 */
export async function startUploadPathAction(): Promise<void> {
  const inventionId = await createRecordForPath("upload");
  redirect(`/wepatent/app/inventions/${inventionId}/studio`);
}

/**
 * Path B entry (Intake Studio §4.1, M2): the record is created on first
 * commit and the user lands straight in the adaptive interview for that
 * record. The guided form intake remains available at
 * /wepatent/app/inventions/new and writes to the same ledgers.
 */
export async function startInterviewPathAction(): Promise<void> {
  const inventionId = await createRecordForPath("interview");
  redirect(`/wepatent/app/inventions/${inventionId}/interview`);
}
