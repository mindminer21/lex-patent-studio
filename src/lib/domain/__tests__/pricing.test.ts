import { describe, expect, it } from "vitest";
import {
  estimateCharge,
  getModel,
  MODEL_CATALOG,
  modelsForTier,
  providerCostUsd,
  USAGE_MARKUP,
  walletSufficient,
} from "@/lib/domain/pricing";

describe("cost-estimate math (FR-9: provider cost × 1.50)", () => {
  const sonnet = getModel("claude-sonnet-4-5")!;

  it("markup is exactly 1.50", () => {
    expect(USAGE_MARKUP).toBe(1.5);
  });

  it("provider cost math: per-1M-token rates", () => {
    // 1M input at $3 + 1M output at $15 = $18
    expect(
      providerCostUsd(sonnet, { inputTokens: 1_000_000, outputTokens: 1_000_000 }),
    ).toBeCloseTo(18, 10);
    // 100k input + 20k output = 0.3 + 0.3 = 0.6
    expect(
      providerCostUsd(sonnet, { inputTokens: 100_000, outputTokens: 20_000 }),
    ).toBeCloseTo(0.6, 10);
  });

  it("expected charge is provider cost × 1.50, rounded to cents", () => {
    const est = estimateCharge(sonnet, {
      inputTokens: 100_000,
      outputTokens: 20_000,
      variance: 0.35,
    });
    expect(est.providerCostUsd).toBe(0.6);
    expect(est.expectedChargeUsd).toBe(0.9); // 0.6 × 1.5
    expect(est.markup).toBe(1.5);
  });

  it("range spans the disclosed variance band around the expected charge", () => {
    const est = estimateCharge(sonnet, {
      inputTokens: 200_000,
      outputTokens: 40_000,
      variance: 0.25,
    });
    expect(est.expectedChargeUsd).toBeCloseTo(1.8, 2); // (0.6+0.6)*1.5
    expect(est.lowChargeUsd).toBeCloseTo(1.35, 2);
    expect(est.highChargeUsd).toBeCloseTo(2.25, 2);
    expect(est.lowChargeUsd).toBeLessThan(est.expectedChargeUsd);
    expect(est.highChargeUsd).toBeGreaterThan(est.expectedChargeUsd);
  });

  it("rejects nonsensical variance", () => {
    expect(() =>
      estimateCharge(sonnet, { inputTokens: 1, outputTokens: 1, variance: 1 }),
    ).toThrow();
    expect(() =>
      estimateCharge(sonnet, { inputTokens: 1, outputTokens: 1, variance: -0.1 }),
    ).toThrow();
  });

  it("wallet sufficiency compares against the HIGH end of the estimate", () => {
    const est = estimateCharge(sonnet, {
      inputTokens: 200_000,
      outputTokens: 40_000,
      variance: 0.25,
    });
    expect(walletSufficient(est.highChargeUsd, est)).toBe(true);
    expect(walletSufficient(est.highChargeUsd - 0.01, est)).toBe(false);
    expect(walletSufficient(est.expectedChargeUsd, est)).toBe(false);
  });

  it("every catalog entry has positive, effective-dated rates and a valid tier", () => {
    expect(MODEL_CATALOG.length).toBeGreaterThanOrEqual(6);
    for (const m of MODEL_CATALOG) {
      expect(m.inputPerMTokUsd).toBeGreaterThan(0);
      expect(m.outputPerMTokUsd).toBeGreaterThan(0);
      expect(m.effectiveDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(["fast", "advanced", "frontier"]).toContain(m.tier);
    }
  });

  it("each model tier offers at least two providers to pick from", () => {
    for (const tier of ["fast", "advanced", "frontier"] as const) {
      const providers = new Set(modelsForTier(tier).map((m) => m.provider));
      expect(providers.size).toBeGreaterThanOrEqual(2);
    }
  });
});
