/**
 * Layer-1 IMAGE-MODEL REGISTRY and selection (Jeff's directive, 2026-08-04:
 * "Make the default model for image generation nano banana 2, or if it is
 * better output, use gemini pro 3.").
 *
 * WHAT THIS MODULE DECIDES, AND WHAT IT DOES NOT
 * ----------------------------------------------
 * It decides WHICH image model the figure pipeline calls. It does not decide
 * which one is better, because we have no evidence yet — see
 * docs/PATENT-FIGURES.md §"Choosing the image model". Nano Banana 2 (Gemini
 * 3 Pro Image) is the configured default because it is the model the Layer-1
 * prompt contract was written and unit-tested against, not because it has
 * been shown to out-draw the alternative.
 *
 * The choice is therefore a CONFIG decision, switchable with the
 * `FIGURES_IMAGE_MODEL` environment variable, with no code change and no
 * redeploy of application logic:
 *
 *     FIGURES_IMAGE_MODEL=gemini-3-pro-image     # default, Nano Banana 2
 *     FIGURES_IMAGE_MODEL=gemini-2.5-flash-image # alternative
 *
 * Both entries:
 * - carry their OWN effective-dated price entry in PROVIDER_PRICE_REGISTRY,
 *   so a switch re-prices honestly rather than billing one model's rate for
 *   another's work;
 * - bill at the SAME 2.0 generation multiplier, because the multiplier is a
 *   property of the task (image generation is generation), not the model;
 * - go through the SAME Layer-1 hygiene gate — no color, no solid black,
 *   NO TEXT — so neither can lower the bar for what reaches Layer 2.
 *
 * An unknown or unlisted value is REFUSED at resolution time rather than
 * silently falling back: a typo in the env var must not quietly send spend
 * to a model nobody priced.
 */

/** The model the pipeline calls unless configuration says otherwise. */
export const GEMINI_IMAGE_MODEL_ID = "gemini-3-pro-image";

/**
 * The alternative Gemini image model. Selectable today; not enabled, not
 * recommended, and not claimed to be better or worse.
 */
export const GEMINI_ALT_IMAGE_MODEL_ID = "gemini-2.5-flash-image";

export type ImageModelEntry = {
  /** Provider model identifier sent on the wire. */
  id: string;
  /** How it is referred to in product copy and runbooks. */
  displayName: string;
  /** Matches the `rateVersion` of its PROVIDER_PRICE_REGISTRY entry. */
  rateVersionPrefix: string;
  /** Why this entry exists. Shown in the runbook, not to customers. */
  note: string;
};

/**
 * Every image model the pipeline is allowed to select. Adding one here is
 * not sufficient to use it — it also needs a price entry in
 * PROVIDER_PRICE_REGISTRY, and `imageModelsArePriced()` (asserted in tests)
 * fails the build if the two lists disagree.
 */
export const IMAGE_MODEL_REGISTRY: readonly ImageModelEntry[] = [
  {
    id: GEMINI_IMAGE_MODEL_ID,
    displayName: "Nano Banana 2 (Gemini 3 Pro Image)",
    rateVersionPrefix: "2026-08-01.google.gemini-3-pro-image",
    note: "Configured default. The Layer-1 prompt contract (patent-line-art-v1) was written and unit-tested against this model.",
  },
  {
    id: GEMINI_ALT_IMAGE_MODEL_ID,
    displayName: "Gemini 2.5 Flash Image",
    rateVersionPrefix: "2026-08-01.google.gemini-2.5-flash-image",
    note: "Selectable alternative. Cheaper per image. NO quality comparison has been run against Nano Banana 2 — see docs/PATENT-FIGURES.md before switching.",
  },
];

export const DEFAULT_IMAGE_MODEL_ID = GEMINI_IMAGE_MODEL_ID;

export function isKnownImageModel(modelId: string): boolean {
  return IMAGE_MODEL_REGISTRY.some((entry) => entry.id === modelId);
}

export function getImageModel(modelId: string): ImageModelEntry | null {
  return IMAGE_MODEL_REGISTRY.find((entry) => entry.id === modelId) ?? null;
}

export type ImageModelResolution =
  | { ok: true; entry: ImageModelEntry; fromEnv: boolean }
  | { ok: false; error: "unknown_image_model"; requested: string; allowed: string[] };

/**
 * Resolve the configured image model.
 *
 * `configured` is the raw `FIGURES_IMAGE_MODEL` value. Empty/absent selects
 * the default. An unrecognised value is an ERROR, not a fallback — the
 * pipeline refuses and says which ids are allowed, so a misconfiguration
 * surfaces as an honest "unavailable" instead of unpriced spend.
 */
export function resolveImageModel(configured?: string | null): ImageModelResolution {
  const requested = (configured ?? "").trim();
  if (requested.length === 0) {
    return { ok: true, entry: getImageModel(DEFAULT_IMAGE_MODEL_ID)!, fromEnv: false };
  }
  const entry = getImageModel(requested);
  if (!entry) {
    return {
      ok: false,
      error: "unknown_image_model",
      requested,
      allowed: IMAGE_MODEL_REGISTRY.map((e) => e.id),
    };
  }
  return { ok: true, entry, fromEnv: true };
}
