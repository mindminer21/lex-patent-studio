import { beforeEach, describe, expect, it } from "vitest";
import { lastTopUpAmountCents } from "@/lib/wepatent/domain/billing";
import { getAdapters } from "@/lib/server/adapters";
import { LocalDataAdapter } from "@/lib/server/adapters/local/store";
import {
  ALLOWED_TOP_UP_CENTS,
  computeStripeSignature,
  DEFAULT_TOP_UP_CENTS,
  StripeApiError,
  StripeBillingAdapter,
} from "@/lib/server/adapters/production/stripe-billing";
import {
  getTopUpDefaults,
  processStripeWebhook,
  topUpWithSavedPaymentMethod,
} from "@/lib/server/services/billing";
import { createOrganizationForUser } from "@/lib/server/services/orgs";

/**
 * Friction audit #7: last-amount memory + one-click top-up on a saved
 * payment method. Everything here runs against a FAKE Stripe transport (an
 * injected fetch) or local mode — no account, no credentials, no spend.
 */

const SECRET = "whsec_wepatent_local_synthetic_not_for_production";
const STRIPE_KEY = "sk_test_synthetic_never_real";

type Call = { url: string; init: RequestInit };

function fetchStub(handler: (call: Call) => Response | Promise<Response>): {
  impl: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  return { impl, calls };
}

function adapter(
  impl: typeof fetch,
  getCustomerId: () => Promise<string | null> = async () => "cus_123",
) {
  return new StripeBillingAdapter({
    secretKey: STRIPE_KEY,
    appUrl: "https://wepatent.example",
    getCustomerId,
    fetchImpl: impl,
  });
}

/** Stripe responses for the customer → default payment-method lookup. */
function savedCardRoutes(call: Call): Response | null {
  if (call.url === "https://api.stripe.com/v1/customers/cus_123") {
    return Response.json({
      id: "cus_123",
      invoice_settings: { default_payment_method: "pm_saved_1" },
    });
  }
  if (call.url === "https://api.stripe.com/v1/payment_methods/pm_saved_1") {
    return Response.json({ id: "pm_saved_1", card: { brand: "visa", last4: "4242" } });
  }
  return null;
}

describe("last top-up amount memory", () => {
  const allowed = ALLOWED_TOP_UP_CENTS as readonly number[];

  it("falls back to the standing default before any top-up", () => {
    expect(lastTopUpAmountCents([], allowed, DEFAULT_TOP_UP_CENTS)).toBe(DEFAULT_TOP_UP_CENTS);
  });

  it("remembers the most recent settled top-up", () => {
    const entries = [
      { kind: "top_up", amountCents: 1_000, createdAt: "2026-08-01T00:00:00Z" },
      { kind: "top_up", amountCents: 5_000, createdAt: "2026-08-03T00:00:00Z" },
      { kind: "top_up", amountCents: 2_500, createdAt: "2026-08-02T00:00:00Z" },
    ];
    expect(lastTopUpAmountCents(entries, allowed, DEFAULT_TOP_UP_CENTS)).toBe(5_000);
  });

  it("ignores promo credits and usage settlements", () => {
    const entries = [
      { kind: "top_up", amountCents: 10_000, createdAt: "2026-08-01T00:00:00Z" },
      { kind: "promo_credit", amountCents: 2_500, createdAt: "2026-08-04T00:00:00Z" },
      { kind: "usage_settlement", amountCents: -12, createdAt: "2026-08-05T00:00:00Z" },
    ];
    expect(lastTopUpAmountCents(entries, allowed, DEFAULT_TOP_UP_CENTS)).toBe(10_000);
  });

  it("ignores amounts that are no longer offered", () => {
    const entries = [{ kind: "top_up", amountCents: 7_777, createdAt: "2026-08-01T00:00:00Z" }];
    expect(lastTopUpAmountCents(entries, allowed, DEFAULT_TOP_UP_CENTS)).toBe(
      DEFAULT_TOP_UP_CENTS,
    );
  });
});

describe("Checkout saves the payment method for future off-session use", () => {
  it("sets setup_future_usage and creates a customer when there is none", async () => {
    const { impl, calls } = fetchStub(() => Response.json({ url: "https://checkout/x" }));
    await adapter(impl, async () => null).createCheckoutSession("org-1", {
      kind: "wallet_top_up",
      amountCents: 2_500,
    });
    const body = new URLSearchParams(String(calls[0].init.body));
    expect(body.get("payment_intent_data[setup_future_usage]")).toBe("off_session");
    expect(body.get("customer_creation")).toBe("always");
    // The PaymentIntent carries the metadata the webhook keys the credit on.
    expect(body.get("payment_intent_data[metadata][organization_id]")).toBe("org-1");
    expect(body.get("payment_intent_data[metadata][purpose]")).toBe("wallet_top_up");
  });

  it("reuses an existing customer instead of creating a second one", async () => {
    const { impl, calls } = fetchStub(() => Response.json({ url: "https://checkout/x" }));
    await adapter(impl).createCheckoutSession("org-1", {
      kind: "wallet_top_up",
      amountCents: 2_500,
    });
    const body = new URLSearchParams(String(calls[0].init.body));
    expect(body.get("customer")).toBe("cus_123");
    expect(body.get("customer_creation")).toBeNull();
  });

  it("does not attach a saved-card intent to subscription checkouts", async () => {
    const { impl, calls } = fetchStub(() => Response.json({ url: "https://checkout/x" }));
    const withPrice = new StripeBillingAdapter({
      secretKey: STRIPE_KEY,
      appUrl: "https://wepatent.example",
      getCustomerId: async () => "cus_123",
      subscriptionPriceIds: { solo: "price_solo" },
      fetchImpl: impl,
    });
    await withPrice.createCheckoutSession("org-1", { kind: "subscription", planId: "solo" });
    const body = new URLSearchParams(String(calls[0].init.body));
    expect(body.get("payment_intent_data[setup_future_usage]")).toBeNull();
  });
});

describe("saved payment method lookup (fake Stripe transport)", () => {
  it("prefers the customer's default payment method", async () => {
    const { impl } = fetchStub((call) => savedCardRoutes(call) ?? Response.json({}));
    expect(await adapter(impl).getDefaultPaymentMethod("org-1")).toEqual({
      id: "pm_saved_1",
      brand: "visa",
      last4: "4242",
    });
  });

  it("falls back to the most recently attached card", async () => {
    const { impl } = fetchStub((call) => {
      if (call.url === "https://api.stripe.com/v1/customers/cus_123") {
        return Response.json({ id: "cus_123", invoice_settings: {} });
      }
      return Response.json({ data: [{ id: "pm_listed", card: { brand: "amex", last4: "0005" } }] });
    });
    expect(await adapter(impl).getDefaultPaymentMethod("org-1")).toEqual({
      id: "pm_listed",
      brand: "amex",
      last4: "0005",
    });
  });

  it("returns null when the org has no Stripe customer or no card on file", async () => {
    const { impl, calls } = fetchStub(() => Response.json({}));
    expect(await adapter(impl, async () => null).getDefaultPaymentMethod("org-1")).toBeNull();
    expect(calls).toHaveLength(0);

    const { impl: empty } = fetchStub((call) => {
      if (call.url === "https://api.stripe.com/v1/customers/cus_123") {
        return Response.json({ id: "cus_123", invoice_settings: {} });
      }
      return Response.json({ data: [] });
    });
    expect(await adapter(empty).getDefaultPaymentMethod("org-1")).toBeNull();
  });
});

describe("off-session PaymentIntent (fake Stripe transport)", () => {
  it("creates + confirms off-session with an idempotency key and returns success", async () => {
    const { impl, calls } = fetchStub((call) => {
      const saved = savedCardRoutes(call);
      if (saved) return saved;
      return Response.json({ id: "pi_ok_1", status: "succeeded" });
    });
    const result = await adapter(impl).createOffSessionTopUp("org-1", {
      amountCents: 2_500,
      idempotencyKey: "wallet_top_up:org-1:abc",
    });
    expect(result).toEqual({ status: "succeeded", paymentIntentId: "pi_ok_1" });

    const intentCall = calls.find(
      (call) => call.url === "https://api.stripe.com/v1/payment_intents",
    )!;
    const headers = intentCall.init.headers as Record<string, string>;
    expect(headers["idempotency-key"]).toBe("wallet_top_up:org-1:abc");
    const body = new URLSearchParams(String(intentCall.init.body));
    expect(body.get("amount")).toBe("2500");
    expect(body.get("currency")).toBe("usd");
    expect(body.get("customer")).toBe("cus_123");
    expect(body.get("payment_method")).toBe("pm_saved_1");
    expect(body.get("off_session")).toBe("true");
    expect(body.get("confirm")).toBe("true");
    expect(body.get("metadata[organization_id]")).toBe("org-1");
    expect(body.get("metadata[purpose]")).toBe("wallet_top_up");
  });

  it("reports SCA (authentication_required, HTTP 402) honestly — never success", async () => {
    const { impl } = fetchStub((call) => {
      const saved = savedCardRoutes(call);
      if (saved) return saved;
      return new Response(
        JSON.stringify({
          error: {
            code: "authentication_required",
            message: "card details and PII",
            payment_intent: { id: "pi_sca_1", status: "requires_action" },
          },
        }),
        { status: 402 },
      );
    });
    expect(
      await adapter(impl).createOffSessionTopUp("org-1", {
        amountCents: 2_500,
        idempotencyKey: "k",
      }),
    ).toEqual({ status: "requires_action", paymentIntentId: "pi_sca_1" });
  });

  it("treats a non-succeeded intent status as requiring action", async () => {
    const { impl } = fetchStub((call) => {
      const saved = savedCardRoutes(call);
      if (saved) return saved;
      return Response.json({ id: "pi_ra", status: "requires_action" });
    });
    expect(
      await adapter(impl).createOffSessionTopUp("org-1", {
        amountCents: 1_000,
        idempotencyKey: "k",
      }),
    ).toEqual({ status: "requires_action", paymentIntentId: "pi_ra" });
  });

  it("reports declines as failures without leaking the raw Stripe body", async () => {
    const { impl } = fetchStub((call) => {
      const saved = savedCardRoutes(call);
      if (saved) return saved;
      return new Response(
        JSON.stringify({ error: { code: "card_declined", message: "card secrets and PII" } }),
        { status: 402 },
      );
    });
    const result = await adapter(impl).createOffSessionTopUp("org-1", {
      amountCents: 1_000,
      idempotencyKey: "k",
    });
    expect(result).toEqual({ status: "failed", reason: "card_declined" });
    expect(JSON.stringify(result)).not.toContain("card secrets");
  });

  it("refuses amounts outside the allowlist before any network call", async () => {
    const { impl, calls } = fetchStub(() => Response.json({}));
    await expect(
      adapter(impl).createOffSessionTopUp("org-1", { amountCents: 123, idempotencyKey: "k" }),
    ).rejects.toBeInstanceOf(StripeApiError);
    expect(calls).toHaveLength(0);
  });

  it("fails closed when no card is on file", async () => {
    const { impl } = fetchStub(() => Response.json({}));
    expect(
      await adapter(impl, async () => null).createOffSessionTopUp("org-1", {
        amountCents: 1_000,
        idempotencyKey: "k",
      }),
    ).toEqual({ status: "failed", reason: "no_saved_payment_method" });
  });
});

describe("payment_intent.succeeded credits the wallet through the webhook pipeline", () => {
  let organizationId = "";
  let ownerId = "";

  beforeEach(async () => {
    LocalDataAdapter.reset();
    const { data } = getAdapters();
    const user = await data.createUser({ email: "owner@oneclick.test", displayName: "Owner" });
    ownerId = user.id;
    organizationId = (await createOrganizationForUser(user.id, "One Click Org")).id;
  });

  function intentEvent(eventId: string, amountCents: number): string {
    return JSON.stringify({
      id: eventId,
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: `pi_${eventId}`,
          customer: "cus_oneclick",
          amount: amountCents,
          amount_received: amountCents,
          metadata: { organization_id: organizationId, purpose: "wallet_top_up" },
        },
      },
    });
  }

  function signed(payload: string) {
    return {
      payload,
      signatureHeader: computeStripeSignature(payload, SECRET, Math.floor(Date.now() / 1000)),
    };
  }

  it("credits once, records the source, and is idempotent on redelivery", async () => {
    const { data } = getAdapters();
    const before = (await data.getWallet(organizationId))!.balanceCents;
    const payload = intentEvent("evt_pi_1", 5_000);

    expect(await processStripeWebhook(signed(payload))).toEqual({ ok: true, status: "processed" });
    expect(await processStripeWebhook(signed(payload))).toEqual({ ok: true, status: "duplicate" });

    expect((await data.getWallet(organizationId))!.balanceCents).toBe(before + 5_000);
    const topUps = (await data.listLedgerEntries(organizationId)).filter(
      (entry) => entry.kind === "top_up",
    );
    expect(topUps).toHaveLength(1);
    expect(topUps[0].stripeReference).toBe("evt_pi_1");
    expect(topUps[0].note).toContain("saved payment method");
    expect(await data.getStripeCustomerId(organizationId)).toBe("cus_oneclick");
  });

  it("ignores a forged signature without touching the wallet", async () => {
    const { data } = getAdapters();
    const before = (await data.getWallet(organizationId))!.balanceCents;
    const payload = intentEvent("evt_pi_forged", 10_000);
    expect(
      await processStripeWebhook({
        payload,
        signatureHeader: computeStripeSignature(payload, "whsec_attacker", 1),
      }),
    ).toEqual({ ok: false, error: "invalid_signature" });
    expect((await data.getWallet(organizationId))!.balanceCents).toBe(before);
  });

  it("ignores payment intents that are not wallet top-ups", async () => {
    const payload = JSON.stringify({
      id: "evt_pi_other",
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_x", amount_received: 9_999, metadata: { purpose: "other" } } },
    });
    expect(await processStripeWebhook(signed(payload))).toEqual({ ok: true, status: "ignored" });
  });

  it("one-click top-up is role-gated, amount-gated, credited by the webhook, and audited", async () => {
    const { data } = getAdapters();

    // No saved payment method until a checkout has produced a customer.
    expect(await getTopUpDefaults(organizationId)).toMatchObject({
      defaultAmountCents: DEFAULT_TOP_UP_CENTS,
      savedPaymentMethod: null,
    });
    expect(
      await topUpWithSavedPaymentMethod({
        organizationId,
        userId: ownerId,
        actorRole: "owner",
        amountCents: 2_500,
      }),
    ).toEqual({ ok: false, error: "no_saved_payment_method" });

    // First top-up through checkout sets the customer (and, in production,
    // saves the card via setup_future_usage).
    await processStripeWebhook(signed(intentEvent("evt_first", 5_000)));

    const defaults = await getTopUpDefaults(organizationId);
    expect(defaults.defaultAmountCents).toBe(5_000); // remembers the last amount
    expect(defaults.savedPaymentMethod).not.toBeNull();

    // Non-billing roles cannot charge.
    expect(
      await topUpWithSavedPaymentMethod({
        organizationId,
        userId: ownerId,
        actorRole: "member",
        amountCents: 5_000,
      }),
    ).toEqual({ ok: false, error: "forbidden" });
    // Amounts outside the allowlist never reach the adapter.
    expect(
      await topUpWithSavedPaymentMethod({
        organizationId,
        userId: ownerId,
        actorRole: "owner",
        amountCents: 123_456,
      }),
    ).toEqual({ ok: false, error: "invalid_amount" });

    const before = (await data.getWallet(organizationId))!.balanceCents;
    const result = await topUpWithSavedPaymentMethod({
      organizationId,
      userId: ownerId,
      actorRole: "owner",
      amountCents: 5_000,
    });
    expect(result.ok).toBe(true);

    // Credited exactly once, through the ledger, with an immutable entry.
    expect((await data.getWallet(organizationId))!.balanceCents).toBe(before + 5_000);
    const topUps = (await data.listLedgerEntries(organizationId)).filter(
      (entry) => entry.kind === "top_up",
    );
    expect(topUps).toHaveLength(2);
    expect(new Set(topUps.map((entry) => entry.stripeReference)).size).toBe(2);

    const audits = await data.listAuditEvents(organizationId);
    // Every attempt is audited, including the earlier no-card failure.
    const attempts = audits.filter((a) => a.action === "billing.off_session_top_up_attempted");
    expect(attempts.length).toBeGreaterThanOrEqual(2);
    expect(attempts[0].meta).toMatchObject({ amountCents: 2_500, status: "failed" });
    expect(attempts[attempts.length - 1].meta).toMatchObject({
      amountCents: 5_000,
      status: "succeeded",
    });
    expect(audits.some((a) => a.action === "billing.wallet_top_up_credited")).toBe(true);
  });
});
