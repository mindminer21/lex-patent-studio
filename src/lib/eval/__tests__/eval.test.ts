import { describe, expect, it } from "vitest";
import { SMOKE_SUITE, SMOKE_SUITE_VERSION } from "@/lib/eval/suite";
import { runSmokeSuite } from "@/lib/eval/runner";
import {
  evaluateReleaseGate,
  supportablePublicClaims,
  WORKFLOW_RELEASE_GATES,
} from "@/lib/eval/gates";
import { WORKFLOW_KEYS } from "@/lib/domain/tiers";

/**
 * §14 CI gate: the smoke subset runs on every test invocation. A failing
 * benchmark question fails CI — regressions in retrieval, verification,
 * checkers, or isolation block the build.
 */

describe("evaluation smoke suite (§14 CI gate)", () => {
  it("every smoke question passes against the local systems", async () => {
    const report = await runSmokeSuite(SMOKE_SUITE);
    const failures = report.results.filter((r) => !r.passed);
    expect(
      failures.map((f) => `${f.questionId}: ${f.detail}`),
    ).toEqual([]);
    expect(report.total).toBe(SMOKE_SUITE.length);
    expect(report.suiteVersion).toBe(SMOKE_SUITE_VERSION);
    expect(report.corpusRelease).toMatch(/corpus-/);
  });

  it("cross-matter leakage is zero (release-blocking dimension)", async () => {
    const report = await runSmokeSuite(SMOKE_SUITE);
    expect(report.crossMatterLeakageZero).toBe(true);
  });

  it("every question is currently machine-seeded pending attorney validation", () => {
    for (const q of SMOKE_SUITE) {
      expect(q.validation.status).toBe("machine_seeded_pending");
    }
  });
});

describe("release gates (§14, approval gate §20.12)", () => {
  it("every workflow has a gate and none is production-enabled", () => {
    const gated = new Set(WORKFLOW_RELEASE_GATES.map((g) => g.workflowKey));
    for (const key of WORKFLOW_KEYS) expect(gated.has(key)).toBe(true);
    for (const gate of WORKFLOW_RELEASE_GATES) {
      expect(gate.productionEnabled).toBe(false);
      expect(gate.requireZeroLeakage).toBe(true);
    }
  });

  it("machine-seeded evidence can never release a workflow", async () => {
    const report = await runSmokeSuite(SMOKE_SUITE);
    for (const gate of WORKFLOW_RELEASE_GATES) {
      const decision = evaluateReleaseGate(gate, report);
      expect(decision.releasable).toBe(false);
      expect(decision.reasons.join(" ")).toMatch(/attorney-validated/);
      expect(decision.reasons.join(" ")).toMatch(/§20\.12/);
    }
  });

  it("zero attorney-validated results → zero supportable public claims (§20.11)", async () => {
    const report = await runSmokeSuite(SMOKE_SUITE);
    expect(report.attorneyValidatedCount).toBe(0);
    expect(supportablePublicClaims(report)).toEqual([]);
  });
});
