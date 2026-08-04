import { beforeEach, describe, expect, it } from "vitest";
import { completeStage, emptyIntakeState } from "@/lib/wepatent/domain/intake";
import { getAdapters } from "@/lib/server/adapters";
import { LocalDataAdapter } from "@/lib/server/adapters/local/store";
import {
  AUTOSAVABLE_STAGES,
  parseIntakeStageForm,
  saveIntakeStageDraft,
} from "@/lib/server/services/intake-draft";
import { createOrganizationForUser } from "@/lib/server/services/orgs";
import { submitIntake } from "@/lib/server/services/inventions";

/**
 * Friction audit #2: the classic guided form's "Save draft" button is
 * replaced by autosave. These tests pin the safety properties: drafts
 * persist even when partial/invalid, an autosaved stage is never treated as
 * validated, submit-time validation is unchanged, and the review-stage
 * attestation is never autosaved.
 */

function form(entries: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(entries)) formData.set(key, value);
  return formData;
}

describe("classic guided form autosave (draft persistence)", () => {
  let organizationId = "";
  let userId = "";

  beforeEach(async () => {
    LocalDataAdapter.reset();
    const { data } = getAdapters();
    const user = await data.createUser({ email: "drafter@example.test", displayName: "D" });
    userId = user.id;
    organizationId = (await createOrganizationForUser(user.id, "Draft Org")).id;
  });

  it("persists a partial, invalid stage as draft state and resumes it", async () => {
    const { data } = getAdapters();
    // "summary" is below its 10-character minimum: this would fail
    // validation, but a draft must still survive a page reload.
    const result = await saveIntakeStageDraft({
      organizationId,
      userId,
      stage: "identity",
      formData: form({ stage: "identity", title: "Cooling manifold", summary: "too short" }),
    });
    expect(result.ok).toBe(true);

    const session = await data.getIntakeSession(organizationId, userId);
    expect(session?.state.stageData.identity).toMatchObject({
      title: "Cooling manifold",
      summary: "too short",
    });
    // Draft ≠ validated: the stage is not complete and nothing was submitted.
    expect(session?.state.completed).toEqual([]);
    expect(session?.submittedInventionId).toBeNull();
  });

  it("does not weaken submit-time validation", async () => {
    const { data } = getAdapters();
    await saveIntakeStageDraft({
      organizationId,
      userId,
      stage: "identity",
      formData: form({ stage: "identity", title: "ok", summary: "short" }),
    });
    const session = await data.getIntakeSession(organizationId, userId);
    const state = session!.state;

    // The same data through the validation path is still rejected.
    const validated = completeStage(state, "identity", state.stageData.identity);
    expect(validated.ok).toBe(false);

    // And an intake built only from autosaved drafts cannot be submitted.
    const submission = await submitIntake({ organizationId, userId, intake: state });
    expect(submission.ok).toBe(false);
  });

  it("re-marks an already-completed stage as an unvalidated draft when edited", async () => {
    const { data } = getAdapters();
    const completed = completeStage(emptyIntakeState(), "identity", {
      title: "Cooling manifold",
      summary: "A long enough summary for the identity stage schema.",
      businessContext: "",
    });
    expect(completed.ok).toBe(true);
    await data.saveIntakeSession({
      organizationId,
      userId,
      state: completed.ok ? completed.state : emptyIntakeState(),
      submittedInventionId: null,
    });

    await saveIntakeStageDraft({
      organizationId,
      userId,
      stage: "identity",
      formData: form({ stage: "identity", title: "x", summary: "y" }),
    });
    const session = await data.getIntakeSession(organizationId, userId);
    expect(session?.state.completed).not.toContain("identity");
  });

  it("never autosaves the review-stage accuracy attestation (KEEP list)", async () => {
    const { data } = getAdapters();
    const result = await saveIntakeStageDraft({
      organizationId,
      userId,
      stage: "review",
      formData: form({ stage: "review", confirmAccuracy: "on" }),
    });
    expect(result).toEqual({ ok: false, error: "not_autosavable" });
    expect(AUTOSAVABLE_STAGES).not.toContain("review");
    expect(await data.getIntakeSession(organizationId, userId)).toBeNull();
  });

  it("rejects unknown stages", async () => {
    expect(
      await saveIntakeStageDraft({
        organizationId,
        userId,
        stage: "not_a_stage",
        formData: form({ stage: "not_a_stage" }),
      }),
    ).toEqual({ ok: false, error: "invalid_stage" });
  });

  it("parses stage forms identically to the validated submit path", () => {
    expect(
      parseIntakeStageForm(
        "components",
        form({
          componentsText: "Manifold body — aluminum spreader\nCartridge — PCM insert",
          stepsText: "Assemble\nSeal",
          alternatives: "",
          advantages: "",
        }),
      ),
    ).toEqual({
      components: [
        { name: "Manifold body", description: "aluminum spreader" },
        { name: "Cartridge", description: "PCM insert" },
      ],
      steps: ["Assemble", "Seal"],
      alternatives: "",
      advantages: "",
    });
    expect(parseIntakeStageForm("timeline", form({ noEventsConfirmed: "on" }))).toEqual({
      events: [],
      noEventsConfirmed: true,
    });
  });
});
