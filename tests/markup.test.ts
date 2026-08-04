import { describe, expect, it } from "vitest";
import {
  DEFAULT_BILLING_CATEGORY,
  DEFAULT_MARKUP_MULTIPLIER,
  markupDisclosureWithDefinitions,
  MARKUP_MULTIPLIERS,
  markupBasisPoints,
  markupDisclosure,
  markupDisclosureShort,
  markupMultiplierFor,
} from "@/lib/wepatent/domain/markup";
import {
  combineEstimates,
  customerChargeCents,
  customerChargeForComponents,
  estimateUsage,
  providerCostForComponents,
  release,
  reserve,
  settle,
  USAGE_MARKUP_DENOMINATOR,
  USAGE_MARKUP_NUMERATOR,
  type Reservation,
  type Wallet,
} from "@/lib/wepatent/domain/usage";
import {
  markupMultiplierForEntry,
  PROVIDER_PRICE_REGISTRY,
  unpricedImageModels,
} from "@/lib/server/adapters/production/model-gateway";
import { IMAGE_MODEL_REGISTRY } from "@/lib/server/figures/image-models";
import { GEMINI_IMAGE_MODEL_ID } from "@/lib/server/figures/gemini-contract";

/**
 * TASK-TYPE markup (Jeff's directive, 2026-08-04): any task that requires
 * GENERATION bills at 2.00 × provider cost; analysis tasks stay at 1.50.
 *
 * The regression half of this file matters as much as the new behavior:
 * every analysis-category charge must settle BYTE-IDENTICALLY to what it did
 * when 1.50 was the only rate.
 */

describe("markup catalog", () => {
  it("keeps 1.5 as the platform default, applied to analysis tasks", () => {
    expect(DEFAULT_MARKUP_MULTIPLIER).toBe(1.5);
    expect(DEFAULT_BILLING_CATEGORY).toBe("analysis");
    expect(MARKUP_MULTIPLIERS.analysis).toBe(1.5);
  });

  it("prices every generation task at 2.0", () => {
    expect(MARKUP_MULTIPLIERS.generation).toBe(2.0);
    expect(markupMultiplierFor("generation")).toBe(2.0);
  });

  it("falls back to the default — never the higher rate — when uncategorised", () => {
    expect(markupMultiplierFor(null)).toBe(1.5);
    expect(markupMultiplierFor(undefined)).toBe(1.5);
  });

  it("has exactly two categories, so no task can be neither", () => {
    expect(Object.keys(MARKUP_MULTIPLIERS).sort()).toEqual(["analysis", "generation"]);
  });

  it("converts multipliers to exact basis points", () => {
    expect(markupBasisPoints(1.5)).toBe(15_000);
    expect(markupBasisPoints(2)).toBe(20_000);
    expect(() => markupBasisPoints(0)).toThrow();
    expect(() => markupBasisPoints(Number.NaN)).toThrow();
  });
});

describe("markup disclosure text", () => {
  it("derives the published sentence from the catalog", () => {
    expect(markupDisclosure()).toBe(
      "provider cost × 2.0 for generation tasks, × 1.5 for analysis tasks",
    );
  });

  it("derives the heading form from the catalog", () => {
    expect(markupDisclosureShort()).toBe("cost × 2.0 generation / × 1.5 analysis");
  });

  it("names EVERY category and its rate — neither is an unstated exception", () => {
    const disclosure = markupDisclosure();
    for (const [category, multiplier] of Object.entries(MARKUP_MULTIPLIERS)) {
      expect(disclosure).toContain(multiplier.toFixed(1));
      expect(disclosure).toContain(category);
    }
  });

  it("defines both categories in the long form", () => {
    const long = markupDisclosureWithDefinitions();
    expect(long).toContain(markupDisclosure());
    expect(long).toContain("newly authored work product");
    expect(long).toContain("transcription");
  });
});

describe("registry ↔ catalog consistency", () => {
  it("resolves every price-registry entry's fallback markup through the catalog", () => {
    for (const entry of PROVIDER_PRICE_REGISTRY) {
      const expected = markupMultiplierFor(entry.billingCategory ?? null);
      expect(markupMultiplierForEntry(entry)).toBe(expected);
    }
  });

  it("lets the TASK, not the model, decide the multiplier", () => {
    // The same text entry bills at both rates depending on what it produced.
    const text = PROVIDER_PRICE_REGISTRY.find((e) => e.modelId === "gpt-4.1")!;
    expect(markupMultiplierForEntry(text, "generation")).toBe(2.0);
    expect(markupMultiplierForEntry(text, "analysis")).toBe(1.5);
    expect(markupMultiplierForEntry(text)).toBe(1.5); // uncategorised → default
  });

  it("bills the image entry at 2.0 even with no task category given", () => {
    const image = PROVIDER_PRICE_REGISTRY.find((e) => e.modelId === GEMINI_IMAGE_MODEL_ID)!;
    expect(markupMultiplierForEntry(image)).toBe(2.0);
    expect(image.billingCategory).toBe("generation");
  });

  it("never marks an uncategorised TEXT charge up above the pre-change rate", () => {
    // Image entries are the one case where the model can only ever perform a
    // generation task, so their fallback is 2.0 by construction.
    const imageIds = IMAGE_MODEL_REGISTRY.map((m) => m.id);
    for (const entry of PROVIDER_PRICE_REGISTRY) {
      if (imageIds.includes(entry.modelId)) continue;
      expect(markupMultiplierForEntry(entry), entry.modelId).toBe(1.5);
    }
  });

  it("prices EVERY selectable image model, at the same 2.0 generation rate", () => {
    expect(unpricedImageModels()).toEqual([]);
    for (const model of IMAGE_MODEL_REGISTRY) {
      const entry = PROVIDER_PRICE_REGISTRY.find((e) => e.modelId === model.id)!;
      expect(entry.rate.perImageCents, model.id).toBeGreaterThan(0);
      expect(entry.rate.rateVersion).toBe(model.rateVersionPrefix);
      expect(markupMultiplierForEntry(entry), model.id).toBe(2.0);
    }
  });

  it("prices the image entry per image, not per token", () => {
    const entry = PROVIDER_PRICE_REGISTRY.find((e) => e.modelId === GEMINI_IMAGE_MODEL_ID);
    expect(entry).toBeDefined();
    expect(entry!.rate.perImageCents).toBeGreaterThan(0);
    expect(entry!.rate.inputCentsPerMillionTokens).toBe(0);
    expect(entry!.rate.outputCentsPerMillionTokens).toBe(0);
  });
});

describe("customerChargeCents", () => {
  it("is byte-identical to the pre-change 1.50 formula for every cost 0..5000", () => {
    for (let cost = 0; cost <= 5_000; cost += 1) {
      const legacy = Math.ceil((cost * USAGE_MARKUP_NUMERATOR) / USAGE_MARKUP_DENOMINATOR);
      expect(customerChargeCents(cost)).toBe(legacy);
      expect(customerChargeCents(cost, 1.5)).toBe(legacy);
    }
  });

  it("doubles the provider cost at the image multiplier", () => {
    expect(customerChargeCents(24, 2.0)).toBe(48);
    expect(customerChargeCents(1, 2.0)).toBe(2);
    expect(customerChargeCents(0, 2.0)).toBe(0);
  });

  it("rounds up to the nearest cent at both rates", () => {
    expect(customerChargeCents(1, 1.5)).toBe(2); // 1.5 → 2
    expect(customerChargeCents(3, 1.5)).toBe(5); // 4.5 → 5
    expect(customerChargeCents(3, 2.0)).toBe(6); // exact
  });

  it("rejects non-integer or negative provider costs", () => {
    expect(() => customerChargeCents(-1)).toThrow();
    expect(() => customerChargeCents(1.5)).toThrow();
  });
});

describe("mixed-multiplier runs", () => {
  const mixed = [
    { providerCostCents: 7, markupMultiplier: 1.5, label: "planning tokens" },
    { providerCostCents: 24, markupMultiplier: 2.0, label: "image 1" },
    { providerCostCents: 24, markupMultiplier: 2.0, label: "image 2" },
  ];

  it("marks each component up at its own rate", () => {
    // 7 × 1.5 = 10.5 → 11; 24 × 2 = 48 twice.
    expect(customerChargeForComponents(mixed)).toBe(11 + 48 + 48);
    expect(providerCostForComponents(mixed)).toBe(55);
  });

  it("settles a mixed run at the component-weighted total", () => {
    const wallet: Wallet = { balanceCents: 1_000, reservedCents: 0 };
    const reserved = reserve(wallet, [], {
      id: "res-1",
      idempotencyKey: "figures:draft-1",
      amountCents: 200,
      rateVersion: "2026-08-01.figures",
      markupMultiplier: 2.0,
    });
    expect(reserved.ok).toBe(true);
    if (!reserved.ok) return;

    const settled = settle(reserved.wallet, reserved.reservation, 55, mixed);
    expect(settled.ok).toBe(true);
    if (!settled.ok) return;
    expect(settled.customerChargeCents).toBe(107);
    expect(settled.reservation.settledProviderCostCents).toBe(55);
    expect(settled.reservation.settledCustomerChargeCents).toBe(107);
    // The unspent remainder of the hold is released.
    expect(settled.wallet.reservedCents).toBe(0);
    expect(settled.wallet.balanceCents).toBe(1_000 - 107);
  });

  it("uses the reservation's own multiplier when no components are given", () => {
    const wallet: Wallet = { balanceCents: 500, reservedCents: 0 };
    const reserved = reserve(wallet, [], {
      id: "res-2",
      idempotencyKey: "images-only",
      amountCents: 100,
      rateVersion: "2026-08-01.google.gemini-3-pro-image",
      markupMultiplier: 2.0,
    });
    expect(reserved.ok).toBe(true);
    if (!reserved.ok) return;
    const settled = settle(reserved.wallet, reserved.reservation, 24);
    expect(settled.ok).toBe(true);
    if (settled.ok) expect(settled.customerChargeCents).toBe(48);
  });

  it("still defaults an unmarked reservation to 1.5 (legacy rows)", () => {
    const legacy: Reservation = {
      id: "res-legacy",
      idempotencyKey: "legacy",
      amountCents: 100,
      rateVersion: "2026-07-01.openai.gpt-4.1",
      status: "held",
    };
    const settled = settle({ balanceCents: 500, reservedCents: 100 }, legacy, 20);
    expect(settled.ok).toBe(true);
    if (settled.ok) expect(settled.customerChargeCents).toBe(30);
  });

  it("refuses to settle above the reservation ceiling", () => {
    const reserved: Reservation = {
      id: "res-3",
      idempotencyKey: "tight",
      amountCents: 10,
      rateVersion: "r",
      markupMultiplier: 2.0,
      status: "held",
    };
    const settled = settle({ balanceCents: 500, reservedCents: 10 }, reserved, 100);
    expect(settled.ok).toBe(false);
    if (!settled.ok) expect(settled.error).toBe("charge_exceeds_reservation");
  });

  it("releases a failed run without charging, at either rate", () => {
    const reserved: Reservation = {
      id: "res-4",
      idempotencyKey: "failed",
      amountCents: 96,
      rateVersion: "r",
      markupMultiplier: 2.0,
      status: "held",
    };
    const released = release({ balanceCents: 500, reservedCents: 96 }, reserved);
    expect(released.ok).toBe(true);
    if (!released.ok) return;
    expect(released.wallet.balanceCents).toBe(500);
    expect(released.wallet.reservedCents).toBe(0);
    expect(released.reservation.status).toBe("released");
  });
});

describe("estimateUsage", () => {
  const textRate = {
    rateVersion: "2026-07-01.openai.gpt-4.1",
    inputCentsPerMillionTokens: 200,
    outputCentsPerMillionTokens: 800,
  };

  it("keeps existing token estimates byte-identical at the default rate", () => {
    const estimate = estimateUsage({
      rate: textRate,
      estimatedInputTokens: 100_000,
      estimatedOutputTokensLow: 600,
      estimatedOutputTokensHigh: 4_000,
    });
    expect(estimate.providerLowCents).toBe(20 + 1);
    expect(estimate.providerHighCents).toBe(20 + 4);
    expect(estimate.customerLowCents).toBe(Math.ceil(21 * 1.5));
    expect(estimate.customerHighCents).toBe(Math.ceil(24 * 1.5));
    expect(estimate.markupMultiplier).toBe(1.5);
  });

  it("estimates per-image runs at the image multiplier", () => {
    const imageRate = {
      rateVersion: "2026-08-01.google.gemini-3-pro-image",
      inputCentsPerMillionTokens: 0,
      outputCentsPerMillionTokens: 0,
      perImageCents: 24,
    };
    const estimate = estimateUsage({
      rate: imageRate,
      estimatedInputTokens: 0,
      estimatedOutputTokensLow: 0,
      estimatedOutputTokensHigh: 0,
      estimatedImagesLow: 2,
      estimatedImagesHigh: 4,
      markupMultiplier: 2.0,
    });
    expect(estimate.providerLowCents).toBe(48);
    expect(estimate.providerHighCents).toBe(96);
    expect(estimate.customerLowCents).toBe(96);
    expect(estimate.customerHighCents).toBe(192);
    expect(estimate.markupMultiplier).toBe(2.0);
  });

  it("combines a mixed estimate without re-applying a multiplier", () => {
    const tokens = estimateUsage({
      rate: textRate,
      estimatedInputTokens: 100_000,
      estimatedOutputTokensLow: 600,
      estimatedOutputTokensHigh: 4_000,
    });
    const images = estimateUsage({
      rate: {
        rateVersion: "img",
        inputCentsPerMillionTokens: 0,
        outputCentsPerMillionTokens: 0,
        perImageCents: 24,
      },
      estimatedInputTokens: 0,
      estimatedOutputTokensLow: 0,
      estimatedOutputTokensHigh: 0,
      estimatedImagesLow: 1,
      estimatedImagesHigh: 3,
      markupMultiplier: 2.0,
    });
    const combined = combineEstimates([tokens, images], "figures-run");
    expect(combined.customerLowCents).toBe(tokens.customerLowCents + images.customerLowCents);
    expect(combined.customerHighCents).toBe(tokens.customerHighCents + images.customerHighCents);
    expect(combined.providerHighCents).toBe(tokens.providerHighCents + images.providerHighCents);
  });
});

describe("disclosure consistency with the price registry", () => {
  /**
   * Guards the substantiation problem directly (docs/legal-ethics-risk-memo):
   * a customer-facing page must never state a markup that differs from what
   * the price registry actually charges. Both halves are checked —
   * the derived sentence agrees with the registry, and no surface hard-codes
   * a competing number.
   *
   * BOTH LANES are asserted. The earlier round left Lex at a hard-coded 1.50
   * on the reasoning that Lex had no image generation; the rule is by task
   * type, so Lex's drafting workflows are generation and that copy was wrong.
   */
  const WEPATENT_SURFACES = [
    "src/app/wepatent/app/billing/page.tsx",
    "src/app/wepatent/pricing/page.tsx",
    "src/app/wepatent/ai-disclosure/page.tsx",
    "src/app/wepatent/app/inventions/[id]/drafts/page.tsx",
    "src/app/wepatent/app/inventions/[id]/studio/page.tsx",
    "src/components/wepatent/MeshViewer.tsx",
    "src/components/wepatent/InterviewPanel.tsx",
  ];

  /** Lex lane: public marketing + in-app copy that states the rate. */
  const LEX_SURFACES = [
    "src/app/pricing/page.tsx",
    "src/app/models/page.tsx",
    "src/app/app/usage/page.tsx",
    "src/app/app/settings/page.tsx",
    "src/app/app/matters/[matterId]/Composer.tsx",
  ];

  /** States the rate in prose rather than importing it. Checked for accuracy. */
  const PROSE_SURFACES = [
    "src/app/page.tsx",
    "src/app/legal/terms/page.tsx",
    "src/app/professionals/page.tsx",
  ];

  it("derives the published sentence from the multipliers the registry resolves", () => {
    const registryMultipliers = new Set(
      PROVIDER_PRICE_REGISTRY.map((entry) => markupMultiplierForEntry(entry)),
    );
    // Every rate the registry can apply, under either task category.
    registryMultipliers.add(MARKUP_MULTIPLIERS.generation);
    registryMultipliers.add(MARKUP_MULTIPLIERS.analysis);
    for (const multiplier of registryMultipliers) {
      expect(markupDisclosure()).toContain(multiplier.toFixed(1));
    }
    // And nothing is advertised that the catalog does not actually apply.
    const advertised = [...markupDisclosure().matchAll(/× (\d\.\d)/g)].map((m) => Number(m[1]));
    for (const value of advertised) {
      expect(Object.values(MARKUP_MULTIPLIERS)).toContain(value);
    }
  });

  it("leaves no stale hard-coded markup on any wepatent surface", async () => {
    const { readFile } = await import("node:fs/promises");
    for (const surface of WEPATENT_SURFACES) {
      const source = await readFile(surface, "utf8");
      expect(source, `${surface} still hard-codes a markup`).not.toMatch(
        /(?:×|x|multiplied by)\s*1\.50\b/,
      );
      expect(source, `${surface} does not derive its rate from the catalog`).toMatch(
        /from "@\/lib\/(shared\/billing|wepatent\/domain)\/markup"/,
      );
    }
  });

  it("leaves no stale hard-coded markup on any Lex surface", async () => {
    const { readFile } = await import("node:fs/promises");
    for (const surface of LEX_SURFACES) {
      const source = await readFile(surface, "utf8");
      expect(source, `${surface} still hard-codes the old 1.50 rate`).not.toMatch(
        /(?:×|x|multiplied by)\s*1\.50\b/,
      );
      expect(source, `${surface} does not derive its rate from the catalog`).toMatch(
        /@\/lib\/(shared\/billing\/(markup|task-category)|domain\/pricing)/,
      );
    }
  });

  it("states BOTH rates accurately on every prose surface in either lane", async () => {
    const { readFile } = await import("node:fs/promises");
    const generation = MARKUP_MULTIPLIERS.generation.toFixed(1);
    const analysis = MARKUP_MULTIPLIERS.analysis.toFixed(1);
    for (const surface of [...PROSE_SURFACES]) {
      const source = await readFile(surface, "utf8");
      expect(source, `${surface} still states the retired single 1.50 rate`).not.toMatch(
        /(?:×|x)\s*1\.50\b/,
      );
      expect(source, `${surface} omits the generation rate`).toContain(`× ${generation}`);
      expect(source, `${surface} omits the analysis rate`).toContain(`× ${analysis}`);
    }
  });

  it("states the current rate in the wepatent PRD FR-6 text", async () => {
    const { readFile } = await import("node:fs/promises");
    const prd = await readFile("docs/PRD-wepatent.md", "utf8");
    expect(prd).toContain(markupDisclosure());
    expect(prd).toContain("2.00");
  });

  it("states the current rate in the Lex PRD FR-9 text", async () => {
    const { readFile } = await import("node:fs/promises");
    const prd = await readFile("docs/PRD-lex-patent-studio.md", "utf8");
    expect(prd).toContain(markupDisclosure());
    expect(prd, "Lex PRD must no longer publish a flat 1.50").not.toMatch(
      /(?:×|x)\s*1\.50\b/,
    );
  });
});
