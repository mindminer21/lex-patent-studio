"use server";

import { redirect } from "next/navigation";
import {
  completeStage,
  emptyIntakeState,
  firstIncompleteStage,
  INTAKE_STAGE_KEYS,
  parseComponentLines,
  parseContributorLines,
  parseSourceLines,
  parseTimelineLines,
  saveStageDraft,
  stageIndex,
  type IntakeStageKey,
} from "@/lib/domain/intake";
import { getAdapters } from "@/lib/server/adapters";
import { requireOnboarded } from "@/lib/server/session";
import { submitIntake } from "@/lib/server/services/inventions";

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function parseStageForm(stage: IntakeStageKey, formData: FormData): unknown {
  switch (stage) {
    case "identity":
      return {
        title: text(formData, "title"),
        summary: text(formData, "summary"),
        businessContext: text(formData, "businessContext"),
      };
    case "problem_solution":
      return {
        problem: text(formData, "problem"),
        solution: text(formData, "solution"),
      };
    case "components":
      return {
        components: parseComponentLines(text(formData, "componentsText")),
        steps: text(formData, "stepsText")
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
        alternatives: text(formData, "alternatives"),
        advantages: text(formData, "advantages"),
      };
    case "contributors":
      return { contributors: parseContributorLines(text(formData, "contributorsText")) };
    case "timeline":
      return {
        events: parseTimelineLines(text(formData, "eventsText")),
        noEventsConfirmed: formData.get("noEventsConfirmed") === "on",
      };
    case "ownership":
      return {
        employmentAgreementsExist: text(formData, "employmentAgreementsExist"),
        assignmentsExecuted: text(formData, "assignmentsExecuted"),
        thirdPartyObligations: text(formData, "thirdPartyObligations"),
        openQuestions: text(formData, "openQuestions"),
      };
    case "sources":
      return {
        sources: parseSourceLines(text(formData, "sourcesText")),
        noSourcesConfirmed: formData.get("noSourcesConfirmed") === "on",
      };
    case "review":
      return { confirmAccuracy: formData.get("confirmAccuracy") === "on" };
  }
}

/**
 * Save-and-resume plus validated stage completion for the staged intake
 * (PRD §7.3). All validation happens server-side against the stage schemas.
 */
export async function intakeStageAction(formData: FormData): Promise<void> {
  const context = await requireOnboarded();
  const { data } = getAdapters();

  const stageRaw = String(formData.get("stage") ?? "");
  const intent = String(formData.get("intent") ?? "continue");
  if (!INTAKE_STAGE_KEYS.includes(stageRaw as IntakeStageKey)) {
    redirect("/app/inventions/new");
  }
  const stage = stageRaw as IntakeStageKey;

  const session = await data.getIntakeSession(context.organization.id, context.user.id);
  const state = session?.state ?? emptyIntakeState();
  const stageData = parseStageForm(stage, formData);

  if (intent === "save") {
    const nextState = saveStageDraft(state, stage, stageData);
    await data.saveIntakeSession({
      id: session?.id,
      organizationId: context.organization.id,
      userId: context.user.id,
      state: nextState,
      submittedInventionId: null,
    });
    redirect(`/app/inventions/new?stage=${stage}&saved=1`);
  }

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
    redirect(`/app/inventions/new?stage=${stage}&error=${result.error}&issues=${issues}`);
  }

  if (stage === "review") {
    const submission = await submitIntake({
      organizationId: context.organization.id,
      userId: context.user.id,
      intake: result.state,
    });
    if (!submission.ok) {
      redirect(`/app/inventions/new?stage=review&error=${submission.error}`);
    }
    await data.saveIntakeSession({
      id: session?.id,
      organizationId: context.organization.id,
      userId: context.user.id,
      state: result.state,
      submittedInventionId: submission.invention.id,
    });
    redirect(`/app/inventions/${submission.invention.id}`);
  }

  await data.saveIntakeSession({
    id: session?.id,
    organizationId: context.organization.id,
    userId: context.user.id,
    state: result.state,
    submittedInventionId: null,
  });

  const nextStage = INTAKE_STAGE_KEYS[stageIndex(stage) + 1] ?? firstIncompleteStage(result.state);
  redirect(`/app/inventions/new?stage=${nextStage}`);
}
