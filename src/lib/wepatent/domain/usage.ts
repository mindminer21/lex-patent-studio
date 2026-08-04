/**
 * Usage reservation and settlement math (PRD FR-6, §7.4).
 *
 * All money is integer USD cents. Customer charge = actual provider cost ×
 * the retail multiplier for that charge's billing category, rounded up to
 * the nearest cent. The multiplier catalog lives in `domain/markup.ts`
 * (1.5 for text/transcription; 2.0 for image generation). Reservations are
 * idempotent, are capped by available (unreserved) wallet balance, and
 * cannot be settled twice. Every settled event retains the effective rate
 * version, provider cost, the multiplier applied, and the customer charge.
 */
import { DEFAULT_MARKUP_MULTIPLIER, markupBasisPoints } from "./markup";

/**
 * Legacy 1.50 constants. Retained because they are the platform default and
 * several call sites and tests assert on them directly; the general path is
 * `customerChargeCents(cost, multiplier)`.
 */
export const USAGE_MARKUP_NUMERATOR = 150;
export const USAGE_MARKUP_DENOMINATOR = 100;

/**
 * Customer charge for a provider cost at a given retail multiplier.
 *
 * Defaults to 1.50 so every existing call site keeps byte-identical
 * behavior. Basis-point integer math keeps the result exact.
 */
export function customerChargeCents(
  providerCostCents: number,
  markupMultiplier: number = DEFAULT_MARKUP_MULTIPLIER,
): number {
  if (!Number.isInteger(providerCostCents) || providerCostCents < 0) {
    throw new Error("providerCostCents must be a non-negative integer");
  }
  return Math.ceil((providerCostCents * markupBasisPoints(markupMultiplier)) / 10_000);
}

/**
 * One priced component of a run: provider cost plus the multiplier that
 * applies to it. A mixed run (planner tokens at 1.5 + generated images at
 * 2.0) is a list of these.
 */
export type ChargeComponent = {
  providerCostCents: number;
  markupMultiplier: number;
  /** Free-form label for the settled event's audit note, e.g. "images". */
  label?: string;
};

/**
 * Total customer charge for a mixed-multiplier run. Each component rounds
 * up independently — that is the same rounding the single-component path
 * uses, so splitting or merging a run never changes the arithmetic in the
 * customer's favor or ours by more than the per-component ceiling.
 */
export function customerChargeForComponents(components: readonly ChargeComponent[]): number {
  return components.reduce(
    (sum, component) =>
      sum + customerChargeCents(component.providerCostCents, component.markupMultiplier),
    0,
  );
}

/** Total provider cost across a mixed run's components. */
export function providerCostForComponents(components: readonly ChargeComponent[]): number {
  return components.reduce((sum, component) => sum + component.providerCostCents, 0);
}

export type ModelRate = {
  /** Effective-dated rate version identifier, e.g. "2026-07-01.anthropic.tier2". */
  rateVersion: string;
  inputCentsPerMillionTokens: number;
  outputCentsPerMillionTokens: number;
  /**
   * Per-image provider cost for image-generation models (Gemini/Nano Banana
   * 2). Token fields stay 0 for those entries — images are not token-priced.
   */
  perImageCents?: number;
};

export type UsageEstimate = {
  rateVersion: string;
  providerLowCents: number;
  providerHighCents: number;
  customerLowCents: number;
  customerHighCents: number;
  /** The retail multiplier this estimate was computed at. */
  markupMultiplier: number;
};

/**
 * Estimate a run's provider cost range and the corresponding customer
 * charges. The high bound (with a safety factor) is what gets reserved.
 */
export function estimateUsage(params: {
  rate: ModelRate;
  estimatedInputTokens: number;
  estimatedOutputTokensLow: number;
  estimatedOutputTokensHigh: number;
  /** Retail multiplier for this charge's category. Defaults to 1.50. */
  markupMultiplier?: number;
  /** Images generated in this run (image-priced entries only). */
  estimatedImagesLow?: number;
  estimatedImagesHigh?: number;
}): UsageEstimate {
  const { rate, estimatedInputTokens, estimatedOutputTokensLow, estimatedOutputTokensHigh } =
    params;
  const markupMultiplier = params.markupMultiplier ?? DEFAULT_MARKUP_MULTIPLIER;
  if (estimatedOutputTokensHigh < estimatedOutputTokensLow) {
    throw new Error("estimatedOutputTokensHigh must be >= estimatedOutputTokensLow");
  }
  const imagesLow = params.estimatedImagesLow ?? 0;
  const imagesHigh = params.estimatedImagesHigh ?? imagesLow;
  if (imagesHigh < imagesLow) {
    throw new Error("estimatedImagesHigh must be >= estimatedImagesLow");
  }
  const perImage = rate.perImageCents ?? 0;
  const inputCost = Math.ceil((estimatedInputTokens * rate.inputCentsPerMillionTokens) / 1_000_000);
  const outLow = Math.ceil(
    (estimatedOutputTokensLow * rate.outputCentsPerMillionTokens) / 1_000_000,
  );
  const outHigh = Math.ceil(
    (estimatedOutputTokensHigh * rate.outputCentsPerMillionTokens) / 1_000_000,
  );
  const providerLowCents = inputCost + outLow + imagesLow * perImage;
  const providerHighCents = inputCost + outHigh + imagesHigh * perImage;
  return {
    rateVersion: rate.rateVersion,
    providerLowCents,
    providerHighCents,
    customerLowCents: customerChargeCents(providerLowCents, markupMultiplier),
    customerHighCents: customerChargeCents(providerHighCents, markupMultiplier),
    markupMultiplier,
  };
}

/**
 * Combine several per-category estimates into one run-level estimate (e.g.
 * planner tokens at 1.5 plus N images at 2.0). The combined estimate keeps
 * the DEFAULT multiplier as its nominal `markupMultiplier` only for display
 * fallback — the customer bounds are already the correctly-weighted sums, so
 * callers must never re-apply a multiplier to them.
 */
export function combineEstimates(
  parts: readonly UsageEstimate[],
  rateVersion: string,
): UsageEstimate {
  const sum = (pick: (e: UsageEstimate) => number) =>
    parts.reduce((total, part) => total + pick(part), 0);
  const multipliers = [...new Set(parts.map((part) => part.markupMultiplier))];
  return {
    rateVersion,
    providerLowCents: sum((e) => e.providerLowCents),
    providerHighCents: sum((e) => e.providerHighCents),
    customerLowCents: sum((e) => e.customerLowCents),
    customerHighCents: sum((e) => e.customerHighCents),
    markupMultiplier:
      multipliers.length === 1 ? multipliers[0] : DEFAULT_MARKUP_MULTIPLIER,
  };
}

export type ReservationStatus = "held" | "settled" | "released";

export type Reservation = {
  id: string;
  idempotencyKey: string;
  amountCents: number; // customer-charge cents held against the wallet
  rateVersion: string;
  status: ReservationStatus;
  /**
   * Retail multiplier this reservation was priced at, carried through to
   * settlement so the stored usage event records exactly what was applied.
   * Absent on pre-2026-08 rows, which are all 1.50 by construction.
   */
  markupMultiplier?: number;
  settledProviderCostCents?: number;
  settledCustomerChargeCents?: number;
};

export type Wallet = {
  balanceCents: number;
  reservedCents: number;
};

export function availableCents(wallet: Wallet): number {
  return wallet.balanceCents - wallet.reservedCents;
}

export type ReserveResult =
  | { ok: true; wallet: Wallet; reservation: Reservation; deduplicated: boolean }
  | { ok: false; error: "insufficient_funds" | "invalid_amount" };

/**
 * Idempotent reservation: the same idempotency key returns the existing
 * reservation without double-holding funds. No generation may begin when
 * this fails (PRD §7.4).
 */
export function reserve(
  wallet: Wallet,
  existing: readonly Reservation[],
  params: {
    id: string;
    idempotencyKey: string;
    amountCents: number;
    rateVersion: string;
    markupMultiplier?: number;
  },
): ReserveResult {
  const duplicate = existing.find(
    (r) => r.idempotencyKey === params.idempotencyKey && r.status !== "released",
  );
  if (duplicate) {
    return { ok: true, wallet, reservation: duplicate, deduplicated: true };
  }
  if (!Number.isInteger(params.amountCents) || params.amountCents <= 0) {
    return { ok: false, error: "invalid_amount" };
  }
  if (params.amountCents > availableCents(wallet)) {
    return { ok: false, error: "insufficient_funds" };
  }
  const reservation: Reservation = {
    id: params.id,
    idempotencyKey: params.idempotencyKey,
    amountCents: params.amountCents,
    rateVersion: params.rateVersion,
    markupMultiplier: params.markupMultiplier ?? DEFAULT_MARKUP_MULTIPLIER,
    status: "held",
  };
  return {
    ok: true,
    deduplicated: false,
    reservation,
    wallet: { ...wallet, reservedCents: wallet.reservedCents + params.amountCents },
  };
}

export type SettleResult =
  | {
      ok: true;
      wallet: Wallet;
      reservation: Reservation;
      customerChargeCents: number;
    }
  | { ok: false; error: "not_held" | "charge_exceeds_reservation" };

/**
 * Settle from provider-reported usage. The customer charge is provider cost
 * × the reservation's retail multiplier (1.50 unless the reservation was
 * priced otherwise) and can never exceed the reserved amount — token/image
 * caps guarantee the reservation is the budget ceiling. The unspent
 * remainder is released.
 *
 * `components` settles a MIXED run: pass the per-category provider costs and
 * their multipliers (planner tokens at 1.5, generated images at 2.0) and
 * each is marked up independently before summing.
 */
export function settle(
  wallet: Wallet,
  reservation: Reservation,
  providerCostCents: number,
  components?: readonly ChargeComponent[],
): SettleResult {
  if (reservation.status !== "held") return { ok: false, error: "not_held" };
  const charge =
    components && components.length > 0
      ? customerChargeForComponents(components)
      : customerChargeCents(
          providerCostCents,
          reservation.markupMultiplier ?? DEFAULT_MARKUP_MULTIPLIER,
        );
  if (charge > reservation.amountCents) {
    return { ok: false, error: "charge_exceeds_reservation" };
  }
  return {
    ok: true,
    customerChargeCents: charge,
    reservation: {
      ...reservation,
      status: "settled",
      settledProviderCostCents: providerCostCents,
      settledCustomerChargeCents: charge,
    },
    wallet: {
      balanceCents: wallet.balanceCents - charge,
      reservedCents: wallet.reservedCents - reservation.amountCents,
    },
  };
}

export type ReleaseResult =
  | { ok: true; wallet: Wallet; reservation: Reservation }
  | { ok: false; error: "not_held" };

/** Release a held reservation without charging (failed/cancelled run). */
export function release(wallet: Wallet, reservation: Reservation): ReleaseResult {
  if (reservation.status !== "held") return { ok: false, error: "not_held" };
  return {
    ok: true,
    reservation: { ...reservation, status: "released" },
    wallet: { ...wallet, reservedCents: wallet.reservedCents - reservation.amountCents },
  };
}
