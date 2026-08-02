import { describe, expect, it } from "vitest";
import {
  canTransitionRun,
  InvalidRunTransitionError,
  isTerminalRunState,
  nextRunStage,
  RUN_PIPELINE,
  runProgress,
  transitionRun,
  type RunState,
} from "@/lib/domain/run-state";

describe("workflow run state machine (FR-7)", () => {
  it("walks the full happy path in order", () => {
    const path: RunState[] = [
      "QUEUED",
      "INGESTING",
      "RETRIEVING",
      "GENERATING",
      "VERIFYING",
      "RENDERING",
      "COMPLETED",
    ];
    for (let i = 0; i < path.length - 1; i++) {
      expect(transitionRun(path[i], path[i + 1])).toBe(path[i + 1]);
    }
  });

  it("allows FAILED and CANCELLED from every active stage", () => {
    for (const stage of RUN_PIPELINE) {
      expect(canTransitionRun(stage, "FAILED")).toBe(true);
      expect(canTransitionRun(stage, "CANCELLED")).toBe(true);
    }
  });

  it("rejects skipping stages", () => {
    expect(canTransitionRun("QUEUED", "GENERATING")).toBe(false);
    expect(canTransitionRun("INGESTING", "VERIFYING")).toBe(false);
    expect(canTransitionRun("RETRIEVING", "COMPLETED")).toBe(false);
  });

  it("rejects moving backward", () => {
    expect(canTransitionRun("GENERATING", "RETRIEVING")).toBe(false);
    expect(canTransitionRun("VERIFYING", "QUEUED")).toBe(false);
  });

  it("terminal states admit no transitions", () => {
    for (const terminal of ["COMPLETED", "FAILED", "CANCELLED"] as const) {
      expect(isTerminalRunState(terminal)).toBe(true);
      for (const to of [
        "QUEUED",
        "GENERATING",
        "COMPLETED",
        "FAILED",
        "CANCELLED",
      ] as const) {
        expect(canTransitionRun(terminal, to)).toBe(false);
      }
    }
  });

  it("throws a typed error on invalid transitions", () => {
    expect(() => transitionRun("COMPLETED", "QUEUED")).toThrow(
      InvalidRunTransitionError,
    );
  });

  it("nextRunStage follows the pipeline and ends at COMPLETED", () => {
    expect(nextRunStage("QUEUED")).toBe("INGESTING");
    expect(nextRunStage("RENDERING")).toBe("COMPLETED");
    expect(nextRunStage("COMPLETED")).toBeNull();
  });

  it("runProgress is monotone over the pipeline", () => {
    const values = RUN_PIPELINE.map(runProgress);
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThan(values[i - 1]);
    }
    expect(runProgress("COMPLETED")).toBe(1);
    expect(runProgress("FAILED")).toBe(0);
  });
});
