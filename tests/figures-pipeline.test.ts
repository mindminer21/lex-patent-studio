import { beforeEach, describe, expect, it } from "vitest";
import { getAdapters } from "@/lib/server/adapters";
import { LocalDataAdapter } from "@/lib/server/adapters/local/store";
import { createOrganizationForUser } from "@/lib/server/services/orgs";
import {
  estimateFigureRun,
  figureSpendTodayCents,
  getLatestFigureSetView,
  hashPlannerInput,
  runFigurePipeline,
  acceptFigureSet,
  renameFigurePart,
} from "@/lib/server/services/figures";
import { planFigureSet, type PlannerInput } from "@/lib/server/figures/planner";
import { markupMultiplierFor } from "@/lib/wepatent/domain/markup";
import { createExport } from "@/lib/server/services/exports";
import type { Id } from "@/lib/server/adapters/types";

/**
 * Pipeline-level behavior against the local adapters and synthetic data:
 * the money path, the caps, the no-op, retry deduplication, and the
 * ai_proposed → user_confirmed transition that ONLY a person can trigger.
 */

async function setup() {
  LocalDataAdapter.reset();
  const { data } = getAdapters();
  const user = await data.createUser({ email: "figures@example.test", displayName: "Fig" });
  const org = await createOrganizationForUser(user.id, "Figures Test Org");
  const invention = await data.createInvention({
    organizationId: org.id,
    title: "Adaptive pressure regulator",
    summary: "A regulator that adapts to inlet pressure.",
    businessContext: "",
    problem: "Existing regulators overshoot.",
    solution: "Close the loop on measured pressure.",
    synthetic: true,
  });
  await data.saveWallet({ organizationId: org.id, balanceCents: 10_000, reservedCents: 0 });
  return { data, user, org, invention };
}

async function seedComponents(data: ReturnType<typeof getAdapters>["data"], organizationId: Id, inventionId: Id) {
  const names = ["intake manifold", "controller", "actuator"];
  const ids: Id[] = [];
  for (const name of names) {
    const component = await data.createComponent({
      organizationId,
      inventionId,
      name,
      description: "",
      state: "ai_proposed",
      sourceAnchors: [],
    });
    ids.push(component.id);
  }
  return ids;
}

async function seedDraft(
  data: ReturnType<typeof getAdapters>["data"],
  organizationId: Id,
  inventionId: Id,
  content: string,
) {
  const draft = await data.createDraft({
    organizationId,
    inventionId,
    workflow: "invention_disclosure_summary",
    title: "Working draft",
  });
  return data.createDraftVersion({
    organizationId,
    draftId: draft.id,
    content,
    modelId: "wepatent-local-standard",
    rateVersion: "2026-07-01.local.standard",
    estimateCustomerHighCents: 0,
    actualProviderCostCents: 0,
    actualCustomerChargeCents: 0,
    unresolvedFactCount: 0,
    sourceStatusSummary: "",
    reservationId: null,
  });
}

const DRAFT_TEXT = [
  "The assembly includes an intake manifold 10 coupled to a controller 12.",
  "The controller 12 drives an actuator 14.",
  "",
  "## Method",
  "1. Measure the inlet pressure.",
  "2. Actuate the valve when a threshold is exceeded.",
].join("\n");

describe("figure pipeline (local adapters, synthetic data)", () => {
  let ctx: Awaited<ReturnType<typeof setup>>;

  beforeEach(async () => {
    ctx = await setup();
  });

  it("produces a figure set with sheets, numerals and validations", async () => {
    await seedComponents(ctx.data, ctx.org.id, ctx.invention.id);
    const version = await seedDraft(ctx.data, ctx.org.id, ctx.invention.id, DRAFT_TEXT);

    const result = await runFigurePipeline({
      organizationId: ctx.org.id,
      userId: ctx.user.id,
      inventionId: ctx.invention.id,
      draftVersionId: version.id,
      idempotencyKey: "figures:run-1",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const view = await getLatestFigureSetView(ctx.org.id, ctx.invention.id);
    expect(view.set?.state).toBe("ready");
    expect(view.figures.length).toBeGreaterThan(0);
    expect(view.sheets.length).toBeGreaterThan(0);
    // Components first (10, 12, 14), then the method steps the flowchart
    // draws (16, 18) — every box carries a reference character on a lead
    // line, per MPEP 608.02 flowchart practice.
    expect(view.numerals.map((entry) => entry.numeral)).toEqual(["10", "12", "14", "16", "18"]);
    expect(view.validations.length).toBeGreaterThan(20);
    for (const sheet of view.sheets) {
      expect(sheet.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
      const bytes = await getAdapters().storage.get(sheet.storagePath);
      expect(bytes).not.toBeNull();
      expect(Buffer.from(bytes!).toString("utf8")).toContain("<svg");
    }
  });

  it("writes every figure as ai_proposed and never as confirmed", async () => {
    await seedComponents(ctx.data, ctx.org.id, ctx.invention.id);
    await seedDraft(ctx.data, ctx.org.id, ctx.invention.id, DRAFT_TEXT);
    await runFigurePipeline({
      organizationId: ctx.org.id,
      userId: ctx.user.id,
      inventionId: ctx.invention.id,
      draftVersionId: null,
      idempotencyKey: "figures:ai-state",
    });
    const view = await getLatestFigureSetView(ctx.org.id, ctx.invention.id);
    expect(view.set?.aiState).toBe("ai_proposed");
    expect(view.figures.every((figure) => figure.aiState === "ai_proposed")).toBe(true);
  });

  it("only a person can move a set to user_confirmed", async () => {
    await seedComponents(ctx.data, ctx.org.id, ctx.invention.id);
    await seedDraft(ctx.data, ctx.org.id, ctx.invention.id, DRAFT_TEXT);
    await runFigurePipeline({
      organizationId: ctx.org.id,
      userId: ctx.user.id,
      inventionId: ctx.invention.id,
      draftVersionId: null,
      idempotencyKey: "figures:accept",
    });
    const before = await getLatestFigureSetView(ctx.org.id, ctx.invention.id);
    expect(before.set?.aiState).toBe("ai_proposed");

    await acceptFigureSet({
      organizationId: ctx.org.id,
      userId: ctx.user.id,
      figureSetId: before.set!.id,
    });
    const after = await getLatestFigureSetView(ctx.org.id, ctx.invention.id);
    expect(after.set?.aiState).toBe("user_confirmed");

    const audit = await ctx.data.listAuditEvents(ctx.org.id);
    expect(audit.some((event) => event.action === "figures.accepted")).toBe(true);
  });

  it("renaming a part updates every view at once and marks the set user_edited", async () => {
    await seedComponents(ctx.data, ctx.org.id, ctx.invention.id);
    await seedDraft(ctx.data, ctx.org.id, ctx.invention.id, DRAFT_TEXT);
    await runFigurePipeline({
      organizationId: ctx.org.id,
      userId: ctx.user.id,
      inventionId: ctx.invention.id,
      draftVersionId: null,
      idempotencyKey: "figures:rename",
    });
    const view = await getLatestFigureSetView(ctx.org.id, ctx.invention.id);
    const target = view.numerals.find((entry) => entry.numeral === "12")!;

    await renameFigurePart({
      organizationId: ctx.org.id,
      userId: ctx.user.id,
      numeralId: target.id,
      partLabel: "electronic control unit",
    });

    const after = await getLatestFigureSetView(ctx.org.id, ctx.invention.id);
    expect(after.numerals.find((entry) => entry.numeral === "12")?.partLabel).toBe(
      "electronic control unit",
    );
    expect(after.set?.aiState).toBe("user_edited");
    // The numeral itself never changes, which is exactly why one edit
    // propagates: the drawings reference "12", not the label.
    expect(after.numerals.map((entry) => entry.numeral)).toEqual([
      "10",
      "12",
      "14",
      "16",
      "18",
    ]);
  });

  it("is a no-op on an unchanged record: same set, nothing spent", async () => {
    await seedComponents(ctx.data, ctx.org.id, ctx.invention.id);
    await seedDraft(ctx.data, ctx.org.id, ctx.invention.id, DRAFT_TEXT);
    const first = await runFigurePipeline({
      organizationId: ctx.org.id,
      userId: ctx.user.id,
      inventionId: ctx.invention.id,
      draftVersionId: null,
      idempotencyKey: "figures:noop-1",
    });
    expect(first.ok).toBe(true);
    const walletAfterFirst = await ctx.data.getWallet(ctx.org.id);

    const second = await runFigurePipeline({
      organizationId: ctx.org.id,
      userId: ctx.user.id,
      inventionId: ctx.invention.id,
      draftVersionId: null,
      idempotencyKey: "figures:noop-2",
    });
    expect(second.ok).toBe(true);
    if (!second.ok || !first.ok) return;
    expect(second.noop).toBe(true);
    expect(second.figureSetId).toBe(first.figureSetId);

    const sets = await ctx.data.listFigureSets(ctx.org.id, ctx.invention.id);
    expect(sets).toHaveLength(1);
    expect((await ctx.data.getWallet(ctx.org.id))?.balanceCents).toBe(
      walletAfterFirst?.balanceCents,
    );
  });

  it("re-plans when the record materially changes", async () => {
    await seedComponents(ctx.data, ctx.org.id, ctx.invention.id);
    await seedDraft(ctx.data, ctx.org.id, ctx.invention.id, DRAFT_TEXT);
    const first = await runFigurePipeline({
      organizationId: ctx.org.id,
      userId: ctx.user.id,
      inventionId: ctx.invention.id,
      draftVersionId: null,
      idempotencyKey: "figures:change-1",
    });
    await ctx.data.createComponent({
      organizationId: ctx.org.id,
      inventionId: ctx.invention.id,
      name: "pressure sensor",
      description: "",
      state: "ai_proposed",
      sourceAnchors: [],
    });
    const second = await runFigurePipeline({
      organizationId: ctx.org.id,
      userId: ctx.user.id,
      inventionId: ctx.invention.id,
      draftVersionId: null,
      idempotencyKey: "figures:change-2",
    });
    expect(second.ok).toBe(true);
    if (!second.ok || !first.ok) return;
    expect(second.noop).toBe(false);
    expect(second.figureSetId).not.toBe(first.figureSetId);

    // The new part gets a NEW numeral; the existing ones are untouched.
    const view = await getLatestFigureSetView(ctx.org.id, ctx.invention.id);
    expect(view.numerals.map((entry) => entry.numeral)).toEqual([
      "10",
      "12",
      "14",
      "16",
      "18",
      "20",
    ]);
    expect(view.numerals.find((entry) => entry.numeral === "10")?.partLabel).toBe(
      "intake manifold",
    );
  });

  it("says so honestly when there is nothing in the record to draw", async () => {
    const result = await runFigurePipeline({
      organizationId: ctx.org.id,
      userId: ctx.user.id,
      inventionId: ctx.invention.id,
      draftVersionId: null,
      idempotencyKey: "figures:empty",
    });
    expect(result.ok).toBe(true);
    const view = await getLatestFigureSetView(ctx.org.id, ctx.invention.id);
    expect(view.set?.state).toBe("needs_input");
    expect(view.figures).toHaveLength(0);
  });

  it("refuses an unknown invention", async () => {
    const result = await runFigurePipeline({
      organizationId: ctx.org.id,
      userId: ctx.user.id,
      inventionId: "00000000-0000-4000-8000-000000000000",
      draftVersionId: null,
      idempotencyKey: "figures:missing",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invention_not_found");
  });

  it("charges nothing for a fully deterministic set", async () => {
    await seedComponents(ctx.data, ctx.org.id, ctx.invention.id);
    await seedDraft(ctx.data, ctx.org.id, ctx.invention.id, DRAFT_TEXT);
    const before = await ctx.data.getWallet(ctx.org.id);
    await runFigurePipeline({
      organizationId: ctx.org.id,
      userId: ctx.user.id,
      inventionId: ctx.invention.id,
      draftVersionId: null,
      idempotencyKey: "figures:free",
    });
    const after = await ctx.data.getWallet(ctx.org.id);
    expect(after?.balanceCents).toBe(before?.balanceCents);
    expect(after?.reservedCents).toBe(0);
    expect(await figureSpendTodayCents(ctx.org.id)).toBe(0);
  });

  it("carries the figures into the counsel export with an honest status", async () => {
    await seedComponents(ctx.data, ctx.org.id, ctx.invention.id);
    await seedDraft(ctx.data, ctx.org.id, ctx.invention.id, DRAFT_TEXT);
    await runFigurePipeline({
      organizationId: ctx.org.id,
      userId: ctx.user.id,
      inventionId: ctx.invention.id,
      draftVersionId: null,
      idempotencyKey: "figures:export",
    });
    const exported = await createExport({
      organizationId: ctx.org.id,
      userId: ctx.user.id,
      inventionId: ctx.invention.id,
      draftVersionId: null,
      sections: ["facts", "sources"],
    });
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(exported.record.figureSetId).toBeTruthy();
    expect(exported.record.manifest.figureCount).toBeGreaterThan(0);
    expect(exported.record.manifest.figureSheetCount).toBeGreaterThan(0);
    expect(exported.record.manifest.figureRulesVersion).toMatch(/^uspto-drawings-/);
    expect(exported.record.manifest.figureBriefDescription?.length).toBeGreaterThan(0);
    // The exported status must never claim acceptance.
    expect(exported.record.manifest.figureValidationStatus).toMatch(/mechanical formality/i);
  });
});

describe("figure cost model", () => {
  function plannedSpec(imageFigures: number) {
    const input: PlannerInput = {
      inventionTitle: "Test",
      draftText: "",
      components: [],
      solutions: [],
      associations: [],
      sources: Array.from({ length: imageFigures }, (_, index) => ({
        id: `s${index}`,
        name: `photo-${index}.png`,
        sourceClass: "image" as const,
        status: "extracted",
      })),
      existingNumerals: [],
      sheetSize: "a4",
      lineArtAvailable: true,
      designPatent: false,
      inputHash: "h",
    };
    return planFigureSet(input).spec;
  }

  it("prices images AND the diagram prose at the 2.0 generation multiplier", () => {
    const estimate = estimateFigureRun(plannedSpec(2));
    expect(estimate.imageMarkupMultiplier).toBe(2.0);
    // Deterministic-diagram planning AUTHORS TEXT (figure titles, Brief
    // Description sentences) that ships to the customer, so it is a
    // generation task too (Jeff's directive, 2026-08-04).
    expect(estimate.textMarkupMultiplier).toBe(2.0);
    expect(estimate.imagesLow).toBe(2);
    // The high bound assumes one regenerate per figure through the hygiene
    // gate, and that ceiling is what gets reserved.
    expect(estimate.imagesHigh).toBe(4);
    expect(estimate.estimate.customerHighCents).toBe(
      estimate.estimate.providerHighCents * 2,
    );
    expect(estimate.free).toBe(false);
  });

  it("is free when the whole set is deterministic", () => {
    const estimate = estimateFigureRun(plannedSpec(0));
    expect(estimate.free).toBe(true);
    expect(estimate.estimate.customerHighCents).toBe(0);
  });

  it("uses the same multiplier the public catalog publishes for generation", () => {
    expect(estimateFigureRun(plannedSpec(1)).imageMarkupMultiplier).toBe(
      markupMultiplierFor("generation"),
    );
    expect(estimateFigureRun(plannedSpec(1)).imageMarkupMultiplier).toBe(2.0);
  });
});

describe("planner input hashing", () => {
  const base = {
    inventionTitle: "T",
    draftText: "text",
    components: [{ id: "c1", name: "a", description: "", state: "ai_proposed" }],
    solutions: [],
    associations: [],
    sources: [],
    existingNumerals: [],
    sheetSize: "a4" as const,
    lineArtAvailable: false,
    designPatent: false,
  };

  it("is stable for identical input", () => {
    expect(hashPlannerInput(base)).toBe(hashPlannerInput({ ...base }));
  });

  it("changes when the record changes", () => {
    expect(hashPlannerInput(base)).not.toBe(
      hashPlannerInput({ ...base, draftText: "different" }),
    );
    expect(hashPlannerInput(base)).not.toBe(
      hashPlannerInput({
        ...base,
        components: [...base.components, { id: "c2", name: "b", description: "", state: "x" }],
      }),
    );
  });

  it("changes when the provider availability changes, so a newly enabled model re-plans", () => {
    expect(hashPlannerInput(base)).not.toBe(
      hashPlannerInput({ ...base, lineArtAvailable: true }),
    );
  });

  it("ignores the carried-forward numeral registry, which is an output not an input", () => {
    // Feeding the previous run's registry back in must not change the hash;
    // otherwise the second run of an unchanged record would never no-op.
    expect(hashPlannerInput(base)).toBe(
      hashPlannerInput({
        ...base,
        existingNumerals: [
          { numeral: "10", partLabel: "a", componentId: null, firstAssignedFigureNumber: 1 },
        ],
      }),
    );
  });
});

describe("budget caps", () => {
  let ctx: Awaited<ReturnType<typeof setup>>;

  beforeEach(async () => {
    ctx = await setup();
  });

  async function seedImageSources(count: number) {
    for (let index = 0; index < count; index += 1) {
      await ctx.data.createSource({
        organizationId: ctx.org.id,
        inventionId: ctx.invention.id,
        name: `sketch-${index}.png`,
        kind: "sketch",
        note: "",
        status: "extracted",
        synthetic: true,
        originalFilename: `sketch-${index}.png`,
        mimeType: "image/png",
        byteSize: 10,
        storagePath: null,
        checksumSha256: null,
        quarantineReason: null,
        interpretationStatus: null,
        derivedFromSourceId: null,
      });
    }
  }

  it("pauses with a visible reason when the org daily cap would be exceeded", async () => {
    await seedImageSources(3);
    // Spend almost the whole daily allowance on figure work already today.
    const reservation = await ctx.data.saveReservation({
      id: "res-cap",
      organizationId: ctx.org.id,
      idempotencyKey: "cap-seed",
      amountCents: 1_950,
      rateVersion: "2026-08-01.google.gemini-3-pro-image",
      markupMultiplier: 2.0,
      status: "settled",
      createdAt: new Date().toISOString(),
    });
    await ctx.data.appendUsageEvent({
      organizationId: ctx.org.id,
      reservationId: reservation.id,
      modelId: "gemini-3-pro-image",
      rateVersion: "2026-08-01.google.gemini-3-pro-image",
      providerCostCents: 975,
      customerChargeCents: 1_950,
      markupMultiplier: 2.0,
      inputTokens: 0,
      outputTokens: 0,
    });
    expect(await figureSpendTodayCents(ctx.org.id)).toBe(1_950);

    const result = await runFigurePipeline({
      organizationId: ctx.org.id,
      userId: ctx.user.id,
      inventionId: ctx.invention.id,
      draftVersionId: null,
      idempotencyKey: "figures:cap",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("org_daily_cap_reached");
    expect(result.detail).toMatch(/paused/i);
    expect(result.detail).toMatch(/raise the cap/i);

    // The pause is recorded and visible, not swallowed.
    const view = await getLatestFigureSetView(ctx.org.id, ctx.invention.id);
    expect(view.set?.state).toBe("paused_budget");
    expect(view.set?.statusDetail).toMatch(/paused/i);
    // And nothing was spent for the paused run.
    expect(view.set?.totalCostCents).toBe(0);
    expect((await ctx.data.getWallet(ctx.org.id))?.reservedCents).toBe(0);
  });

  it("draws synthetic placeholder art for image sources and labels it as such", async () => {
    await seedImageSources(1);
    const result = await runFigurePipeline({
      organizationId: ctx.org.id,
      userId: ctx.user.id,
      inventionId: ctx.invention.id,
      draftVersionId: null,
      idempotencyKey: "figures:synthetic",
    });
    expect(result.ok).toBe(true);

    const view = await getLatestFigureSetView(ctx.org.id, ctx.invention.id);
    const figure = view.figures.find((entry) => entry.sourceKind === "from_uploaded_image");
    expect(figure).toBeDefined();
    // Labeled everywhere it can be seen: in the title, and on the sheet.
    expect(figure!.title).toContain("synthetic placeholder");
    expect(view.set?.modelId).toContain("synthetic");
    const sheetBytes = await getAdapters().storage.get(view.sheets[0].storagePath);
    expect(Buffer.from(sheetBytes!).toString("utf8")).toContain("Synthetic placeholder art");
    // The generated art is embedded as a raster, never as model-drawn text.
    expect(Buffer.from(sheetBytes!).toString("utf8")).toContain("data:image/png;base64,");
    // Local mode has no provider, so nothing is charged.
    expect(view.set?.totalProviderCostCents).toBe(0);
    expect(view.set?.totalCostCents).toBe(0);
  });

  it("refuses to start when the wallet cannot cover the estimate", async () => {
    await seedImageSources(2);
    await ctx.data.saveWallet({ organizationId: ctx.org.id, balanceCents: 10, reservedCents: 0 });
    const result = await runFigurePipeline({
      organizationId: ctx.org.id,
      userId: ctx.user.id,
      inventionId: ctx.invention.id,
      draftVersionId: null,
      idempotencyKey: "figures:funds",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("insufficient_funds");
      expect(result.detail).toMatch(/reserved against your wallet/i);
    }
    // Nothing was created and nothing was held.
    expect((await ctx.data.getWallet(ctx.org.id))?.reservedCents).toBe(0);
  });
});
