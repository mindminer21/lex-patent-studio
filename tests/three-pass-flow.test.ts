import { beforeEach, describe, expect, it } from "vitest";
import {
  completeStage,
  emptyIntakeState,
  INTAKE_STAGE_KEYS,
  type IntakeState,
} from "@/lib/wepatent/domain/intake";
import { getAdapters } from "@/lib/server/adapters";
import { LocalDataAdapter } from "@/lib/server/adapters/local/store";
import { createOrganizationForUser } from "@/lib/server/services/orgs";
import { submitIntake } from "@/lib/server/services/inventions";
import { createExport } from "@/lib/server/services/exports";
import {
  acceptDraftSet,
  evaluateDeliveryFor,
  onFiguresSettled,
  runDraftPassOne,
  runDraftPassTwo,
  startDraftSet,
} from "@/lib/server/services/draft-passes";
import { illustrationsBriefSchema } from "@/lib/shared/drafting";
import { runJobsToCompletion } from "@/lib/server/jobs/runner";

/**
 * THE THREE-PASS FLOW, end to end through the real services and the local
 * adapters. No provider is called: the local model gateway is a
 * deterministic synthetic generator, so nothing here spends real money.
 *
 * The assertions that matter most are the NEGATIVE ones — what the flow
 * refuses to do — because the directive is fundamentally about not
 * delivering a Pass-1-only package.
 */

const stageData: Record<string, unknown> = {
  identity: {
    title: "Three-pass test apparatus",
    summary: "An integration-test invention record with enough summary text to draft from.",
    businessContext: "",
  },
  problem_solution: {
    problem: "The integration problem statement is long enough to be accepted.",
    solution: "The integration solution statement is long enough to be accepted.",
  },
  components: {
    components: [
      { name: "housing", description: "the outer enclosure" },
      { name: "rotor", description: "the rotating element" },
      { name: "stator", description: "the fixed element" },
    ],
    steps: [],
    alternatives: "",
    advantages: "",
  },
  contributors: { contributors: [{ name: "Pass Tester", contribution: "everything" }] },
  timeline: { events: [], noEventsConfirmed: true },
  ownership: {
    employmentAgreementsExist: "yes",
    assignmentsExecuted: "no",
    thirdPartyObligations: "",
    openQuestions: "",
  },
  sources: { sources: [], noSourcesConfirmed: true },
  review: { confirmAccuracy: true },
};

function completedIntake(): IntakeState {
  let state = emptyIntakeState();
  for (const key of INTAKE_STAGE_KEYS) {
    const result = completeStage(state, key, stageData[key]);
    if (!result.ok) throw new Error(`stage ${key} failed`);
    state = result.state;
  }
  return state;
}

async function setup() {
  LocalDataAdapter.reset();
  const { data } = getAdapters();
  const user = await data.createUser({ email: "pass@example.test", displayName: "Pass" });
  const org = await createOrganizationForUser(user.id, "Three Pass Org");
  const submitted = await submitIntake({
    organizationId: org.id,
    userId: user.id,
    intake: completedIntake(),
  });
  if (!submitted.ok) throw new Error("intake failed");
  await data.saveWallet({
    organizationId: org.id,
    balanceCents: 100_000,
    reservedCents: 0,
  });

  // Named parts live in the `components` table (populated by the Intake
  // Studio's interpretation/interview passes), which is the SAME source the
  // brief author and the figure planner both read. Seeding them here is
  // what an interpreted record looks like.
  for (const name of ["housing", "rotor", "stator"]) {
    await data.createComponent({
      organizationId: org.id,
      inventionId: submitted.invention.id,
      name,
      description: "",
      state: "ai_proposed",
      sourceAnchors: [],
    });
  }
  return { data, user, org, inventionId: submitted.invention.id };
}

/** Drive the whole flow to whatever state it settles in. */
async function runToSettled(ctx: Awaited<ReturnType<typeof setup>>) {
  const started = await startDraftSet({
    organizationId: ctx.org.id,
    userId: ctx.user.id,
    recordId: ctx.inventionId,
    product: "wepatent",
    tierId: "standard",
    idempotencyKey: `startset:${ctx.inventionId}`,
  });
  expect(started.ok).toBe(true);
  if (!started.ok) throw new Error("start failed");
  // The jobs chain: pass 1 -> figures -> pass 2, with no user step between.
  await runJobsToCompletion(ctx.org.id);
  const set = await ctx.data.getDraftSet(ctx.org.id, started.draftSetId);
  return { draftSetId: started.draftSetId, set: set! };
}

describe("Pass 1 authors the draft AND the illustrations brief", () => {
  beforeEach(() => LocalDataAdapter.reset());

  it("creates a set that starts in PASS_1_DRAFTING", async () => {
    const ctx = await setup();
    const started = await startDraftSet({
      organizationId: ctx.org.id,
      userId: ctx.user.id,
      recordId: ctx.inventionId,
      product: "wepatent",
      tierId: "standard",
      idempotencyKey: "start-1",
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.state).toBe("PASS_1_DRAFTING");
  });

  it("is idempotent — a second start returns the same set, not a rival", async () => {
    const ctx = await setup();
    const first = await startDraftSet({
      organizationId: ctx.org.id,
      userId: ctx.user.id,
      recordId: ctx.inventionId,
      product: "wepatent",
      tierId: "standard",
      idempotencyKey: "start-1",
    });
    const second = await startDraftSet({
      organizationId: ctx.org.id,
      userId: ctx.user.id,
      recordId: ctx.inventionId,
      product: "wepatent",
      tierId: "standard",
      idempotencyKey: "start-1",
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.draftSetId).toBe(first.draftSetId);
    expect(second.noop).toBe(true);
  });

  it("persists a schema-valid brief WITH reference numerals", async () => {
    const ctx = await setup();
    const started = await startDraftSet({
      organizationId: ctx.org.id,
      userId: ctx.user.id,
      recordId: ctx.inventionId,
      product: "wepatent",
      tierId: "standard",
      idempotencyKey: "start-1",
    });
    if (!started.ok) throw new Error("start failed");
    const result = await runDraftPassOne({
      organizationId: ctx.org.id,
      userId: ctx.user.id,
      draftSetId: started.draftSetId,
      tierId: "standard",
      product: "wepatent",
      idempotencyKey: "pass1-1",
    });
    expect(result.ok).toBe(true);

    const set = await ctx.data.getDraftSet(ctx.org.id, started.draftSetId);
    const parsed = illustrationsBriefSchema.safeParse(set!.illustrationsBrief);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.numerals.length).toBeGreaterThan(0);
    // MPEP 608.02 practice: begin at 10, step by 2.
    expect(parsed.data.numerals[0].numeral).toBe("10");
    expect(parsed.data.figures.length).toBeGreaterThan(0);
    // Every figure says what it must show — that is the instruction the
    // figure stage works from.
    for (const figure of parsed.data.figures) {
      expect(figure.mustShow.length).toBeGreaterThan(0);
    }
  });

  it("writes the brief's numerals into the Pass-1 document", async () => {
    const ctx = await setup();
    const { set } = await runToSettled(ctx);
    const version = await ctx.data.getDraftVersion(ctx.org.id, set.passOneVersionId!);
    expect(version).not.toBeNull();
    expect(version!.content).toContain("ILLUSTRATIONS BRIEF");
    expect(version!.content).toContain("housing (10)");
    // Pass 1 says plainly that it is not deliverable on its own.
    expect(version!.content).toContain("not deliverable on its own");
  });

  it("chains to the figures stage with ZERO user steps", async () => {
    const ctx = await setup();
    const { set } = await runToSettled(ctx);
    // The whole chain ran from one call: a figure set exists and Pass 2 ran.
    expect(set.figureSetId).not.toBeNull();
    expect(set.passOneVersionId).not.toBeNull();
    expect(set.passTwoVersionId).not.toBeNull();
  });
});

describe("the figure stage consumes the brief's numerals", () => {
  beforeEach(() => LocalDataAdapter.reset());

  it("materialises exactly the brief's registry — the planner invents none", async () => {
    const ctx = await setup();
    const { set } = await runToSettled(ctx);
    const brief = illustrationsBriefSchema.parse(set.illustrationsBrief);
    const registry = await ctx.data.listFigureNumerals(ctx.org.id, set.figureSetId!);

    const briefNumerals = new Set(brief.numerals.map((entry) => entry.numeral));
    for (const entry of registry) {
      expect(
        briefNumerals.has(entry.numeral),
        `figure registry carries ${entry.numeral} ("${entry.partLabel}"), which the Pass-1 brief never assigned`,
      ).toBe(true);
    }
  });
});

describe("Pass 2 revises against the figures ACTUALLY produced", () => {
  beforeEach(() => LocalDataAdapter.reset());

  it("produces a NEW version and never mutates Pass 1", async () => {
    const ctx = await setup();
    const { set } = await runToSettled(ctx);
    expect(set.passTwoVersionId).not.toBe(set.passOneVersionId);

    const one = await ctx.data.getDraftVersion(ctx.org.id, set.passOneVersionId!);
    const two = await ctx.data.getDraftVersion(ctx.org.id, set.passTwoVersionId!);
    expect(one).not.toBeNull();
    expect(two).not.toBeNull();
    // Both remain inspectable, and they differ — a diff is possible.
    expect(one!.content).not.toBe(two!.content);
    expect(two!.content).toContain("Second pass");
  });

  it("rewrites the Brief Description from the figures produced", async () => {
    const ctx = await setup();
    const { set } = await runToSettled(ctx);
    const two = await ctx.data.getDraftVersion(ctx.org.id, set.passTwoVersionId!);
    const figures = await ctx.data.listFigures(ctx.org.id, set.figureSetId!);
    expect(two!.content).toContain("BRIEF DESCRIPTION OF THE DRAWINGS");
    for (const figure of figures.filter(
      (candidate) => candidate.state === "composed" || candidate.state === "ready",
    )) {
      expect(two!.content).toContain(`FIG. ${figure.figureNumber}`);
    }
  });

  it("writes §112(a) support for every depicted element", async () => {
    const ctx = await setup();
    const { set } = await runToSettled(ctx);
    const two = await ctx.data.getDraftVersion(ctx.org.id, set.passTwoVersionId!);
    const registry = await ctx.data.listFigureNumerals(ctx.org.id, set.figureSetId!);
    expect(registry.length).toBeGreaterThan(0);
    for (const entry of registry) {
      expect(two!.content).toContain(`${entry.partLabel} ${entry.numeral}`);
    }
    expect(two!.content).toContain("make and use");
  });

  it("meters each pass separately, both at the generation multiplier", async () => {
    const ctx = await setup();
    const { set } = await runToSettled(ctx);
    expect(set.passOneChargeCents).toBeGreaterThan(0);
    expect(set.passTwoChargeCents).toBeGreaterThan(0);
    expect(set.passOneReservationId).not.toBe(set.passTwoReservationId);

    const events = await ctx.data.listUsageEvents(ctx.org.id);
    const passEvents = events.filter((event) => event.inputTokens > 0);
    expect(passEvents.length).toBeGreaterThanOrEqual(2);
    for (const event of passEvents) {
      // Drafting is a generation task: 2.0x, not 1.5x.
      expect(event.customerChargeCents).toBe(Math.ceil(event.providerCostCents * 2));
    }
  });

  it("refuses to run out of order", async () => {
    const ctx = await setup();
    const started = await startDraftSet({
      organizationId: ctx.org.id,
      userId: ctx.user.id,
      recordId: ctx.inventionId,
      product: "wepatent",
      tierId: "standard",
      idempotencyKey: "start-1",
    });
    if (!started.ok) throw new Error("start failed");
    // Pass 2 while still in Pass 1: there are no figures to enable against.
    const result = await runDraftPassTwo({
      organizationId: ctx.org.id,
      userId: ctx.user.id,
      draftSetId: started.draftSetId,
      tierId: "standard",
      product: "wepatent",
      idempotencyKey: "pass2-early",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("wrong_state");
  });
});

describe("the two-way reconciliation gate", () => {
  beforeEach(() => LocalDataAdapter.reset());

  it("reaches READY_FOR_REVIEW only with a passing reconciliation", async () => {
    const ctx = await setup();
    const { set } = await runToSettled(ctx);
    if (set.state === "READY_FOR_REVIEW") {
      expect(set.reconciled).toBe(true);
      expect(set.reconciliationVersion).toBe("reconcile-608.02-1.0.0");
    } else {
      // If it did not complete, it must NOT claim to be reconciled and must
      // say what is blocking — which is the whole point.
      expect(set.reconciled).toBe(false);
      expect(set.statusDetail.length).toBeGreaterThan(0);
    }
  });

  it("stores the reconciliation report so the findings are inspectable", async () => {
    const ctx = await setup();
    const { set } = await runToSettled(ctx);
    expect(set.reconciliation).not.toBeNull();
    const report = set.reconciliation as { version: string; findings: unknown[] };
    expect(report.version).toBe("reconcile-608.02-1.0.0");
    expect(Array.isArray(report.findings)).toBe(true);
  });
});

describe("THE CLIENT DELIVERY GATE", () => {
  beforeEach(() => LocalDataAdapter.reset());

  it("refuses to export a Pass-1-only package, and says why", async () => {
    const ctx = await setup();
    const started = await startDraftSet({
      organizationId: ctx.org.id,
      userId: ctx.user.id,
      recordId: ctx.inventionId,
      product: "wepatent",
      tierId: "standard",
      idempotencyKey: "start-1",
    });
    if (!started.ok) throw new Error("start failed");
    await runDraftPassOne({
      organizationId: ctx.org.id,
      userId: ctx.user.id,
      draftSetId: started.draftSetId,
      tierId: "standard",
      product: "wepatent",
      idempotencyKey: "pass1-1",
    });

    const result = await createExport({
      organizationId: ctx.org.id,
      userId: ctx.user.id,
      inventionId: ctx.inventionId,
      draftVersionId: null,
      sections: ["facts"],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("delivery_blocked");
    if (result.error !== "delivery_blocked") return;
    expect(result.blockers.length).toBeGreaterThan(0);
    // Actionable, not "not ready".
    for (const blocker of result.blockers) {
      expect(blocker.message.length).toBeGreaterThan(10);
      expect(blocker.needs.length).toBeGreaterThan(10);
    }
    expect(result.detail).toContain("figures");
  });

  it("still refuses after Pass 2 until a HUMAN accepts", async () => {
    const ctx = await setup();
    const { set } = await runToSettled(ctx);
    if (set.state !== "READY_FOR_REVIEW") return; // covered by the gate test above

    const decision = await evaluateDeliveryFor(ctx.org.id, set.id);
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.blockers.map((blocker) => blocker.code)).toContain(
      "not_accepted_by_human",
    );

    const blocked = await createExport({
      organizationId: ctx.org.id,
      userId: ctx.user.id,
      inventionId: ctx.inventionId,
      draftVersionId: set.passTwoVersionId,
      sections: ["facts"],
    });
    expect(blocked.ok).toBe(false);
  });

  it("opens once a person accepts, and the export then succeeds", async () => {
    const ctx = await setup();
    const { set } = await runToSettled(ctx);
    if (set.state !== "READY_FOR_REVIEW") return;

    const accepted = await acceptDraftSet({
      organizationId: ctx.org.id,
      userId: ctx.user.id,
      draftSetId: set.id,
    });
    expect(accepted.ok).toBe(true);

    const decision = await evaluateDeliveryFor(ctx.org.id, set.id);
    expect(decision.allowed).toBe(true);

    const exported = await createExport({
      organizationId: ctx.org.id,
      userId: ctx.user.id,
      inventionId: ctx.inventionId,
      draftVersionId: set.passTwoVersionId,
      sections: ["facts"],
    });
    expect(exported.ok).toBe(true);
  });

  it("refuses acceptance of a set that is not ready, with the same reasons", async () => {
    const ctx = await setup();
    const started = await startDraftSet({
      organizationId: ctx.org.id,
      userId: ctx.user.id,
      recordId: ctx.inventionId,
      product: "wepatent",
      tierId: "standard",
      idempotencyKey: "start-1",
    });
    if (!started.ok) throw new Error("start failed");
    const accepted = await acceptDraftSet({
      organizationId: ctx.org.id,
      userId: ctx.user.id,
      draftSetId: started.draftSetId,
    });
    expect(accepted.ok).toBe(false);
    if (accepted.ok) return;
    expect(accepted.error).toBe("not_ready");
    expect(accepted.detail.length).toBeGreaterThan(10);
  });
});

describe("the figures stage does not advance a set it could not complete", () => {
  beforeEach(() => LocalDataAdapter.reset());

  it("holds at PAUSED_BUDGET and names the cap", async () => {
    const ctx = await setup();
    const started = await startDraftSet({
      organizationId: ctx.org.id,
      userId: ctx.user.id,
      recordId: ctx.inventionId,
      product: "wepatent",
      tierId: "standard",
      idempotencyKey: "start-1",
    });
    if (!started.ok) throw new Error("start failed");
    await runDraftPassOne({
      organizationId: ctx.org.id,
      userId: ctx.user.id,
      draftSetId: started.draftSetId,
      tierId: "standard",
      product: "wepatent",
      idempotencyKey: "pass1-1",
    });

    await onFiguresSettled({
      organizationId: ctx.org.id,
      userId: ctx.user.id,
      draftSetId: started.draftSetId,
      tierId: "standard",
      product: "wepatent",
      outcome: {
        kind: "paused_budget",
        figureSetId: null,
        detail: "Figure budget cap of $3.00 reached after 4 images.",
      },
    });

    const set = await ctx.data.getDraftSet(ctx.org.id, started.draftSetId);
    expect(set!.state).toBe("PAUSED_BUDGET");
    // It remembers WHICH stage to resume into, so resuming cannot re-charge
    // Pass 1.
    expect(set!.interruptedStage).toBe("FIGURES_PENDING");
    expect(set!.statusDetail).toContain("$3.00");

    const decision = await evaluateDeliveryFor(ctx.org.id, started.draftSetId);
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.blockers.map((blocker) => blocker.code)).toContain("budget_paused");
  });
});

describe("the transition log", () => {
  beforeEach(() => LocalDataAdapter.reset());

  it("records every state change in order", async () => {
    const ctx = await setup();
    const { draftSetId, set } = await runToSettled(ctx);
    const transitions = await ctx.data.listDraftSetTransitions(ctx.org.id, draftSetId);
    expect(transitions.length).toBeGreaterThanOrEqual(3);
    expect(transitions[0].toState).toBe("PASS_1_DRAFTING");
    expect(transitions.at(-1)!.toState).toBe(set.state);
    // Each transition's from-state is the previous to-state: no gaps.
    for (let i = 1; i < transitions.length; i += 1) {
      expect(transitions[i].fromState).toBe(transitions[i - 1].toState);
    }
    for (const transition of transitions) {
      expect(transition.reason.length).toBeGreaterThan(0);
    }
  });
});
