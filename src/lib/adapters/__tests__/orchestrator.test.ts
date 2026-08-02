import { beforeEach, describe, expect, it } from "vitest";
import { localAdapters, resetLocalStore, getLocalStore } from "@/lib/adapters/local";
import {
  advanceRun,
  cancelRun,
  STAGE_DURATIONS_MS,
} from "@/lib/adapters/local/orchestrator";
import { DEMO_SESSION, DEMO_WALLET_BALANCE_USD, ORG_ID } from "@/lib/adapters/local/seed";
import type { RunRequest } from "@/lib/domain/schemas";

const PRACTITIONER = { requestedBy: DEMO_SESSION.userId, role: DEMO_SESSION.role };

const baseRequest: RunRequest = {
  matterId: "matter_thermal",
  workflowKey: "research_memo",
  jurisdiction: "US",
  asOfDate: "2026-08-01",
  modelId: "claude-sonnet-4-5",
  deliverableType: "Research memo with source trail",
  qualityControls: {
    sourceRequired: true,
    secondModelReview: true,
    quoteVerification: true,
  },
  factIds: [],
  sourceIds: [],
};

const TOTAL_PIPELINE_MS =
  STAGE_DURATIONS_MS.QUEUED +
  STAGE_DURATIONS_MS.INGESTING +
  STAGE_DURATIONS_MS.RETRIEVING +
  STAGE_DURATIONS_MS.GENERATING +
  STAGE_DURATIONS_MS.VERIFYING +
  STAGE_DURATIONS_MS.RENDERING;

async function createRun(request: Partial<RunRequest> = {}) {
  const result = await localAdapters.data.createRun(
    ORG_ID,
    { ...baseRequest, ...request },
    PRACTITIONER,
  );
  if (!result.ok) throw new Error(result.error);
  return result.run;
}

describe("simulated orchestrator", () => {
  beforeEach(() => resetLocalStore());

  it("reserves the high estimate against the wallet at creation", async () => {
    const run = await createRun();
    const store = getLocalStore();
    const reservation = store.reservations.find((r) => r.runId === run.id);
    expect(reservation).toMatchObject({
      state: "held",
      heldUsd: run.estimatedChargeHighUsd,
    });
    expect(store.walletBalanceUsd).toBeCloseTo(
      DEMO_WALLET_BALANCE_USD - run.estimatedChargeHighUsd,
      2,
    );
  });

  it("walks the full FR-7 pipeline with per-stage checkpoints and settles", async () => {
    const run = await createRun();
    const store = getLocalStore();
    const start = Date.parse(
      store.runPlans.find((p) => p.runId === run.id)!.startedAt,
    );

    advanceRun(store, run.id, start + TOTAL_PIPELINE_MS + 1);

    const updated = store.runs.find((r) => r.id === run.id)!;
    expect(updated.state).toBe("COMPLETED");

    const stages = store.runStages
      .filter((s) => s.runId === run.id)
      .map((s) => s.stage);
    expect(stages).toEqual([
      "QUEUED",
      "INGESTING",
      "RETRIEVING",
      "GENERATING",
      "VERIFYING",
      "RENDERING",
    ]);
    for (const s of store.runStages.filter((s) => s.runId === run.id)) {
      expect(s.completedAt).toBeDefined();
    }
    const generating = store.runStages.find(
      (s) => s.runId === run.id && s.stage === "GENERATING",
    )!;
    expect(generating.billable).toBe(true);
    expect(generating.billableOutcome).toBe("succeeded");

    // Settlement: actual = expected, remainder of the hold returned.
    const reservation = store.reservations.find((r) => r.runId === run.id)!;
    expect(reservation.state).toBe("settled");
    expect(updated.actualChargeUsd).toBe(reservation.settledUsd);
    expect(store.walletBalanceUsd).toBeCloseTo(
      DEMO_WALLET_BALANCE_USD - reservation.settledUsd!,
      2,
    );
  });

  it("produces a deterministic SIMULATED document that enters pending review", async () => {
    const run = await createRun();
    const store = getLocalStore();
    const start = Date.parse(store.runPlans.find((p) => p.runId === run.id)!.startedAt);
    advanceRun(store, run.id, start + TOTAL_PIPELINE_MS + 1);

    const doc = store.documents.find((d) => d.runId === run.id)!;
    expect(doc).toBeDefined();
    expect(doc.title).toContain("SIMULATED");
    expect(doc.sections[0].body).toContain("SIMULATED OUTPUT");
    expect(doc.reviewState).toBe("pending_review"); // never auto-approved (Invariant 16)

    const item = store.reviewItems.find((i) => i.runId === run.id)!;
    expect(item.state).toBe("pending_review");
    expect(item.tier).toBe(run.tier);
  });

  it("advancement is lazy and idempotent", async () => {
    const run = await createRun();
    const store = getLocalStore();
    const start = Date.parse(store.runPlans.find((p) => p.runId === run.id)!.startedAt);

    advanceRun(store, run.id, start + STAGE_DURATIONS_MS.QUEUED + 100);
    expect(store.runs.find((r) => r.id === run.id)!.state).toBe("INGESTING");

    const at = start + TOTAL_PIPELINE_MS + 1;
    advanceRun(store, run.id, at);
    advanceRun(store, run.id, at + 60_000);
    expect(store.documents.filter((d) => d.runId === run.id)).toHaveLength(1);
    expect(store.reviewItems.filter((i) => i.runId === run.id)).toHaveLength(1);
    expect(store.reservations.filter((r) => r.runId === run.id)).toHaveLength(1);
  });

  it("failure before the billable stage releases the full hold", async () => {
    const run = await createRun({ simulate: { failAtStage: "RETRIEVING" } });
    const store = getLocalStore();
    const start = Date.parse(store.runPlans.find((p) => p.runId === run.id)!.startedAt);
    advanceRun(store, run.id, start + TOTAL_PIPELINE_MS + 1);

    const updated = store.runs.find((r) => r.id === run.id)!;
    expect(updated.state).toBe("FAILED");
    expect(updated.actualChargeUsd).toBeUndefined();
    expect(store.reservations.find((r) => r.runId === run.id)!.state).toBe("released");
    expect(store.walletBalanceUsd).toBeCloseTo(DEMO_WALLET_BALANCE_USD, 2);
    expect(store.documents.find((d) => d.runId === run.id)).toBeUndefined();
  });

  it("failure after a successful generation settles the charge", async () => {
    const run = await createRun({ simulate: { failAtStage: "VERIFYING" } });
    const store = getLocalStore();
    const start = Date.parse(store.runPlans.find((p) => p.runId === run.id)!.startedAt);
    advanceRun(store, run.id, start + TOTAL_PIPELINE_MS + 1);

    const updated = store.runs.find((r) => r.id === run.id)!;
    expect(updated.state).toBe("FAILED");
    const reservation = store.reservations.find((r) => r.runId === run.id)!;
    expect(reservation.state).toBe("settled");
    expect(updated.actualChargeUsd).toBe(reservation.settledUsd);
  });

  it("a failed generation is not charged and records the billable outcome", async () => {
    const run = await createRun({ simulate: { failAtStage: "GENERATING" } });
    const store = getLocalStore();
    const start = Date.parse(store.runPlans.find((p) => p.runId === run.id)!.startedAt);
    advanceRun(store, run.id, start + TOTAL_PIPELINE_MS + 1);

    expect(store.runs.find((r) => r.id === run.id)!.state).toBe("FAILED");
    const generating = store.runStages.find(
      (s) => s.runId === run.id && s.stage === "GENERATING",
    )!;
    expect(generating.billableOutcome).toBe("failed");
    expect(store.reservations.find((r) => r.runId === run.id)!.state).toBe("released");
    expect(store.walletBalanceUsd).toBeCloseTo(DEMO_WALLET_BALANCE_USD, 2);
  });

  it("cancel before generation releases the hold in full", async () => {
    const run = await createRun();
    const store = getLocalStore();
    const start = Date.parse(store.runPlans.find((p) => p.runId === run.id)!.startedAt);

    const result = cancelRun(
      store,
      ORG_ID,
      run.id,
      { userId: DEMO_SESSION.userId, role: DEMO_SESSION.role },
      start + STAGE_DURATIONS_MS.QUEUED + 500, // mid-INGESTING
    );
    expect(result.ok).toBe(true);
    const updated = store.runs.find((r) => r.id === run.id)!;
    expect(updated.state).toBe("CANCELLED");
    expect(updated.actualChargeUsd).toBeUndefined();
    expect(store.walletBalanceUsd).toBeCloseTo(DEMO_WALLET_BALANCE_USD, 2);
  });

  it("cancel of a terminal run is refused", async () => {
    const run = await createRun();
    const store = getLocalStore();
    const start = Date.parse(store.runPlans.find((p) => p.runId === run.id)!.startedAt);
    advanceRun(store, run.id, start + TOTAL_PIPELINE_MS + 1);

    const result = cancelRun(
      store,
      ORG_ID,
      run.id,
      { userId: DEMO_SESSION.userId, role: DEMO_SESSION.role },
      start + TOTAL_PIPELINE_MS + 2,
    );
    expect(result.ok).toBe(false);
  });

  it("runs the real deterministic checkers on claim workflows", async () => {
    const run = await createRun({
      matterId: "matter_optical",
      workflowKey: "oa_analysis",
      deliverableType: "Rejection matrix",
    });
    const store = getLocalStore();
    const start = Date.parse(store.runPlans.find((p) => p.runId === run.id)!.startedAt);
    advanceRun(store, run.id, start + TOTAL_PIPELINE_MS + 1);

    const item = store.reviewItems.find((i) => i.runId === run.id)!;
    // The optical seed claims carry a claim-8 dependency mismatch and a
    // missing antecedent — the checkers must catch both.
    expect(item.deterministicCheckFailures).toBeGreaterThanOrEqual(2);
    expect(
      item.unresolvedFlags.some((f) => f.includes("DEP-MISSING-TARGET")),
    ).toBe(true);
    expect(item.unresolvedFlags.some((f) => f.includes("AB-MISSING"))).toBe(true);
  });

  it("blocks drafting runs when the matter has zero approved facts", async () => {
    const store = getLocalStore();
    // Strip approvals from the thermal matter.
    for (const f of store.facts) {
      if (f.matterId === "matter_thermal" && f.provenance === "counsel_reviewed") {
        f.provenance = "needs_confirmation";
      }
    }
    const result = await localAdapters.data.createRun(
      ORG_ID,
      { ...baseRequest, workflowKey: "section_draft", deliverableType: "Background & summary" },
      PRACTITIONER,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("zero counsel-reviewed facts");
  });

  it("refuses runs when the wallet cannot cover the reservation", async () => {
    const store = getLocalStore();
    store.walletBalanceUsd = 0.01;
    const result = await localAdapters.data.createRun(ORG_ID, baseRequest, PRACTITIONER);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("insufficient");
  });

  it("contributor seats cannot invoke generation workflows (Invariant 21)", async () => {
    const result = await localAdapters.data.createRun(ORG_ID, baseRequest, {
      requestedBy: "user_demo_chen",
      role: "contributor",
    });
    expect(result.ok).toBe(false);
  });
});

describe("evidence set, quote verification, and critic independence (FR-5/FR-6, Inv. 13–14)", () => {
  beforeEach(() => resetLocalStore());

  async function completedDocument(request: Partial<RunRequest> = {}) {
    const run = await createRun(request);
    const store = getLocalStore();
    const start = Date.parse(store.runPlans.find((p) => p.runId === run.id)!.startedAt);
    advanceRun(store, run.id, start + TOTAL_PIPELINE_MS + 1_000);
    const doc = store.documents.find((d) => d.runId === run.id);
    if (!doc) throw new Error("no document produced");
    return { run, doc, store };
  }

  it("a completed run carries a real evidence set retrieved from the corpus", async () => {
    const { doc } = await completedDocument();
    const authority = doc.citations.filter((c) => c.kind === "authority");
    expect(authority.length).toBeGreaterThan(0);
    // Quotes are verbatim excerpts, so verification must pass.
    for (const citation of authority) {
      expect(citation.corpusDocumentId).toBeTruthy();
      expect(citation.verification).toBe("verified");
    }
    expect(doc.verificationState).toBe("verified");
  });

  it("every legal proposition is cited or labeled analysis (Invariant 13)", async () => {
    const { doc } = await completedDocument();
    const analysis = doc.citations.filter((c) => c.kind === "analysis");
    expect(analysis.length).toBeGreaterThan(0);
    for (const entry of analysis) {
      expect(entry.quote).toBeUndefined();
      expect(entry.note).toMatch(/labeled analysis/i);
    }
  });

  it("a tampered quote FAILS verification and blocks verified status (Invariant 14)", async () => {
    const { doc, store, run } = await completedDocument({
      simulate: { tamperQuote: true },
    });
    expect(doc.verificationState).toBe("failed");
    const failed = doc.citations.filter((c) => c.verification === "failed");
    expect(failed.length).toBeGreaterThan(0);
    expect(failed[0].note).toMatch(/not found verbatim/i);
    const item = store.reviewItems.find((i) => i.runId === run.id);
    expect(item?.verificationState).toBe("failed");
    expect(item?.unresolvedFlags.join(" ")).toMatch(/verifier failure/i);
  });

  it("skipping quote verification yields unverified — never verified for free", async () => {
    const { doc } = await completedDocument({
      qualityControls: {
        sourceRequired: true,
        secondModelReview: false,
        quoteVerification: false,
      },
    });
    expect(doc.verificationState).toBe("unverified");
  });

  it("the second-model critic differs from the drafting model (FR-6)", async () => {
    const { doc, store, run } = await completedDocument();
    expect(doc.criticModelId).toBeTruthy();
    expect(doc.criticModelId).not.toBe(run.modelId);
    const item = store.reviewItems.find((i) => i.runId === run.id);
    expect(item?.criticModelId).toBe(doc.criticModelId);
    expect(item?.criticReportSummary).toContain(doc.criticModelId!);
  });

  it("no critic model is recorded when second-model review is off", async () => {
    const { doc } = await completedDocument({
      qualityControls: {
        sourceRequired: true,
        secondModelReview: false,
        quoteVerification: true,
      },
    });
    expect(doc.criticModelId).toBeUndefined();
  });

  it("citations record the corpus release used by the run (§6.5 reproducibility)", async () => {
    const { doc, run } = await completedDocument();
    expect(doc.corpusRelease).toBe(run.corpusRelease);
  });
});

describe("deterministic checker stages per workflow (FR-7, §5.1)", () => {
  beforeEach(() => resetLocalStore());

  async function completedDocument(request: Partial<RunRequest> = {}) {
    const run = await createRun(request);
    const store = getLocalStore();
    const start = Date.parse(store.runPlans.find((p) => p.runId === run.id)!.startedAt);
    advanceRun(store, run.id, start + TOTAL_PIPELINE_MS + 1_000);
    const doc = store.documents.find((d) => d.runId === run.id);
    if (!doc) throw new Error("no document produced");
    const item = store.reviewItems.find((i) => i.runId === run.id)!;
    return { run, doc, item, store };
  }

  it("ids_packet runs SB/08 validation over source-derived rows with real findings", async () => {
    const { doc, item } = await completedDocument({
      workflowKey: "ids_packet",
      deliverableType: "IDS packet (SB/08 fields)",
    });
    const checkSection = doc.sections.find((s) => s.heading === "Deterministic check results");
    expect(checkSection).toBeDefined();
    expect(checkSection!.body).toContain("sb08-validation@");
    // Seed prior-art sources lack extracted dates/patentee → genuine findings.
    expect(item.deterministicCheckFailures).toBeGreaterThan(0);
    expect(item.unresolvedFlags.join(" ")).toMatch(/SB08-/);
  });

  it("section_draft passes section-completeness and numeral checks on its own body", async () => {
    const { doc } = await completedDocument({
      workflowKey: "section_draft",
      deliverableType: "Specification sections",
    });
    const headings = doc.sections.map((s) => s.heading);
    for (const required of ["Background", "Summary", "Detailed description", "Abstract"]) {
      expect(headings).toContain(required);
    }
    const checkSection = doc.sections.find((s) => s.heading === "Deterministic check results")!;
    expect(checkSection.body).toContain("section-completeness@");
    expect(checkSection.body).toContain("numeral-consistency@");
    expect(checkSection.body).not.toMatch(/section-completeness@[\d.]+: FAIL/);
  });

  it("oa_response_draft keeps amendments and remarks separate and check-clean", async () => {
    const { doc } = await completedDocument({
      workflowKey: "oa_response_draft",
      deliverableType: "Response shell",
      matterId: "matter_optical",
    });
    const headings = doc.sections.map((s) => s.heading);
    expect(headings).toContain("Amendments to the claims");
    expect(headings).toContain("Remarks");
    const checkSection = doc.sections.find((s) => s.heading === "Deterministic check results")!;
    // SEC-MIXED must not fire on the separated sections.
    expect(checkSection.flags.join(" ")).not.toContain("SEC-MIXED");
  });
});

describe("fact ledger events", () => {
  beforeEach(() => resetLocalStore());

  it("createFact records a created event with user_asserted provenance", async () => {
    const result = await localAdapters.data.createFact(
      ORG_ID,
      "matter_thermal",
      { category: "component", text: "Synthetic test component fact.", sourceIds: [] },
      { userId: "user_demo_chen", role: "contributor" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fact.provenance).toBe("user_asserted");
    const events = await localAdapters.data.listFactEvents(ORG_ID, "matter_thermal");
    expect(events.some((e) => e.factId === result.fact.id && e.eventType === "created")).toBe(true);
  });

  it("approveFact requires facts.approve and records the transition", async () => {
    const denied = await localAdapters.data.approveFact(
      ORG_ID,
      "matter_thermal",
      "fact_t_component_sensor",
      { userId: "user_demo_chen", role: "contributor" },
    );
    expect(denied.ok).toBe(false);

    const approved = await localAdapters.data.approveFact(
      ORG_ID,
      "matter_thermal",
      "fact_t_component_sensor",
      { userId: DEMO_SESSION.userId, role: "practitioner" },
    );
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    expect(approved.fact.provenance).toBe("counsel_reviewed");
    expect(approved.event).toMatchObject({
      eventType: "approved",
      fromProvenance: "needs_confirmation",
      toProvenance: "counsel_reviewed",
    });
  });
});
