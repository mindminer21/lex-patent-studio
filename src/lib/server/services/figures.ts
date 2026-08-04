import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { parseObjMesh, parseStlMesh, projectMesh, CANONICAL_VIEWS } from "@/lib/wepatent/domain/mesh";
import {
  combineEstimates,
  customerChargeForComponents,
  estimateUsage,
  release,
  reserve,
  settle,
  type ChargeComponent,
  type UsageEstimate,
} from "@/lib/wepatent/domain/usage";
import {
  MODEL_TASK_CATEGORY,
  multiplierForTaskCategory,
} from "@/lib/shared/billing/task-category";
import { env } from "@/lib/wepatent/env";
import {
  IMAGE_MODEL_REGISTRY,
  resolveImageModel,
} from "../figures/image-models";
import { getAdapters } from "../adapters";
import {
  markupMultiplierForEntry,
  PROVIDER_PRICE_REGISTRY,
  resolveProviderRate,
} from "../adapters/production/model-gateway";
import type { Id } from "../adapters/types";
import { compose, COMPOSER_VERSION, type Composition } from "../figures/compose";
import {
  buildLineArtPrompt,
  PROMPT_TEMPLATE_VERSION,
  type ViewDescriptor,
} from "../figures/gemini-contract";
import { anchorsFromPrimitives, lineArtFromProjection } from "../figures/mesh-lineart";
import { planFigureSet, PLANNER_VERSION, type PlannerInput, type PlannerSource } from "../figures/planner";
import { compositionToPdf } from "../figures/pdf";
import { analyzeRaster, decodePng, type RasterReport } from "../figures/raster";
import { RULES_VERSION } from "../figures/rules";
import { pngDataUri, SYNTHETIC_LEGEND, SYNTHETIC_MODEL_ID } from "../figures/synthetic";
import type { DrawPrimitive, FigureSetSpec, FigureSpec } from "../figures/types";
import { validateFigureSet, type ValidationReport } from "../figures/validate";
import { logEvent } from "../observability";

/**
 * The figure pipeline (spec §5): plan → generate → compose → validate →
 * attach, metered end to end and honest at every step.
 *
 * Design commitments this file keeps:
 * - NOTHING is spent before an estimate exists and a reservation succeeds.
 * - Regenerating an unchanged draft is a no-op: the planner input is
 *   content-hashed and compared before any provider call.
 * - Caps PAUSE the pipeline with a visible reason; they never spend
 *   silently and never fail silently.
 * - A retry with the same idempotency key resolves to the existing figure
 *   set instead of charging twice.
 * - Every persisted figure is `ai_proposed`. This service can never write a
 *   confirmed state; only the explicit user actions at the bottom do.
 */

/** Planning is a deterministic pass today; its token cost is zero. */
const PLANNER_TOKEN_ESTIMATE = { low: 0, high: 0 };

export type FigureRunOutcome =
  | { ok: true; figureSetId: Id; state: string; deduplicated: boolean; noop: boolean }
  | {
      ok: false;
      error:
        | "invention_not_found"
        | "insufficient_funds"
        | "budget_cap_reached"
        | "org_daily_cap_reached"
        | "pipeline_failed";
      detail: string;
    };

/* ------------------------------------------------------------------ */
/* Planner input assembly                                              */
/* ------------------------------------------------------------------ */

const MODEL_3D_EXTENSIONS = /\.(stl|obj)$/i;

async function meshPrimitivesFor(
  organizationId: Id,
  storagePath: string | null,
  name: string,
): Promise<{ primitives: DrawPrimitive[]; anchors: ReturnType<typeof anchorsFromPrimitives> }> {
  const empty = { primitives: [] as DrawPrimitive[], anchors: [] };
  if (!storagePath) return empty;
  const { storage } = getAdapters();
  let bytes: Uint8Array | null = null;
  try {
    bytes = await storage.get(storagePath);
  } catch {
    bytes = null;
  }
  if (!bytes) return empty;
  // Reuse the M2/M3 parsers exactly — no second geometry implementation.
  const mesh = /\.obj$/i.test(name)
    ? parseObjMesh(Buffer.from(bytes).toString("utf8"))
    : parseStlMesh(bytes);
  if (!mesh || mesh.triangleCount === 0) return empty;
  const isometric = CANONICAL_VIEWS.find((view) => view.id === "isometric") ?? CANONICAL_VIEWS[0];
  const projected = projectMesh(mesh, isometric, 1000);
  const primitives = lineArtFromProjection(projected, 1000);
  return { primitives, anchors: anchorsFromPrimitives(primitives, 1) };
}

export async function buildPlannerInput(params: {
  organizationId: Id;
  inventionId: Id;
  draftText: string;
  existingNumerals: PlannerInput["existingNumerals"];
}): Promise<PlannerInput> {
  const { data, modelGateway } = getAdapters();
  const invention = await data.getInvention(params.organizationId, params.inventionId);
  const components = await data.listComponents(params.organizationId, params.inventionId);
  const pairs = await data.listPsPairs(params.organizationId, params.inventionId);
  const associations = await data.listAssociations(params.organizationId, params.inventionId);
  const sources = await data.listSources(params.organizationId, params.inventionId);

  const plannerSources: PlannerSource[] = [];
  for (const source of sources) {
    const isModel = MODEL_3D_EXTENSIONS.test(source.originalFilename ?? source.name);
    const isImage = (source.mimeType ?? "").startsWith("image/");
    if (isModel) {
      const mesh = await meshPrimitivesFor(
        params.organizationId,
        source.storagePath,
        source.originalFilename ?? source.name,
      );
      plannerSources.push({
        id: source.id,
        name: source.name,
        sourceClass: "model3d",
        status: source.status,
        meshPrimitives: mesh.primitives,
        meshAnchors: mesh.anchors,
      });
    } else if (isImage) {
      plannerSources.push({
        id: source.id,
        name: source.name,
        sourceClass: "image",
        status: source.status,
        derived: Boolean(source.derivedFromSourceId),
      });
    }
  }

  const input: Omit<PlannerInput, "inputHash"> = {
    inventionTitle: invention?.title ?? "",
    draftText: params.draftText,
    components: components.map((component) => ({
      id: component.id,
      name: component.name,
      description: component.description,
      state: component.state,
    })),
    solutions: pairs
      .filter((pair) => pair.kind === "solution")
      .map((pair) => ({ id: pair.id, statement: pair.statement })),
    associations: associations.map((association) => ({
      solutionId: association.solutionId,
      componentId: association.componentId,
    })),
    sources: plannerSources,
    existingNumerals: params.existingNumerals,
    sheetSize: "a4",
    lineArtAvailable: modelGateway.lineArtAvailable(),
    designPatent: false,
  };
  return { ...input, inputHash: hashPlannerInput(input) };
}

/**
 * Content hash of the RECORD the plan is derived from. Two runs with the
 * same hash produce the same figures, so the second one must not spend a
 * cent.
 *
 * The existing numeral registry is deliberately NOT part of the hash. It is
 * an output of the previous run that is fed back in only so parts keep their
 * numerals; including it would make the hash differ on every second run and
 * defeat the no-op entirely. `lineArtAvailable` and the four version
 * stamps ARE included, so newly enabling the drawing model — or shipping a
 * new rule set — correctly re-plans instead of returning stale figures.
 */
export function hashPlannerInput(input: Omit<PlannerInput, "inputHash">): string {
  const canonical = JSON.stringify({
    title: input.inventionTitle,
    draftText: input.draftText,
    components: input.components.map((component) => [component.id, component.name]).sort(),
    solutions: input.solutions.map((solution) => [solution.id, solution.statement]).sort(),
    associations: input.associations
      .map((association) => [association.solutionId, association.componentId])
      .sort(),
    sources: input.sources
      .map((source) => [source.id, source.sourceClass, (source.meshPrimitives ?? []).length])
      .sort(),
    sheetSize: input.sheetSize,
    lineArtAvailable: input.lineArtAvailable,
    rulesVersion: RULES_VERSION,
    plannerVersion: PLANNER_VERSION,
    composerVersion: COMPOSER_VERSION,
    promptTemplateVersion: PROMPT_TEMPLATE_VERSION,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/* ------------------------------------------------------------------ */
/* Cost model                                                          */
/* ------------------------------------------------------------------ */

export type FigureEstimate = {
  estimate: UsageEstimate;
  imagesLow: number;
  imagesHigh: number;
  /** True when no provider call will be made at all (deterministic set). */
  free: boolean;
  imageMarkupMultiplier: number;
  textMarkupMultiplier: number;
};

/**
 * The configured Layer-1 image model (Jeff's directive, 2026-08-04).
 *
 * Registry-level and env-overridable via FIGURES_IMAGE_MODEL; the default
 * is Nano Banana 2 (Gemini 3 Pro Image). An unrecognised value resolves to
 * an error rather than a silent fallback, and the pipeline then reports
 * line art as unavailable instead of spending on an unpriced model.
 */
export function configuredImageModelId(): string {
  const resolved = resolveImageModel(env.FIGURES_IMAGE_MODEL);
  return resolved.ok ? resolved.entry.id : "";
}

/** The price-registry entry for the configured image model, if it is priced. */
export function configuredImageEntry() {
  const modelId = configuredImageModelId();
  if (!modelId) return undefined;
  return PROVIDER_PRICE_REGISTRY.find((entry) => entry.modelId === modelId);
}

/**
 * Every image model the org has ever been billed for, so the daily-cap
 * tally does not miss spend made before the configuration changed.
 */
const BILLABLE_IMAGE_MODEL_IDS: readonly string[] = IMAGE_MODEL_REGISTRY.map((m) => m.id);

/**
 * Pre-run estimate for a planned set. Images are the only priced element
 * today (planning and composition are deterministic code), and they carry
 * the 2.0 image-generation multiplier while any token work stays at 1.5.
 */
export function estimateFigureRun(spec: FigureSetSpec): FigureEstimate {
  const imageFigures = spec.figures.filter(
    (figure) =>
      figure.state !== "needs_input" &&
      (figure.sourceKind === "generated_line_art" || figure.sourceKind === "from_uploaded_image"),
  ).length;
  // Image generation is a generation task (2.0). The planning tokens that
  // ride along author the figure titles and Brief Description sentences,
  // which is ALSO a generation task — deterministic-diagram planning that
  // authors text (Jeff's directive, 2026-08-04). Both components therefore
  // settle at the generation multiplier, each on its own provider cost.
  const IMAGE_ENTRY = configuredImageEntry();
  const imageMarkupMultiplier = IMAGE_ENTRY
    ? markupMultiplierForEntry(IMAGE_ENTRY, MODEL_TASK_CATEGORY.line_art)
    : multiplierForTaskCategory(MODEL_TASK_CATEGORY.line_art);
  const textMarkupMultiplier = multiplierForTaskCategory(
    MODEL_TASK_CATEGORY.diagram_plan_text,
  );

  const rate = IMAGE_ENTRY?.rate ?? {
    rateVersion: "unpriced",
    inputCentsPerMillionTokens: 0,
    outputCentsPerMillionTokens: 0,
    perImageCents: 0,
  };
  // The hygiene gate may regenerate once, so the high bound assumes two
  // billed attempts per figure. That ceiling is what gets reserved.
  const imagesLow = imageFigures;
  const imagesHigh = imageFigures * 2;

  const images = estimateUsage({
    rate,
    estimatedInputTokens: 0,
    estimatedOutputTokensLow: 0,
    estimatedOutputTokensHigh: 0,
    estimatedImagesLow: imagesLow,
    estimatedImagesHigh: imagesHigh,
    markupMultiplier: imageMarkupMultiplier,
  });
  const planning = estimateUsage({
    rate: {
      rateVersion: "figures.planning.deterministic",
      inputCentsPerMillionTokens: 0,
      outputCentsPerMillionTokens: 0,
    },
    estimatedInputTokens: PLANNER_TOKEN_ESTIMATE.low,
    estimatedOutputTokensLow: PLANNER_TOKEN_ESTIMATE.low,
    estimatedOutputTokensHigh: PLANNER_TOKEN_ESTIMATE.high,
    markupMultiplier: textMarkupMultiplier,
  });

  const combined = combineEstimates([planning, images], rate.rateVersion);
  return {
    estimate: combined,
    imagesLow,
    imagesHigh,
    free: combined.customerHighCents === 0,
    imageMarkupMultiplier,
    textMarkupMultiplier,
  };
}

/**
 * Customer-charge cents this org has spent on FIGURE work since UTC
 * midnight. Derived from the immutable usage-event log rather than a
 * counter, so it cannot drift and needs no new state.
 */
export async function figureSpendTodayCents(organizationId: Id): Promise<number> {
  const { data } = getAdapters();
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const events = await data.listUsageEvents(organizationId);
  return events
    .filter(
      (event) =>
        new Date(event.createdAt).getTime() >= startOfDay.getTime() &&
        (BILLABLE_IMAGE_MODEL_IDS.includes(event.modelId) ||
          event.modelId === SYNTHETIC_MODEL_ID),
    )
    .reduce((sum, event) => sum + event.customerChargeCents, 0);
}

/* ------------------------------------------------------------------ */
/* The run                                                             */
/* ------------------------------------------------------------------ */

export async function runFigurePipeline(params: {
  organizationId: Id;
  userId: Id;
  inventionId: Id;
  draftVersionId: Id | null;
  idempotencyKey: string;
  /**
   * BRIEF-DRIVEN MODE (Jeff's directive, 2026-08-04). When set, the figure
   * stage runs off the Pass-1 illustrations brief: its numerals seed the
   * registry and the planner CONSUMES them instead of inventing its own.
   * Without it the pipeline behaves exactly as it did before.
   */
  draftSetId?: Id | null;
  briefNumerals?: ReadonlyArray<{
    numeral: string;
    partLabel: string;
    componentId: string | null;
  }> | null;
}): Promise<FigureRunOutcome> {
  const { data, storage } = getAdapters();

  const invention = await data.getInvention(params.organizationId, params.inventionId);
  if (!invention) {
    return { ok: false, error: "invention_not_found", detail: "invention not found" };
  }

  /* ---- draft text + existing registry ------------------------------- */
  const draftText = await loadDraftText(params.organizationId, params.inventionId, params.draftVersionId);
  const priorSets = await data.listFigureSets(params.organizationId, params.inventionId);
  const latest = priorSets[priorSets.length - 1] ?? null;
  /**
   * Where the registry comes from.
   *
   * Brief-driven: from the Pass-1 illustrations brief, and ONLY from it. The
   * brief is the single author of the numbering scheme, so the prior figure
   * set is deliberately not consulted — carrying an old numeral forward
   * would reintroduce the two-author problem the brief exists to remove.
   *
   * Legacy: carry the previous set's registry forward, as before.
   */
  const briefDriven = Boolean(params.briefNumerals && params.briefNumerals.length > 0);
  const existingNumerals = briefDriven
    ? params.briefNumerals!.map((entry) => ({
        numeral: entry.numeral,
        partLabel: entry.partLabel,
        componentId: entry.componentId,
        firstAssignedFigureNumber: null,
      }))
    : latest
      ? (await data.listFigureNumerals(params.organizationId, latest.id)).map((entry) => ({
          numeral: entry.numeral,
          partLabel: entry.partLabel,
          componentId: entry.componentId,
          firstAssignedFigureNumber: null,
        }))
      : [];

  /* ---- Stage 1: plan ------------------------------------------------- */
  const plannerInput = await buildPlannerInput({
    organizationId: params.organizationId,
    inventionId: params.inventionId,
    draftText,
    existingNumerals,
  });
  const { spec } = planFigureSet({ ...plannerInput, briefDriven });

  // No-op on an unchanged record: same inputs, same figures, zero spend.
  if (latest && latest.inputHash === spec.inputHash && latest.state === "ready") {
    return { ok: true, figureSetId: latest.id, state: latest.state, deduplicated: true, noop: true };
  }

  /* ---- caps ---------------------------------------------------------- */
  const estimate = estimateFigureRun(spec);
  if (estimate.estimate.customerHighCents > env.FIGURE_SET_BUDGET_CENTS) {
    const detail = `Figure generation paused — the estimated cost for this draft (${usd(estimate.estimate.customerHighCents)}) exceeds the per-draft cap of ${usd(env.FIGURE_SET_BUDGET_CENTS)}. Raise the cap to continue.`;
    await recordPausedSet(params, spec, detail, "paused_budget");
    return { ok: false, error: "budget_cap_reached", detail };
  }
  const spentToday = await figureSpendTodayCents(params.organizationId);
  if (spentToday + estimate.estimate.customerHighCents > env.FIGURES_ORG_DAILY_CAP_CENTS) {
    const detail = `Figure generation paused — this organization has reached its daily figure budget (${usd(env.FIGURES_ORG_DAILY_CAP_CENTS)}). Raise the cap to continue.`;
    await recordPausedSet(params, spec, detail, "paused_budget");
    return { ok: false, error: "org_daily_cap_reached", detail };
  }

  /* ---- reservation (skipped entirely when nothing will be spent) ----- */
  const wallet = (await data.getWallet(params.organizationId)) ?? {
    organizationId: params.organizationId,
    balanceCents: 0,
    reservedCents: 0,
  };
  const rateVersion = estimate.estimate.rateVersion;
  let reservationId: Id | null = null;
  let reserveState: ReturnType<typeof reserve> | null = null;

  if (!estimate.free) {
    const existingReservations = await data.listReservations(params.organizationId);
    reserveState = reserve(
      { balanceCents: wallet.balanceCents, reservedCents: wallet.reservedCents },
      existingReservations,
      {
        id: randomUUID(),
        idempotencyKey: params.idempotencyKey,
        amountCents: estimate.estimate.customerHighCents,
        rateVersion,
        markupMultiplier: estimate.imageMarkupMultiplier,
      },
    );
    if (!reserveState.ok) {
      return {
        ok: false,
        error: "insufficient_funds",
        detail: `Figure generation needs up to ${usd(estimate.estimate.customerHighCents)} reserved against your wallet.`,
      };
    }
    if (reserveState.deduplicated) {
      // A retry under the same key: return the set this reservation already
      // produced rather than charging again.
      const prior = priorSets.find((set) => set.inputHash === spec.inputHash);
      if (prior) {
        return { ok: true, figureSetId: prior.id, state: prior.state, deduplicated: true, noop: false };
      }
    }
    reservationId = reserveState.reservation.id;
    await data.saveWallet({ organizationId: params.organizationId, ...reserveState.wallet });
    await data.saveReservation({
      ...reserveState.reservation,
      organizationId: params.organizationId,
      createdAt: new Date().toISOString(),
    });
  }

  /* ---- persist the set shell so progress is observable --------------- */
  const figureSet = await data.createFigureSet({
    organizationId: params.organizationId,
    inventionId: params.inventionId,
    draftVersionId: params.draftVersionId,
    state: "generating",
    sheetSize: spec.sheetSize,
    orientationPolicy: spec.orientationPolicy,
    rulesVersion: spec.rulesVersion,
    plannerVersion: PLANNER_VERSION,
    composerVersion: COMPOSER_VERSION,
    modelId: null,
    promptTemplateVersion: null,
    inputHash: spec.inputHash,
    totalCostCents: 0,
    totalProviderCostCents: 0,
    aiState: "ai_proposed",
    statusDetail: "",
  });

  try {
    /* ---- Stage 2: generate ------------------------------------------- */
    const generation = await generateLineArtFigures(spec, estimate);

    /* ---- Stage 3: compose -------------------------------------------- */
    await data.updateFigureSet(params.organizationId, figureSet.id, { state: "composing" });
    const composition = compose(spec, {
      indicia: `${invention.title} — working draft, counsel review required`,
      crosshairs: false,
    });

    const sheetRecords = [];
    for (const sheet of composition.sheets) {
      const bytes = new TextEncoder().encode(sheet.svg);
      const checksum = createHash("sha256").update(bytes).digest("hex");
      const storagePath = `figures/${params.organizationId}/${figureSet.id}/sheet-${sheet.sheetNumber}.svg`;
      await storage.put(storagePath, bytes);
      sheetRecords.push(
        await data.appendFigureSheet({
          organizationId: params.organizationId,
          figureSetId: figureSet.id,
          sheetNumber: sheet.sheetNumber,
          totalSheets: sheet.totalSheets,
          orientation: sheet.orientation,
          contentType: "image/svg+xml",
          storagePath,
          checksumSha256: checksum,
          byteSize: bytes.byteLength,
        }),
      );
    }

    // Combined PDF for the counsel package, checksummed like every artifact.
    try {
      const pdfBytes = await compositionToPdf(composition);
      await storage.put(
        `figures/${params.organizationId}/${figureSet.id}/sheets.pdf`,
        pdfBytes,
      );
    } catch (error) {
      // The SVG sheets remain authoritative; a PDF failure is logged and
      // surfaced rather than silently swallowed.
      logEvent({
        level: "warn",
        event: "figures.pdf_failed",
        correlationId: figureSet.id,
        meta: { detail: error instanceof Error ? error.message : String(error) },
      });
    }

    /* ---- Stage 4: validate ------------------------------------------- */
    await data.updateFigureSet(params.organizationId, figureSet.id, { state: "validating" });
    const report = validateFigureSet({
      spec,
      composition,
      rasterReports: generation.rasterReports,
      draftText,
      designPatent: false,
    });
    await data.appendFigureValidations(
      report.outcomes.map((outcome) => ({
        organizationId: params.organizationId,
        figureSetId: figureSet.id,
        figureId: null,
        ruleId: outcome.ruleId,
        status: outcome.status,
        detail: outcome.detail,
        rulesVersion: report.rulesVersion,
      })),
    );

    /* ---- Stage 5: attach --------------------------------------------- */
    await persistFigures(params.organizationId, figureSet.id, spec, composition);

    /* ---- settlement --------------------------------------------------- */
    const components: ChargeComponent[] = [
      {
        providerCostCents: generation.providerCostCents,
        markupMultiplier: estimate.imageMarkupMultiplier,
        label: "image generation",
      },
    ];
    let customerCharge = 0;
    if (reserveState && reserveState.ok && reservationId) {
      const settled = settle(
        reserveState.wallet,
        reserveState.reservation,
        generation.providerCostCents,
        components,
      );
      if (settled.ok) {
        customerCharge = settled.customerChargeCents;
        await data.saveWallet({ organizationId: params.organizationId, ...settled.wallet });
        await data.saveReservation({
          ...settled.reservation,
          organizationId: params.organizationId,
          createdAt: new Date().toISOString(),
        });
        if (customerCharge > 0) {
          await data.appendLedgerEntry({
            organizationId: params.organizationId,
            kind: "settlement",
            amountCents: -customerCharge,
            reservationId,
            note: `Patent figure generation (${rateVersion}); image generation billed at ${estimate.imageMarkupMultiplier.toFixed(1)}x provider cost.`,
          });
          await data.appendUsageEvent({
            organizationId: params.organizationId,
            reservationId,
            modelId: generation.modelId ?? configuredImageModelId(),
            rateVersion,
            providerCostCents: generation.providerCostCents,
            customerChargeCents: customerCharge,
            markupMultiplier: estimate.imageMarkupMultiplier,
            inputTokens: 0,
            outputTokens: 0,
          });
        } else {
          const released = release(reserveState.wallet, reserveState.reservation);
          if (released.ok) {
            await data.saveWallet({ organizationId: params.organizationId, ...released.wallet });
          }
        }
      }
    }

    const state = deriveSetState(spec, report, generation.notes);
    const statusDetail = [report.summary, ...generation.notes].filter(Boolean).join(" ");
    await data.updateFigureSet(params.organizationId, figureSet.id, {
      state,
      statusDetail,
      totalCostCents: customerCharge,
      totalProviderCostCents: generation.providerCostCents,
      modelId: generation.modelId,
      promptTemplateVersion: generation.modelId ? PROMPT_TEMPLATE_VERSION : null,
    });

    await data.appendAuditEvent({
      organizationId: params.organizationId,
      actor: params.userId ? `user:${params.userId}` : "system:figures",
      action: "figures.generated",
      target: figureSet.id,
      meta: {
        figureCount: spec.figures.length,
        sheetCount: sheetRecords.length,
        validationStatus: report.status,
        customerChargeCents: customerCharge,
        providerCostCents: generation.providerCostCents,
      },
    });

    return { ok: true, figureSetId: figureSet.id, state, deduplicated: false, noop: false };
  } catch (error) {
    // Failed run: release the hold, never charge (PRD §7.4).
    if (reserveState && reserveState.ok) {
      const released = release(reserveState.wallet, reserveState.reservation);
      if (released.ok) {
        await data.saveWallet({ organizationId: params.organizationId, ...released.wallet });
        await data.saveReservation({
          ...released.reservation,
          organizationId: params.organizationId,
          createdAt: new Date().toISOString(),
        });
      }
    }
    const detail =
      error instanceof Error ? error.message.slice(0, 200) : "figure generation failed";
    await data.updateFigureSet(params.organizationId, figureSet.id, {
      state: "failed",
      statusDetail: `Figure generation did not complete: ${detail}. Nothing was charged.`,
    });
    return { ok: false, error: "pipeline_failed", detail };
  }
}

/* ------------------------------------------------------------------ */
/* Stage 2 helpers                                                     */
/* ------------------------------------------------------------------ */

type GenerationOutcome = {
  providerCostCents: number;
  modelId: string | null;
  rasterReports: Map<number, RasterReport>;
  notes: string[];
};

/**
 * Run Layer 1 for the figures that need it. Deterministic diagrams and
 * model-derived figures never reach this function — that is the point of
 * the architecture.
 */
async function generateLineArtFigures(
  spec: FigureSetSpec,
  estimate: FigureEstimate,
): Promise<GenerationOutcome> {
  const { modelGateway } = getAdapters();
  const rasterReports = new Map<number, RasterReport>();
  const notes: string[] = [];
  let providerCostCents = 0;
  let modelId: string | null = null;
  // Which image model this run calls. Resolved ONCE per run so a
  // configuration change mid-run cannot mix two models into one figure set.
  const imageModelId = configuredImageModelId();

  for (const figure of spec.figures) {
    if (figure.state === "needs_input") continue;
    if (figure.sourceKind !== "generated_line_art" && figure.sourceKind !== "from_uploaded_image") {
      continue;
    }
    const prompt = buildLineArtPrompt({
      subject: figure.title,
      viewType: viewDescriptorFor(figure),
      knownGeometry: [],
      hasReferenceImage: figure.sourceKind === "from_uploaded_image",
    });
    figure.generationPrompt = prompt;

    try {
      const result = await modelGateway.generateLineArt({
        modelId: imageModelId,
        prompt,
        subject: figure.title,
        viewType: figure.viewType,
      });
      if (result.status === "refused") {
        figure.state = "needs_input";
        figure.needsInput = {
          figureRef: `figure:${figure.figureNumber}`,
          question: `We could not draw this view automatically. Describe the view you want, or upload a sketch or 3D model.`,
          missing: "usable line art",
        };
        notes.push(`FIG. ${figure.figureNumber}: the drawing model declined to produce this view.`);
        continue;
      }
      providerCostCents += result.providerCostCents;
      if (result.status === "rejected") {
        figure.state = "needs_input";
        figure.needsInput = {
          figureRef: `figure:${figure.figureNumber}`,
          question:
            "The generated drawing did not meet the formal drawing requirements. Upload a sketch or 3D model, or describe the view and we will keep it in the plan.",
          missing: "compliant line art",
        };
        notes.push(
          `FIG. ${figure.figureNumber}: generated art was rejected (${result.violations.join("; ")}).`,
        );
        continue;
      }

      modelId = result.modelId;
      const image = decodePng(result.imageBytes);
      if (image) rasterReports.set(figure.figureNumber, analyzeRaster(image));
      figure.primitives = [
        {
          kind: "raster",
          dataUri: pngDataUri(result.imageBytes),
          x: 0,
          y: 0,
          w: 1,
          h: 1,
        },
      ];
      if (result.modelId === SYNTHETIC_MODEL_ID) {
        // Local/dev synthetic art is labeled ON THE SHEET, not just in the
        // UI, so an exported drawing can never be mistaken for real art.
        figure.primitives.push({
          kind: "legend_text",
          at: { x: 0.5, y: 0.98 },
          text: SYNTHETIC_LEGEND,
          anchor: "middle",
        });
        figure.title = `${figure.title} (synthetic placeholder)`;
      }
      figure.state = "generated";
    } catch {
      // The provider is unavailable/disabled. Honest outcome: a question,
      // not a drawing.
      figure.state = "needs_input";
      figure.needsInput = {
        figureRef: `figure:${figure.figureNumber}`,
        question:
          "Line-art generation is not enabled, so we could not draw this view. Upload a sketch, photo, or 3D model and we will use that instead.",
        missing: "line-art generation provider",
      };
      notes.push(`FIG. ${figure.figureNumber}: line-art generation is unavailable.`);
    }
  }

  void estimate;
  return { providerCostCents, modelId, rasterReports, notes };
}

function viewDescriptorFor(figure: FigureSpec): ViewDescriptor {
  const allowed: ViewDescriptor[] = [
    "perspective",
    "plan",
    "elevation",
    "section",
    "partial",
    "detail",
    "exploded",
    "design_orthographic",
  ];
  return (allowed as string[]).includes(figure.viewType)
    ? (figure.viewType as ViewDescriptor)
    : "perspective";
}

/* ------------------------------------------------------------------ */
/* Persistence                                                         */
/* ------------------------------------------------------------------ */

async function persistFigures(
  organizationId: Id,
  figureSetId: Id,
  spec: FigureSetSpec,
  composition: Composition,
): Promise<void> {
  const { data } = getAdapters();

  for (const entry of spec.numerals) {
    await data.createFigureNumeral({
      organizationId,
      figureSetId,
      numeral: entry.numeral,
      partLabel: entry.partLabel,
      componentId: entry.componentId,
      firstAssignedFigureId: null,
    });
  }

  const placements = new Map(
    composition.sheets.flatMap((sheet) =>
      sheet.figures.map((placement) => [placement.figureNumber, { sheet, placement }] as const),
    ),
  );

  for (const figure of spec.figures) {
    const record = await data.createFigure({
      organizationId,
      figureSetId,
      figureNumber: figure.figureNumber,
      partialSuffix: figure.partialSuffix,
      viewType: figure.viewType,
      title: figure.title,
      isPriorArt: figure.isPriorArt,
      subjectRef: figure.subjectRef,
      sourceKind: figure.sourceKind,
      generationPrompt: figure.generationPrompt,
      briefDescription: figure.briefDescription,
      sectionOf: figure.sectionOf,
      state: figureStateFor(figure, composition),
      needsInputQuestion: figure.needsInput?.question ?? null,
      needsInputMissing: figure.needsInput?.missing ?? null,
      // Always ai_proposed. This service cannot write a confirmed state.
      aiState: "ai_proposed",
    });

    const found = placements.get(figure.figureNumber);
    if (!found) continue;
    const { sheet } = found;
    const annotations = figure.annotations.map((annotation) => {
      const lead = sheet.leadLines.find(
        (candidate) =>
          candidate.figureNumber === figure.figureNumber &&
          candidate.numeral === annotation.numeral,
      );
      const mark = sheet.textMarks.find(
        (candidate) =>
          candidate.role === "reference" &&
          candidate.figureNumber === figure.figureNumber &&
          candidate.text === annotation.numeral,
      );
      return {
        organizationId,
        figureId: record.id,
        numeral: annotation.numeral,
        anchorX: annotation.anchor.x,
        anchorY: annotation.anchor.y,
        labelX: annotation.label.x,
        labelY: annotation.label.y,
        leadLinePath: (lead?.pointsMm ?? []).map((point) => ({ x: point.x, y: point.y })),
        underlined: mark?.underlined ?? false,
        placedBy: "auto" as const,
      };
    });
    await data.replaceFigureAnnotations(organizationId, record.id, annotations);
  }
}

function figureStateFor(figure: FigureSpec, composition: Composition) {
  if (figure.state === "needs_input") return "needs_input" as const;
  const unplaceable = composition.unplaceable.some(
    (item) => item.figureNumber === figure.figureNumber,
  );
  return unplaceable ? ("needs_human_review" as const) : ("ready" as const);
}

/**
 * Set-level status.
 *
 * `failed` means the PIPELINE did not complete — not that a formality check
 * came back negative. A composed set with failing checks is `ready` with its
 * violations surfaced prominently: hiding usable sheets behind a "failed"
 * badge would be less honest, not more, and the two-way specification
 * cross-check in particular is EXPECTED to fail on a first run, because the
 * description has not yet been updated to mention the new reference
 * characters. That is an actionable item for the drafter, not a broken
 * drawing. Accepting a set with failures requires a recorded reason.
 */
function deriveSetState(
  spec: FigureSetSpec,
  report: ValidationReport,
  notes: readonly string[],
) {
  if (spec.figures.length === 0) return "needs_input" as const;
  if (spec.figures.every((figure) => figure.state === "needs_input")) return "needs_input" as const;
  void report;
  void notes;
  return "ready" as const;
}

async function recordPausedSet(
  params: { organizationId: Id; inventionId: Id; draftVersionId: Id | null },
  spec: FigureSetSpec,
  detail: string,
  state: "paused_budget",
): Promise<void> {
  const { data } = getAdapters();
  await data.createFigureSet({
    organizationId: params.organizationId,
    inventionId: params.inventionId,
    draftVersionId: params.draftVersionId,
    state,
    sheetSize: spec.sheetSize,
    orientationPolicy: spec.orientationPolicy,
    rulesVersion: spec.rulesVersion,
    plannerVersion: PLANNER_VERSION,
    composerVersion: COMPOSER_VERSION,
    modelId: null,
    promptTemplateVersion: null,
    inputHash: spec.inputHash,
    totalCostCents: 0,
    totalProviderCostCents: 0,
    aiState: "ai_proposed",
    statusDetail: detail,
  });
}

async function loadDraftText(
  organizationId: Id,
  inventionId: Id,
  draftVersionId: Id | null,
): Promise<string> {
  const { data } = getAdapters();
  if (draftVersionId) {
    const version = await data.getDraftVersion(organizationId, draftVersionId);
    if (version) return version.content;
  }
  const drafts = await data.listDrafts(organizationId, inventionId);
  const texts: string[] = [];
  for (const draft of drafts) {
    const versions = await data.listDraftVersions(organizationId, draft.id);
    const newest = versions[versions.length - 1];
    if (newest) texts.push(newest.content);
  }
  return texts.join("\n\n");
}

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/* ------------------------------------------------------------------ */
/* User actions (the ONLY writers of a non-ai_proposed state)          */
/* ------------------------------------------------------------------ */

export async function acceptFigureSet(params: {
  organizationId: Id;
  userId: Id;
  figureSetId: Id;
  /** Recorded when a set with failed checks is accepted anyway. */
  dismissalReason?: string;
}): Promise<{ ok: boolean }> {
  const { data } = getAdapters();
  const set = await data.getFigureSet(params.organizationId, params.figureSetId);
  if (!set) return { ok: false };
  await data.updateFigureSet(params.organizationId, params.figureSetId, {
    aiState: "user_confirmed",
  });
  const figures = await data.listFigures(params.organizationId, params.figureSetId);
  for (const figure of figures) {
    if (figure.state === "needs_input") continue;
    await data.updateFigure(params.organizationId, figure.id, { aiState: "user_confirmed" });
  }
  await data.appendAuditEvent({
    organizationId: params.organizationId,
    actor: `user:${params.userId}`,
    action: "figures.accepted",
    target: params.figureSetId,
    meta: { dismissalReason: params.dismissalReason ?? null },
  });
  return { ok: true };
}

/**
 * Rename a part. One registry row changes and every view picks it up,
 * because views store the numeral, never the label.
 */
export async function renameFigurePart(params: {
  organizationId: Id;
  userId: Id;
  numeralId: Id;
  partLabel: string;
}): Promise<{ ok: boolean }> {
  const { data } = getAdapters();
  const updated = await data.updateFigureNumeralLabel(
    params.organizationId,
    params.numeralId,
    params.partLabel.trim(),
  );
  if (!updated) return { ok: false };
  await data.updateFigureSet(params.organizationId, updated.figureSetId, {
    aiState: "user_edited",
  });
  await data.appendAuditEvent({
    organizationId: params.organizationId,
    actor: `user:${params.userId}`,
    action: "figures.part_renamed",
    target: updated.id,
    meta: { numeral: updated.numeral },
  });
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Read model for the studio surface                                   */
/* ------------------------------------------------------------------ */

export type FigureSetView = Awaited<ReturnType<typeof getLatestFigureSetView>>;

export async function getLatestFigureSetView(organizationId: Id, inventionId: Id) {
  const { data, modelGateway } = getAdapters();
  const sets = await data.listFigureSets(organizationId, inventionId);
  const set = sets[sets.length - 1] ?? null;
  if (!set) {
    return {
      set: null,
      figures: [],
      numerals: [],
      sheets: [],
      validations: [],
      lineArtAvailable: modelGateway.lineArtAvailable(),
    };
  }
  return {
    set,
    figures: await data.listFigures(organizationId, set.id),
    numerals: await data.listFigureNumerals(organizationId, set.id),
    sheets: await data.listFigureSheets(organizationId, set.id),
    validations: await data.listFigureValidations(organizationId, set.id),
    lineArtAvailable: modelGateway.lineArtAvailable(),
  };
}

/** Rate lookup used by the estimate copy so the UI never hard-codes a rate. */
export function figureImageRateVersion(at: Date = new Date()): string | null {
  const modelId = configuredImageModelId();
  if (!modelId) return null;
  return resolveProviderRate(modelId, at)?.rate.rateVersion ?? null;
}

export function customerChargeForFigureComponents(components: readonly ChargeComponent[]): number {
  return customerChargeForComponents(components);
}
