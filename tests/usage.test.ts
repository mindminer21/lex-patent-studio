import { describe, expect, it } from "vitest";
import {
  availableCents,
  customerChargeCents,
  estimateUsage,
  release,
  reserve,
  settle,
  type ModelRate,
  type Wallet,
} from "@/lib/domain/usage";

const rate: ModelRate = {
  rateVersion: "test.rate.v1",
  inputCentsPerMillionTokens: 300,
  outputCentsPerMillionTokens: 1500,
};

describe("markup math (FR-6: cost × 1.50)", () => {
  it("applies exactly 1.5× and rounds up to the cent", () => {
    expect(customerChargeCents(100)).toBe(150);
    expect(customerChargeCents(1)).toBe(2); // 1.5 → ceil 2
    expect(customerChargeCents(3)).toBe(5); // 4.5 → ceil 5
    expect(customerChargeCents(0)).toBe(0);
  });

  it("rejects non-integer or negative provider costs", () => {
    expect(() => customerChargeCents(1.5)).toThrow();
    expect(() => customerChargeCents(-1)).toThrow();
  });
});

describe("estimation", () => {
  it("produces provider and customer ranges with the rate version", () => {
    const estimate = estimateUsage({
      rate,
      estimatedInputTokens: 1_000_000,
      estimatedOutputTokensLow: 100_000,
      estimatedOutputTokensHigh: 1_000_000,
    });
    expect(estimate.rateVersion).toBe("test.rate.v1");
    expect(estimate.providerLowCents).toBe(300 + 150);
    expect(estimate.providerHighCents).toBe(300 + 1500);
    expect(estimate.customerLowCents).toBe(customerChargeCents(450));
    expect(estimate.customerHighCents).toBe(customerChargeCents(1800));
    expect(estimate.customerHighCents).toBeGreaterThanOrEqual(estimate.customerLowCents);
  });

  it("rejects inverted output ranges", () => {
    expect(() =>
      estimateUsage({
        rate,
        estimatedInputTokens: 10,
        estimatedOutputTokensLow: 100,
        estimatedOutputTokensHigh: 50,
      }),
    ).toThrow();
  });
});

describe("reservation and settlement (PRD §7.4)", () => {
  const wallet: Wallet = { balanceCents: 1_000, reservedCents: 0 };

  it("reserves against available balance", () => {
    const result = reserve(wallet, [], {
      id: "r1",
      idempotencyKey: "k1",
      amountCents: 400,
      rateVersion: rate.rateVersion,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.wallet.reservedCents).toBe(400);
      expect(availableCents(result.wallet)).toBe(600);
    }
  });

  it("refuses reservations beyond available balance — no generation may begin", () => {
    const result = reserve({ balanceCents: 100, reservedCents: 50 }, [], {
      id: "r1",
      idempotencyKey: "k1",
      amountCents: 51,
      rateVersion: rate.rateVersion,
    });
    expect(result).toEqual({ ok: false, error: "insufficient_funds" });
  });

  it("is idempotent: the same key returns the existing hold without double-reserving", () => {
    const first = reserve(wallet, [], {
      id: "r1",
      idempotencyKey: "same-key",
      amountCents: 400,
      rateVersion: rate.rateVersion,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = reserve(first.wallet, [first.reservation], {
      id: "r2",
      idempotencyKey: "same-key",
      amountCents: 400,
      rateVersion: rate.rateVersion,
    });
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.deduplicated).toBe(true);
      expect(second.reservation.id).toBe("r1");
      expect(second.wallet.reservedCents).toBe(400); // unchanged — no double hold
    }
  });

  it("settles at provider cost × 1.50 and releases the remainder", () => {
    const held = reserve(wallet, [], {
      id: "r1",
      idempotencyKey: "k1",
      amountCents: 600,
      rateVersion: rate.rateVersion,
    });
    if (!held.ok) throw new Error("reserve failed");
    const settled = settle(held.wallet, held.reservation, 200);
    expect(settled.ok).toBe(true);
    if (settled.ok) {
      expect(settled.customerChargeCents).toBe(300);
      expect(settled.wallet.balanceCents).toBe(700); // 1000 - 300
      expect(settled.wallet.reservedCents).toBe(0); // full hold released
      expect(settled.reservation.status).toBe("settled");
      expect(settled.reservation.settledProviderCostCents).toBe(200);
    }
  });

  it("cannot settle the same reservation twice", () => {
    const held = reserve(wallet, [], {
      id: "r1",
      idempotencyKey: "k1",
      amountCents: 600,
      rateVersion: rate.rateVersion,
    });
    if (!held.ok) throw new Error("reserve failed");
    const settled = settle(held.wallet, held.reservation, 200);
    if (!settled.ok) throw new Error("settle failed");
    const again = settle(settled.wallet, settled.reservation, 200);
    expect(again).toEqual({ ok: false, error: "not_held" });
  });

  it("cannot charge more than the reserved budget cap", () => {
    const held = reserve(wallet, [], {
      id: "r1",
      idempotencyKey: "k1",
      amountCents: 100,
      rateVersion: rate.rateVersion,
    });
    if (!held.ok) throw new Error("reserve failed");
    const settled = settle(held.wallet, held.reservation, 500); // charge would be 750
    expect(settled).toEqual({ ok: false, error: "charge_exceeds_reservation" });
  });

  it("releases a failed run without charging and blocks double release", () => {
    const held = reserve(wallet, [], {
      id: "r1",
      idempotencyKey: "k1",
      amountCents: 500,
      rateVersion: rate.rateVersion,
    });
    if (!held.ok) throw new Error("reserve failed");
    const released = release(held.wallet, held.reservation);
    expect(released.ok).toBe(true);
    if (released.ok) {
      expect(released.wallet.balanceCents).toBe(1_000); // nothing charged
      expect(released.wallet.reservedCents).toBe(0);
      expect(release(released.wallet, released.reservation)).toEqual({
        ok: false,
        error: "not_held",
      });
      expect(settle(released.wallet, released.reservation, 10)).toEqual({
        ok: false,
        error: "not_held",
      });
    }
  });
});
