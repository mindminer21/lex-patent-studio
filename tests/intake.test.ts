import { describe, expect, it } from "vitest";
import {
  canEnterStage,
  canSubmit,
  completeStage,
  emptyIntakeState,
  firstIncompleteStage,
  INTAKE_STAGE_KEYS,
  parseComponentLines,
  parseContributorLines,
  parseTimelineLines,
  saveStageDraft,
  type IntakeState,
} from "@/lib/wepatent/domain/intake";

const validStageData: Record<string, unknown> = {
  identity: {
    title: "Test invention",
    summary: "A sufficiently long summary of the invention.",
    businessContext: "",
  },
  problem_solution: {
    problem: "A sufficiently described problem statement.",
    solution: "A sufficiently described technical solution.",
  },
  components: {
    components: [{ name: "Widget", description: "Does things" }],
    steps: [],
    alternatives: "",
    advantages: "",
  },
  contributors: {
    contributors: [{ name: "Ada", email: "ada@example.test", contribution: "Designed it" }],
  },
  timeline: {
    events: [
      { date: "2026-05-01", kind: "disclosure", description: "Shown to partner", underNda: true },
    ],
    noEventsConfirmed: false,
  },
  ownership: {
    employmentAgreementsExist: "yes",
    assignmentsExecuted: "unsure",
    thirdPartyObligations: "",
    openQuestions: "Prior employer overlap",
  },
  sources: { sources: [{ name: "Notebook", kind: "lab_notebook", note: "" }], noSourcesConfirmed: false },
  review: { confirmAccuracy: true },
};

function completeAllStages(): IntakeState {
  let state = emptyIntakeState();
  for (const key of INTAKE_STAGE_KEYS) {
    const result = completeStage(state, key, validStageData[key]);
    expect(result.ok, `stage ${key}`).toBe(true);
    if (result.ok) state = result.state;
  }
  return state;
}

describe("staged invention intake (PRD §7.3)", () => {
  it("stages must be completed in order", () => {
    const state = emptyIntakeState();
    expect(canEnterStage(state, "identity")).toBe(true);
    expect(canEnterStage(state, "problem_solution")).toBe(false);
    expect(canEnterStage(state, "review")).toBe(false);
    expect(completeStage(state, "review", validStageData.review)).toEqual({
      ok: false,
      error: "stage_locked",
    });
  });

  it("has exactly eight stages", () => {
    expect(INTAKE_STAGE_KEYS).toHaveLength(8);
  });

  it("completing all eight stages enables submission", () => {
    const state = completeAllStages();
    expect(canSubmit(state)).toBe(true);
  });

  it("submission is blocked until every stage is complete", () => {
    let state = emptyIntakeState();
    for (const key of INTAKE_STAGE_KEYS.slice(0, 7)) {
      const result = completeStage(state, key, validStageData[key]);
      if (result.ok) state = result.state;
    }
    expect(canSubmit(state)).toBe(false);
  });

  it("save/resume keeps partial data without marking the stage complete", () => {
    let state = emptyIntakeState();
    state = saveStageDraft(state, "identity", { title: "Wip" });
    expect(state.completed).toEqual([]);
    expect(state.stageData.identity).toEqual({ title: "Wip" });
    expect(firstIncompleteStage(state)).toBe("identity");
  });

  it("editing a completed stage invalidates its completion until revalidated", () => {
    let state = emptyIntakeState();
    const done = completeStage(state, "identity", validStageData.identity);
    expect(done.ok).toBe(true);
    if (done.ok) state = done.state;
    expect(state.completed).toContain("identity");
    state = saveStageDraft(state, "identity", { title: "changed" });
    expect(state.completed).not.toContain("identity");
  });

  it("rejects invalid stage data with readable issues", () => {
    const result = completeStage(emptyIntakeState(), "identity", { title: "x", summary: "s" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("validation_failed");
      expect(result.issues?.length).toBeGreaterThan(0);
    }
  });

  it("timeline requires events or an explicit no-events confirmation", () => {
    let state = emptyIntakeState();
    for (const key of INTAKE_STAGE_KEYS.slice(0, 4)) {
      const result = completeStage(state, key, validStageData[key]);
      if (result.ok) state = result.state;
    }
    const missing = completeStage(state, "timeline", { events: [], noEventsConfirmed: false });
    expect(missing.ok).toBe(false);
    const confirmed = completeStage(state, "timeline", { events: [], noEventsConfirmed: true });
    expect(confirmed.ok).toBe(true);
  });

  it("review stage requires explicit accuracy confirmation", () => {
    let state = emptyIntakeState();
    for (const key of INTAKE_STAGE_KEYS.slice(0, 7)) {
      const result = completeStage(state, key, validStageData[key]);
      if (result.ok) state = result.state;
    }
    expect(completeStage(state, "review", { confirmAccuracy: false }).ok).toBe(false);
    expect(completeStage(state, "review", { confirmAccuracy: true }).ok).toBe(true);
  });
});

describe("line-format parsers", () => {
  it("parses component lines", () => {
    expect(parseComponentLines("Latch — holds cartridge\nFrame")).toEqual([
      { name: "Latch", description: "holds cartridge" },
      { name: "Frame", description: "" },
    ]);
  });

  it("parses contributor lines with optional email", () => {
    expect(parseContributorLines("Ada <ada@example.test> — design\nBob — testing")).toEqual([
      { name: "Ada", email: "ada@example.test", contribution: "design" },
      { name: "Bob", contribution: "testing" },
    ]);
  });

  it("parses timeline lines with NDA marker", () => {
    expect(parseTimelineLines("2026-06-02 | disclosure | Customer demo (NDA)")).toEqual([
      { date: "2026-06-02", kind: "disclosure", description: "Customer demo", underNda: true },
    ]);
  });
});
