import { beforeEach, describe, expect, it } from "vitest";
import {
  ALLOWED_TOP_UP_CENTS,
  computeStripeSignature,
  StripeApiError,
  StripeBillingAdapter,
  verifyStripeSignature,
} from "@/lib/server/adapters/production/stripe-billing";
import { getAdapters } from "@/lib/server/adapters";
import { LocalDataAdapter } from "@/lib/server/adapters/local/store";
import { createOrganizationForUser } from "@/lib/server/services/orgs";
import {
  drainBillingOutbox,
  processStripeWebhook,
  startCheckoutSession,
  startPortalSession,
} from "@/lib/server/services/billing";

/**
 * FR-6 tests: Stripe adapter (injected fetch — no account/credentials),
 * webhook signature verification, and the verified→dedupe→outbox→ledger
 * pipeline. PRD §13 integration list: "Stripe webhook signature/idempotency
 * behavior".
 */

const SECRET = "whsec_wepatent_local_synthetic_not_for_production";
const STRIPE_KEY = "sk_test_synthetic_never_real";

type Call = { url: string; init: RequestInit };

function fetchStub(
  handler: (call: Call) => Response | Promise<Response>,
): { impl: typeof fetch; calls: Call[] } {
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

describe("Stripe webhook signature verification (FR-6)", () => {
  const payload = JSON.stringify({ id: "evt_1", type: "x", data: { object: {} } });

  it("accepts a valid v1 signature within tolerance", () => {
    const header = computeStripeSignature(payload, SECRET, 1_000_000);
    const result = verifyStripeSignature({
      payload,
      header,
      secret: SECRET,
      nowSeconds: 1_000_100,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a signature produced with the wrong secret", () => {
    const header = computeStripeSignature(payload, "whsec_other", 1_000_000);
    expect(
      verifyStripeSignature({ payload, header, secret: SECRET, nowSeconds: 1_000_100 }),
    ).toEqual({ ok: false, error: "bad_signature" });
  });

  it("rejects a tampered payload", () => {
    const header = computeStripeSignature(payload, SECRET, 1_000_000);
    expect(
      verifyStripeSignature({
        payload: payload.replace("evt_1", "evt_2"),
        header,
        secret: SECRET,
        nowSeconds: 1_000_100,
      }),
    ).toEqual({ ok: false, error: "bad_signature" });
  });

  it("rejects stale timestamps (replay window)", () => {
    const header = computeStripeSignature(payload, SECRET, 1_000_000);
    expect(
      verifyStripeSignature({ payload, header, secret: SECRET, nowSeconds: 1_000_000 + 3600 }),
    ).toEqual({ ok: false, error: "stale_timestamp" });
  });

  it("rejects missing and malformed headers", () => {
    expect(verifyStripeSignature({ payload, header: null, secret: SECRET })).toEqual({
      ok: false,
      error: "missing_header",
    });
    expect(verifyStripeSignature({ payload, header: "nonsense", secret: SECRET })).toEqual({
      ok: false,
      error: "malformed_header",
    });
  });
});

describe("StripeBillingAdapter (FR-6, injected fetch)", () => {
  it("creates a top-up Checkout session with form-encoded price data and metadata", async () => {
    const { impl, calls } = fetchStub(() =>
      Response.json({ url: "https://checkout.stripe.com/c/session_abc" }),
    );
    const result = await adapter(impl, async () => null).createCheckoutSession("org-1", {
      kind: "wallet_top_up",
      amountCents: 2_500,
    });
    expect(result.url).toBe("https://checkout.stripe.com/c/session_abc");
    expect(calls[0].url).toBe("https://api.stripe.com/v1/checkout/sessions");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${STRIPE_KEY}`);
    expect(headers["content-type"]).toBe("application/x-www-form-urlencoded");
    const body = new URLSearchParams(String(calls[0].init.body));
    expect(body.get("mode")).toBe("payment");
    expect(body.get("metadata[organization_id]")).toBe("org-1");
    expect(body.get("metadata[purpose]")).toBe("wallet_top_up");
    expect(body.get("line_items[0][price_data][unit_amount]")).toBe("2500");
    expect(body.get("success_url")).toBe("https://wepatent.example/app/billing?checkout=success");
  });

  it("rejects top-up amounts outside the allowlist", async () => {
    const { impl, calls } = fetchStub(() => Response.json({ url: "x" }));
    await expect(
      adapter(impl).createCheckoutSession("org-1", { kind: "wallet_top_up", amountCents: 123 }),
    ).rejects.toBeInstanceOf(StripeApiError);
    expect(calls).toHaveLength(0);
  });

  it("fails closed for subscription plans without a configured Stripe price (approval-gated)", async () => {
    const { impl, calls } = fetchStub(() => Response.json({ url: "x" }));
    await expect(
      adapter(impl).createCheckoutSession("org-1", { kind: "subscription", planId: "solo" }),
    ).rejects.toBeInstanceOf(StripeApiError);
    expect(calls).toHaveLength(0);
  });

  it("creates a portal session for an org with a Stripe customer", async () => {
    const { impl, calls } = fetchStub(() =>
      Response.json({ url: "https://billing.stripe.com/p/session_xyz" }),
    );
    const result = await adapter(impl).createPortalSession("org-1");
    expect(result.url).toBe("https://billing.stripe.com/p/session_xyz");
    expect(calls[0].url).toBe("https://api.stripe.com/v1/billing_portal/sessions");
    const body = new URLSearchParams(String(calls[0].init.body));
    expect(body.get("customer")).toBe("cus_123");
    expect(body.get("return_url")).toBe("https://wepatent.example/app/billing");
  });

  it("refuses a portal session when no Stripe customer exists yet", async () => {
    const { impl, calls } = fetchStub(() => Response.json({ url: "x" }));
    await expect(adapter(impl, async () => null).createPortalSession("org-1")).rejects.toBeInstanceOf(
      StripeApiError,
    );
    expect(calls).toHaveLength(0);
  });

  it("keeps raw Stripe error bodies out of the thrown message", async () => {
    const { impl } = fetchStub(
      () => new Response('{"error":{"message":"card secrets and PII"}}', { status: 402 }),
    );
    const error: unknown = await adapter(impl)
      .createCheckoutSession("org-1", { kind: "wallet_top_up", amountCents: 1_000 })
      .then(() => null)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StripeApiError);
    const apiError = error as StripeApiError;
    expect(apiError.message).toBe("stripe_api_error");
    expect(apiError.message).not.toContain("card secrets");
    expect(apiError.internalDetail).toContain("HTTP 402");
  });
});

describe("webhook pipeline: verify → dedupe → outbox → ledger (FR-6)", () => {
  let organizationId = "";

  beforeEach(async () => {
    LocalDataAdapter.reset();
    const { data } = getAdapters();
    const user = await data.createUser({ email: "owner@example.com", displayName: "Owner" });
    const organization = await createOrganizationForUser(user.id, "Billing Test Org");
    organizationId = organization.id;
  });

  function topUpEvent(eventId: string, amountCents: number) {
    return JSON.stringify({
      id: eventId,
      type: "checkout.session.completed",
      data: {
        object: {
          id: `cs_${eventId}`,
          customer: "cus_synthetic_1",
          amount_total: amountCents,
          client_reference_id: organizationId,
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

  it("credits the wallet exactly once for a verified top-up event", async () => {
    const { data } = getAdapters();
    const before = (await data.getWallet(organizationId))!.balanceCents;

    const outcome = await processStripeWebhook(signed(topUpEvent("evt_test_1", 2_500)));
    expect(outcome).toEqual({ ok: true, status: "processed" });

    const wallet = (await data.getWallet(organizationId))!;
    expect(wallet.balanceCents).toBe(before + 2_500);
    const ledger = await data.listLedgerEntries(organizationId);
    const topUps = ledger.filter((entry) => entry.kind === "top_up");
    expect(topUps).toHaveLength(1);
    expect(topUps[0].stripeReference).toBe("evt_test_1");
    expect(await data.getStripeCustomerId(organizationId)).toBe("cus_synthetic_1");
  });

  it("is idempotent across webhook redelivery: same event id credits once", async () => {
    const { data } = getAdapters();
    const payload = topUpEvent("evt_redelivered", 5_000);
    const first = await processStripeWebhook(signed(payload));
    const second = await processStripeWebhook(signed(payload));
    expect(first).toEqual({ ok: true, status: "processed" });
    expect(second).toEqual({ ok: true, status: "duplicate" });
    const topUps = (await data.listLedgerEntries(organizationId)).filter(
      (entry) => entry.kind === "top_up",
    );
    expect(topUps).toHaveLength(1);
  });

  it("rejects an unsigned or badly signed payload without touching state", async () => {
    const { data } = getAdapters();
    const before = (await data.getWallet(organizationId))!.balanceCents;
    const payload = topUpEvent("evt_forged", 9_999_999);
    expect(await processStripeWebhook({ payload, signatureHeader: null })).toEqual({
      ok: false,
      error: "invalid_signature",
    });
    expect(
      await processStripeWebhook({
        payload,
        signatureHeader: computeStripeSignature(payload, "whsec_attacker", 1),
      }),
    ).toEqual({ ok: false, error: "invalid_signature" });
    expect((await data.getWallet(organizationId))!.balanceCents).toBe(before);
  });

  it("records and ignores unrelated event types", async () => {
    const payload = JSON.stringify({
      id: "evt_unrelated",
      type: "invoice.finalized",
      data: { object: { id: "in_1" } },
    });
    expect(await processStripeWebhook(signed(payload))).toEqual({ ok: true, status: "ignored" });
  });

  it("re-running the outbox never double-credits (crash-retry safety)", async () => {
    const { data } = getAdapters();
    await processStripeWebhook(signed(topUpEvent("evt_crash_retry", 1_000)));
    const result = await drainBillingOutbox();
    expect(result).toEqual({ processed: 0, failed: 0 });
    const topUps = (await data.listLedgerEntries(organizationId)).filter(
      (entry) => entry.kind === "top_up",
    );
    expect(topUps).toHaveLength(1);
  });

  it("checkout/portal session starters return usable local-mode URLs and audit the action", async () => {
    const { data } = getAdapters();
    const membership = (await data.getMembershipsForOrganization(organizationId))[0];
    const checkout = await startCheckoutSession({
      organizationId,
      userId: membership.userId,
      request: { kind: "wallet_top_up", amountCents: ALLOWED_TOP_UP_CENTS[1] },
    });
    expect(checkout.ok).toBe(true);
    if (checkout.ok) expect(checkout.url).toContain("/app/billing/simulated-checkout");
    const portal = await startPortalSession({ organizationId, userId: membership.userId });
    expect(portal.ok).toBe(true);
    if (portal.ok) expect(portal.url).toContain("/app/billing/simulated-portal");
    const audits = await data.listAuditEvents(organizationId);
    expect(audits.some((a) => a.action === "billing.checkout_session_created")).toBe(true);
    expect(audits.some((a) => a.action === "billing.portal_session_created")).toBe(true);
  });
});
