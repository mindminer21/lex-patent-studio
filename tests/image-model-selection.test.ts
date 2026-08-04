import { describe, expect, it } from "vitest";
import {
  DEFAULT_IMAGE_MODEL_ID,
  GEMINI_ALT_IMAGE_MODEL_ID,
  GEMINI_IMAGE_MODEL_ID,
  getImageModel,
  IMAGE_MODEL_REGISTRY,
  isKnownImageModel,
  resolveImageModel,
} from "@/lib/server/figures/image-models";
import {
  markupMultiplierForEntry,
  PROVIDER_PRICE_REGISTRY,
  resolveProviderRate,
  unpricedImageModels,
} from "@/lib/server/adapters/production/model-gateway";

/**
 * Directive 2 (Jeff, 2026-08-04): "Make the default model for image
 * generation nano banana 2, or if it is better output, use gemini pro 3."
 *
 * Nano Banana 2 stays the configured default. The alternative is
 * selectable by configuration, with its own price entry and the same 2.0
 * generation multiplier. Nothing here asserts one draws better — we have no
 * evidence, and docs/PATENT-FIGURES.md says so explicitly.
 */

describe("image-model default", () => {
  it("keeps Nano Banana 2 (Gemini 3 Pro Image) as the default", () => {
    expect(DEFAULT_IMAGE_MODEL_ID).toBe("gemini-3-pro-image");
    expect(GEMINI_IMAGE_MODEL_ID).toBe(DEFAULT_IMAGE_MODEL_ID);
    expect(getImageModel(DEFAULT_IMAGE_MODEL_ID)?.displayName).toContain("Nano Banana 2");
  });

  it("selects the default when the env var is unset or blank", () => {
    for (const value of [undefined, null, "", "   "]) {
      const resolved = resolveImageModel(value);
      expect(resolved.ok).toBe(true);
      if (!resolved.ok) return;
      expect(resolved.entry.id).toBe(DEFAULT_IMAGE_MODEL_ID);
      expect(resolved.fromEnv).toBe(false);
    }
  });
});

describe("registry-level, env-overridable selection", () => {
  it("selects the alternative without a code change", () => {
    const resolved = resolveImageModel(GEMINI_ALT_IMAGE_MODEL_ID);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.entry.id).toBe(GEMINI_ALT_IMAGE_MODEL_ID);
    expect(resolved.fromEnv).toBe(true);
  });

  it("REFUSES an unknown id rather than falling back to the default", () => {
    const resolved = resolveImageModel("gpt-image-1");
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.error).toBe("unknown_image_model");
    expect(resolved.requested).toBe("gpt-image-1");
    // The message names what IS allowed, so a typo is self-diagnosing.
    expect(resolved.allowed).toContain(GEMINI_IMAGE_MODEL_ID);
    expect(resolved.allowed).toContain(GEMINI_ALT_IMAGE_MODEL_ID);
  });

  it("does not treat an unpriced id as known", () => {
    expect(isKnownImageModel("gemini-9-ultra-image")).toBe(false);
  });

  it("trims whitespace around a configured id", () => {
    const resolved = resolveImageModel(`  ${GEMINI_ALT_IMAGE_MODEL_ID}  `);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(resolved.entry.id).toBe(GEMINI_ALT_IMAGE_MODEL_ID);
  });
});

describe("each selectable model carries its own effective-dated price", () => {
  it("prices every registry entry, distinctly", () => {
    expect(unpricedImageModels()).toEqual([]);
    const rateVersions = new Set<string>();
    for (const model of IMAGE_MODEL_REGISTRY) {
      const entry = resolveProviderRate(model.id, new Date("2026-08-04"));
      expect(entry, model.id).not.toBeNull();
      expect(entry!.rate.perImageCents).toBeGreaterThan(0);
      rateVersions.add(entry!.rate.rateVersion);
    }
    // Switching the model must re-price, not reuse another model's version.
    expect(rateVersions.size).toBe(IMAGE_MODEL_REGISTRY.length);
  });

  it("bills every image model at the SAME 2.0 generation multiplier", () => {
    for (const model of IMAGE_MODEL_REGISTRY) {
      const entry = PROVIDER_PRICE_REGISTRY.find((e) => e.modelId === model.id)!;
      expect(entry.billingCategory).toBe("generation");
      expect(markupMultiplierForEntry(entry), model.id).toBe(2.0);
    }
  });

  it("claims no quality ordering between the two models", () => {
    // The registry note for the alternative must say we have not compared
    // them. This is a substantiation guard, not a style check.
    const alt = getImageModel(GEMINI_ALT_IMAGE_MODEL_ID)!;
    expect(alt.note).toContain("NO quality comparison");
    for (const model of IMAGE_MODEL_REGISTRY) {
      expect(model.note.toLowerCase()).not.toMatch(/\b(better|superior|best)\b/);
    }
  });
});
