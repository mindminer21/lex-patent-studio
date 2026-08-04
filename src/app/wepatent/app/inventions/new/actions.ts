"use server";

import { redirect } from "next/navigation";
import {
  completeStage,
  emptyIntakeState,
  firstIncompleteStage,
  INTAKE_STAGE_KEYS,
  saveStageDraft,
  stageIndex,
  type IntakeStageKey,
} from "@/lib/wepatent/domain/intake";
import { getAdapters } from "@/lib/server/adapters";
import { requireOnboarded } from "@/lib/server/session";
import { parseIntakeStageForm } from "@/lib/server/services/intake-draft";
import { submitIntake } from "@/lib/server/services/inventions";

/**
 * Validated stage completion for the classic guided form (PRD §7.3). All
 * validation happens server-side against the stage schemas — unchanged by
 * the autosave work (friction audit #2). Draft persistence now lives in
 * `services/intake-draft.ts` and is shared with `POST /api/intake/draft`.
 */
export async function intakeStageAction(formData: FormData): Promise<void> {
  const context = await requireOnboarded();
  const { data } = getAdapters();

  const stageRaw = String(formData.get("stage") ?? "");
  if (!INTAKE_STAGE_KEYS.includes(stageRaw as IntakeStageKey)) {
    redirect("/wepatent/app/inventions/new");
  }
  const stage = stageRaw as IntakeStageKey;

  const session = await data.getIntakeSession(context.organization.id, context.user.id);
  const state = session?.state ?? emptyIntakeState();
  const stageData = parseIntakeStageForm(stage, formData);

  const result = completeStage(state, stage, stageData);
  if (!result.ok) {
    // Preserve what the user typed for resume, then surface the issues.
    const draftState = saveStageDraft(state, stage, stageData);
    await data.saveIntakeSession({
      id: session?.id,
      organizationId: context.organization.id,
      userId: context.user.id,
      state: draftState,
      submittedInventionId: null,
    });
    const issues =
      result.error === "validation_failed"
        ? encodeURIComponent((result.issues ?? []).join("||").slice(0, 800))
        : "";
    redirect(`/wepatent/app/inventions/new?stage=${stage}&error=${result.error}&issues=${issues}`);
  }

  if (stage === "review") {
    const submission = await submitIntake({
      organizationId: context.organization.id,
      userId: context.user.id,
      intake: result.state,
    });
    if (!submission.ok) {
      redirect(`/wepatent/app/inventions/new?stage=review&error=${submission.error}`);
    }
    await data.saveIntakeSession({
      id: session?.id,
      organizationId: context.organization.id,
      userId: context.user.id,
      state: result.state,
      submittedInventionId: submission.invention.id,
    });
    redirect(`/wepatent/app/inventions/${submission.invention.id}`);
  }

  await data.saveIntakeSession({
    id: session?.id,
    organizationId: context.organization.id,
    userId: context.user.id,
    state: result.state,
    submittedInventionId: null,
  });

  const nextStage = INTAKE_STAGE_KEYS[stageIndex(stage) + 1] ?? firstIncompleteStage(result.state);
  redirect(`/wepatent/app/inventions/new?stage=${nextStage}`);
}
