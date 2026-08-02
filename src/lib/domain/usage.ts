/**
 * Usage reservation and settlement math (PRD FR-6, §7.4).
 *
 * All money is integer USD cents. Customer charge = actual provider cost
 * × 1.50, rounded up to the nearest cent. Reservations are idempotent, are
 * capped by available (unreserved) wallet balance, and cannot be settled
 * twice. Every settled event retains the effective rate version, provider
 * cost, markup, and customer charge.
 */
export const USAGE_MARKUP_NUMERATOR = 150;
export const USAGE_MARKUP_DENOMINATOR = 100;

export function customerChargeCents(providerCostCents: number): number {
  if (!Number.isInteger(providerCostCents) || providerCostCents < 0) {
    throw new Error("providerCostCents must be a non-negative integer");
  }
  return Math.ceil((providerCostCents * USAGE_MARKUP_NUMERATOR) / USAGE_MARKUP_DENOMINATOR);
}

export type ModelRate = {
  /** Effective-dated rate version identifier, e.g. "2026-07-01.anthropic.tier2". */
  rateVersion: string;
  inputCentsPerMillionTokens: number;
  outputCentsPerMillionTokens: number;
};

export type UsageEstimate = {
  rateVersion: string;
  providerLowCents: number;
  providerHighCents: number;
  customerLowCents: number;
  customerHighCents: number;
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
}): UsageEstimate {
  const { rate, estimatedInputTokens, estimatedOutputTokensLow, estimatedOutputTokensHigh } =
    params;
  if (estimatedOutputTokensHigh < estimatedOutputTokensLow) {
    throw new Error("estimatedOutputTokensHigh must be >= estimatedOutputTokensLow");
  }
  const inputCost = Math.ceil((estimatedInputTokens * rate.inputCentsPerMillionTokens) / 1_000_000);
  const outLow = Math.ceil(
    (estimatedOutputTokensLow * rate.outputCentsPerMillionTokens) / 1_000_000,
  );
  const outHigh = Math.ceil(
    (estimatedOutputTokensHigh * rate.outputCentsPerMillionTokens) / 1_000_000,
  );
  const providerLowCents = inputCost + outLow;
  const providerHighCents = inputCost + outHigh;
  return {
    rateVersion: rate.rateVersion,
    providerLowCents,
    providerHighCents,
    customerLowCents: customerChargeCents(providerLowCents),
    customerHighCents: customerChargeCents(providerHighCents),
  };
}

export type ReservationStatus = "held" | "settled" | "released";

export type Reservation = {
  id: string;
  idempotencyKey: string;
  amountCents: number; // customer-charge cents held against the wallet
  rateVersion: string;
  status: ReservationStatus;
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
  params: { id: string; idempotencyKey: string; amountCents: number; rateVersion: string },
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
 * × 1.50 and can never exceed the reserved amount (token caps guarantee the
 * reservation is the budget ceiling). The unspent remainder is released.
 */
export function settle(
  wallet: Wallet,
  reservation: Reservation,
  providerCostCents: number,
): SettleResult {
  if (reservation.status !== "held") return { ok: false, error: "not_held" };
  const charge = customerChargeCents(providerCostCents);
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
