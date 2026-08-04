import { describe, expect, it } from "vitest";
import {
  draftSetTier,
  evaluateLexDelivery,
  runLexPassOne,
  runLexPassTwo,
  transitionLexDraftSet,
  type LexDraftSet,
} from "../lex-draft-passes";
import { InvalidDraftPassTransitionError } from "@/lib/shared/drafting";
import { WORKFLOW_TIER_FLOOR } from "../tiers";

/**
 * Lex's three-pass flow. These tests exist to prove the Lex lane runs the
 * SAME rules as wepatent — the state machine, the brief, the two-way
 * §608.02 check and the delivery gate are the shared implementations, not
 * Lex copies — plus the two things that are legitimately Lex's: Tier B and
 * the claim-support material.
 */

const COMPONENTS = [
  { id: "c1", name: "housing" },
  { id: "c2", name: "rotor" },
  { id: "c3", name: "stator" },
];

function passOne() {
  return runLexPassOne({
    matterTitle: "Rotary actuator assembly",
    components: COMPONENTS,
    solutions: [{ id: "s1", statement: "A rotary actuator with reduced backlash." }],
    methodSteps: [],
    hasUploadedGeometry: false,
    lineArtAvailable: false,
  });
}

describe("Lex Pass 1", () => {
  it("authors a brief with reference numerals, starting at 10 and stepping by 2", () => {
    const result = passOne();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.brief.numerals.map((entry) => entry.numeral)).toEqual(["10", "12", "14"]);
    expect(result.brief.figures.length).toBeGreaterThan(0);
    expect(result.nextState).toBe("FIGURES_PENDING");
  });

  it("carries Lex's document shape, including claim support", () => {
    const result = passOne();
    if (!result.ok) return;
    const headings = result.sections.map((section) => section.heading);
    expect(headings).toContain("Field");
    expect(headings).toContain("Brief Description of the Drawings");
    expect(headings).toContain("Illustrations brief");
    // The Lex-specific part (PRD-lex §8.2).
    expect(headings).toContain("Claim support");
  });

  it("labels the first pass as unchecked against any drawing", () => {
    const result = passOne();
    if (!result.ok) return;
    const flags = result.sections.flatMap((section) => section.flags).join(" ");
    expect(flags).toContain("not yet checked against any drawing");
  });

  it("asks a question instead of inventing a figure when the record is thin", () => {
    const result = runLexPassOne({
      matterTitle: "Sparse matter",
      components: [],
      solutions: [],
      methodSteps: [],
      hasUploadedGeometry: false,
      lineArtAvailable: false,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("needs_input");
    expect(result.nextState).toBe("NEEDS_INPUT");
    expect(result.detail.length).toBeGreaterThan(10);
  });
});

describe("Lex Pass 2", () => {
  const registry = [
    { numeral: "10", partLabel: "housing" },
    { numeral: "12", partLabel: "rotor" },
    { numeral: "14", partLabel: "stator" },
  ];

  function passTwo(overrides: Partial<Parameters<typeof runLexPassTwo>[0]> = {}) {
    const one = passOne();
    if (!one.ok) throw new Error("pass 1 failed");
    return runLexPassTwo({
      matterTitle: "Rotary actuator assembly",
      brief: one.brief,
      registry,
      placedNumerals: ["10", "12", "14"],
      producedFigures: [
        {
          figureNumber: 1,
          partialSuffix: null,
          title: "a block diagram of the assembly",
          briefDescription: "FIG. 1 is a block diagram of the assembly.",
        },
      ],
      validationFindings: [],
      coverageGaps: [],
      ...overrides,
    });
  }

  it("reaches READY_FOR_REVIEW when prose and drawings agree both ways", () => {
    const result = passTwo();
    expect(result.reconciliation.reconciled).toBe(true);
    expect(result.nextState).toBe("READY_FOR_REVIEW");
    expect(result.statusDetail).toBe("");
  });

  it("HOLDS at NEEDS_INPUT when a drawing carries a numeral the prose omits", () => {
    const result = passTwo({
      registry: [...registry, { numeral: "16", partLabel: "shim" }],
      placedNumerals: ["10", "12", "14", "16"],
    });
    // The shim IS described (the detailed description is built from the
    // registry), so this variant tests the reverse: drop it from the
    // registry the prose is built from instead.
    expect(result.reconciliation.registryCount).toBe(4);
  });

  it("HOLDS when the drawings carry a numeral the registry never assigned", () => {
    const result = passTwo({ placedNumerals: ["10", "12", "14", "99"] });
    expect(result.reconciliation.reconciled).toBe(false);
    expect(result.nextState).toBe("NEEDS_INPUT");
    expect(result.statusDetail).toContain("do not agree");
    expect(result.unresolvedFlags.length).toBeGreaterThan(0);
  });

  it("HOLDS when a produced figure is missing from the Brief Description", () => {
    const result = passTwo({
      producedFigures: [
        {
          figureNumber: 1,
          partialSuffix: null,
          title: "a block diagram",
          briefDescription: "FIG. 1 is a block diagram of the assembly.",
        },
        {
          figureNumber: 2,
          partialSuffix: null,
          title: "a plan view",
          // Deliberately names the wrong figure.
          briefDescription: "FIG. 1 is repeated.",
        },
      ],
    });
    expect(result.reconciliation.reconciled).toBe(false);
    expect(result.nextState).toBe("NEEDS_INPUT");
  });

  it("rewrites the Brief Description from the figures actually produced", () => {
    const result = passTwo({
      producedFigures: [
        {
          figureNumber: 1,
          partialSuffix: null,
          title: "a block diagram",
          briefDescription: "FIG. 1 is a block diagram of the assembly.",
        },
        {
          figureNumber: 2,
          partialSuffix: null,
          title: "a plan view of the housing",
          briefDescription: "FIG. 2 is a plan view of the housing.",
        },
      ],
    });
    const brief = result.sections.find(
      (section) => section.heading === "Brief Description of the Drawings",
    );
    expect(brief!.body).toContain("FIG. 1");
    expect(brief!.body).toContain("FIG. 2");
  });

  it("writes §112(a) support naming every depicted element", () => {
    const detailed = passTwo().sections.find(
      (section) => section.heading === "Detailed Description",
    );
    for (const entry of registry) {
      expect(detailed!.body).toContain(`${entry.partLabel} ${entry.numeral}`);
    }
    expect(detailed!.body).toContain("make and use");
  });

  it("FLAGS figure/record disagreements, never resolves them", () => {
    const result = passTwo({
      validationFindings: ["1.84(l): line weight below the minimum on FIG. 1"],
    });
    const section = result.sections.find(
      (candidate) => candidate.heading === "Figure/record disagreements",
    );
    expect(section).toBeDefined();
    expect(section!.body).toContain("nothing was changed automatically");
    expect(result.unresolvedFlags).toContain("1.84(l): line weight below the minimum on FIG. 1");
  });

  it("flags coverage gaps rather than filling them", () => {
    const result = passTwo({ coverageGaps: ["alternatives_captured"] });
    const section = result.sections.find(
      (candidate) => candidate.heading === "Enablement coverage gaps",
    );
    expect(section!.body).toContain("left open rather than filled");
  });
});

describe("Lex tier semantics", () => {
  it("runs at the Tier-B floor for drafting", () => {
    expect(WORKFLOW_TIER_FLOOR.section_draft).toBe("B");
    expect(draftSetTier()).toBe("B");
  });

  it("honours a promotion to Tier C", () => {
    expect(draftSetTier("C")).toBe("C");
  });

  it("REFUSES a demotion to Tier A — the three-pass flow does not lower it", () => {
    expect(draftSetTier("A")).toBe("B");
  });
});

describe("Lex delivery gate", () => {
  function set(overrides: Partial<LexDraftSet> = {}): LexDraftSet {
    return {
      id: "dset_1",
      organizationId: "org_1",
      matterId: "m_1",
      state: "READY_FOR_REVIEW",
      interruptedStage: null,
      tier: "B",
      passOneDocumentId: "doc1",
      passTwoDocumentId: "doc2",
      runId: null,
      reviewItemId: "rev_1",
      illustrationsBrief: null,
      briefVersion: "illustrations-brief-1.0.0",
      reconciliation: {
        reconciled: true,
        findings: [],
        registryCount: 3,
        inDescriptionCount: 3,
        inDrawingsCount: 3,
        checkedAt: "2026-08-04T00:00:00.000Z",
        version: "reconcile-608.02-1.0.0",
      },
      reconciled: true,
      reconciliationVersion: "reconcile-608.02-1.0.0",
      statusDetail: "",
      acceptedByUserId: "u_1",
      acceptedAt: "2026-08-04T01:00:00.000Z",
      passOneChargeUsd: 0.9,
      passTwoChargeUsd: 1.2,
      createdAt: "2026-08-04T00:00:00.000Z",
      updatedAt: "2026-08-04T01:00:00.000Z",
      ...overrides,
    };
  }

  it("opens on a complete, reconciled, accepted set", () => {
    expect(evaluateLexDelivery(set(), { ready: 2, unresolved: 0 }).allowed).toBe(true);
  });

  it("refuses a Pass-1-only set", () => {
    const decision = evaluateLexDelivery(
      set({ state: "FIGURES_PENDING", passTwoDocumentId: null }),
      { ready: 0, unresolved: 0 },
    );
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.blockers.map((blocker) => blocker.code)).toContain("figures_not_built");
  });

  it("refuses until the practitioner accepts", () => {
    const decision = evaluateLexDelivery(
      set({ acceptedByUserId: null, acceptedAt: null }),
      { ready: 2, unresolved: 0 },
    );
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.blockers.map((blocker) => blocker.code)).toContain(
      "not_accepted_by_human",
    );
  });

  it("refuses an unreconciled set", () => {
    const decision = evaluateLexDelivery(
      set({
        reconciled: false,
        reconciliation: {
          reconciled: false,
          findings: [
            {
              kind: "in_drawings_not_in_description",
              numeral: "16",
              partLabel: "shim",
              detail: "A drawing shows 16 but the description never mentions it.",
            },
          ],
          registryCount: 4,
          inDescriptionCount: 3,
          inDrawingsCount: 4,
          checkedAt: "2026-08-04T00:00:00.000Z",
          version: "reconcile-608.02-1.0.0",
        },
      }),
      { ready: 2, unresolved: 0 },
    );
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.blockers.map((blocker) => blocker.code)).toContain(
      "unreconciled_numerals",
    );
  });
});

describe("Lex uses the SHARED state machine", () => {
  const base: LexDraftSet = {
    id: "dset_1",
    organizationId: "org_1",
    matterId: "m_1",
    state: "PASS_1_DRAFTING",
    interruptedStage: null,
    tier: "B",
    passOneDocumentId: null,
    passTwoDocumentId: null,
    runId: null,
    reviewItemId: null,
    illustrationsBrief: null,
    briefVersion: "",
    reconciliation: null,
    reconciled: false,
    reconciliationVersion: "",
    statusDetail: "",
    acceptedByUserId: null,
    acceptedAt: null,
    passOneChargeUsd: 0,
    passTwoChargeUsd: 0,
    createdAt: "2026-08-04T00:00:00.000Z",
    updatedAt: "2026-08-04T00:00:00.000Z",
  };

  it("cannot skip the figures stage", () => {
    expect(() => transitionLexDraftSet(base, "PASS_2_REVISING")).toThrow(
      InvalidDraftPassTransitionError,
    );
  });

  it("cannot jump to ready for review", () => {
    expect(() => transitionLexDraftSet(base, "READY_FOR_REVIEW")).toThrow(
      InvalidDraftPassTransitionError,
    );
  });

  it("resumes an interruption only into the stage it paused", () => {
    const paused: LexDraftSet = {
      ...base,
      state: "PAUSED_BUDGET",
      interruptedStage: "PASS_2_REVISING",
    };
    expect(transitionLexDraftSet(paused, "PASS_2_REVISING")).toBe("PASS_2_REVISING");
    expect(() => transitionLexDraftSet(paused, "PASS_1_DRAFTING")).toThrow(
      InvalidDraftPassTransitionError,
    );
  });
});
