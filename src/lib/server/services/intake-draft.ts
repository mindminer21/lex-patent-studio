import "server-only";

import {
  emptyIntakeState,
  INTAKE_STAGE_KEYS,
  parseComponentLines,
  parseContributorLines,
  parseSourceLines,
  parseTimelineLines,
  saveStageDraft,
  type IntakeStageKey,
} from "@/lib/wepatent/domain/intake";
import { getAdapters } from "../adapters";
import type { Id } from "../adapters/types";

/**
 * Shared stage-form parsing + draft persistence for the classic guided form
 * intake (PRD §7.3).
 *
 * Friction audit #2: the "Save draft" button is gone — stage data autosaves
 * (debounced while typing, on blur, and before stage navigation) through
 * `POST /api/intake/draft`, which lands here. The same parser also feeds
 * the validated "Save and continue" server action, so the draft the user
 * resumes is byte-identical to what validation would have seen.
 *
 * IMPORTANT: this path deliberately does NOT validate. Partial and invalid
 * stage data is saved as DRAFT state only — `saveStageDraft` also clears
 * the stage's `completed` flag, so an autosaved draft can never pass for a
 * validated stage and can never reach submission. Submit-time validation
 * (`completeStage` + the review-stage attestation) is untouched.
 */

export function isIntakeStage(value: string): value is IntakeStageKey {
  return INTAKE_STAGE_KEYS.includes(value as IntakeStageKey);
}

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export function parseIntakeStageForm(stage: IntakeStageKey, formData: FormData): unknown {
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

export type SaveIntakeDraftResult =
  | { ok: true; savedAt: string }
  | { ok: false; error: "invalid_stage" | "not_autosavable" };

/**
 * The review stage is NOT autosaved: its only input is the accuracy
 * attestation checkbox, which is a KEEP-list compliance step (the record of
 * explicit assent is the point). Silently persisting it would blur that.
 */
export const AUTOSAVABLE_STAGES: readonly IntakeStageKey[] = INTAKE_STAGE_KEYS.filter(
  (stage) => stage !== "review",
);

export async function saveIntakeStageDraft(params: {
  organizationId: Id;
  userId: Id;
  stage: string;
  formData: FormData;
}): Promise<SaveIntakeDraftResult> {
  if (!isIntakeStage(params.stage)) return { ok: false, error: "invalid_stage" };
  const stage = params.stage;
  if (!AUTOSAVABLE_STAGES.includes(stage)) return { ok: false, error: "not_autosavable" };

  const { data } = getAdapters();
  const session = await data.getIntakeSession(params.organizationId, params.userId);
  const state = session?.state ?? emptyIntakeState();
  const nextState = saveStageDraft(state, stage, parseIntakeStageForm(stage, params.formData));
  const saved = await data.saveIntakeSession({
    id: session?.id,
    organizationId: params.organizationId,
    userId: params.userId,
    state: nextState,
    submittedInventionId: null,
  });
  return { ok: true, savedAt: saved.updatedAt };
}
