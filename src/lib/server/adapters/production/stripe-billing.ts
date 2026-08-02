import { createHmac, timingSafeEqual } from "node:crypto";
import type { BillingPort, CheckoutRequest, Id } from "../types";

/**
 * Production Stripe adapter (FR-6): Checkout sessions, Customer Portal
 * sessions, and webhook signature verification against the Stripe REST API.
 *
 * Implemented without the `stripe` SDK on purpose: the three calls used here
 * are stable form-encoded endpoints, an injected fetch keeps the adapter
 * fully unit-testable with zero credentials, and it avoids a new major
 * dependency (PRD: no architecture/dependency changes without need).
 *
 * Live activation is approval-gated (PRD §17.1/§17.4): Jeff must create the
 * Stripe account/products and set STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET.
 * Raw Stripe error bodies never leave the server (`internalDetail` only).
 */

export class StripeApiError extends Error {
  readonly internalDetail: string;

  constructor(internalDetail: string) {
    super("stripe_api_error");
    this.name = "StripeApiError";
    this.internalDetail = internalDetail;
  }
}

/** Top-up amounts offered in the UI (test-mode defaults; see PRD FR-6). */
export const ALLOWED_TOP_UP_CENTS = [1_000, 2_500, 5_000, 10_000] as const;

export type StripeBillingAdapterOptions = {
  secretKey: string;
  /** Absolute app origin used for success/cancel/return URLs. */
  appUrl: string;
  /** Resolve the org's Stripe customer id (set by webhook processing). */
  getCustomerId: (organizationId: Id) => Promise<string | null>;
  /**
   * Subscription plan → pre-created Stripe price id. Prices are created in
   * the Stripe dashboard (approval-gated); missing mappings fail closed.
   */
  subscriptionPriceIds?: Record<string, string>;
  fetchImpl?: typeof fetch;
};

export class StripeBillingAdapter implements BillingPort {
  private readonly options: Required<Omit<StripeBillingAdapterOptions, "subscriptionPriceIds">> & {
    subscriptionPriceIds: Record<string, string>;
  };

  constructor(options: StripeBillingAdapterOptions) {
    this.options = {
      secretKey: options.secretKey,
      appUrl: options.appUrl.replace(/\/$/, ""),
      getCustomerId: options.getCustomerId,
      subscriptionPriceIds: options.subscriptionPriceIds ?? {},
      fetchImpl: options.fetchImpl ?? fetch,
    };
  }

  async createCheckoutSession(
    organizationId: Id,
    request: CheckoutRequest,
  ): Promise<{ url: string }> {
    const params = new URLSearchParams();
    params.set("success_url", `${this.options.appUrl}/app/billing?checkout=success`);
    params.set("cancel_url", `${this.options.appUrl}/app/billing?checkout=cancelled`);
    params.set("client_reference_id", organizationId);
    params.set("metadata[organization_id]", organizationId);

    if (request.kind === "wallet_top_up") {
      if (!ALLOWED_TOP_UP_CENTS.includes(request.amountCents as 1000)) {
        throw new StripeApiError(`top-up amount ${request.amountCents} not allowed`);
      }
      params.set("mode", "payment");
      params.set("metadata[purpose]", "wallet_top_up");
      params.set("line_items[0][quantity]", "1");
      params.set("line_items[0][price_data][currency]", "usd");
      params.set("line_items[0][price_data][unit_amount]", String(request.amountCents));
      params.set(
        "line_items[0][price_data][product_data][name]",
        "wepatent AI usage wallet top-up",
      );
    } else {
      const priceId = this.options.subscriptionPriceIds[request.planId];
      if (!priceId) {
        throw new StripeApiError(
          `no Stripe price configured for plan "${request.planId}" (approval-gated, PRD §17)`,
        );
      }
      params.set("mode", "subscription");
      params.set("metadata[purpose]", "subscription");
      params.set("metadata[plan_id]", request.planId);
      params.set("line_items[0][quantity]", "1");
      params.set("line_items[0][price]", priceId);
    }

    const existingCustomer = await this.options.getCustomerId(organizationId);
    if (existingCustomer) params.set("customer", existingCustomer);

    const session = await this.post("/v1/checkout/sessions", params);
    return { url: this.requireUrl(session) };
  }

  async createPortalSession(organizationId: Id): Promise<{ url: string }> {
    const customer = await this.options.getCustomerId(organizationId);
    if (!customer) {
      // No completed checkout yet — there is no Stripe customer to manage.
      throw new StripeApiError(`organization ${organizationId} has no Stripe customer yet`);
    }
    const params = new URLSearchParams();
    params.set("customer", customer);
    params.set("return_url", `${this.options.appUrl}/app/billing`);
    const session = await this.post("/v1/billing_portal/sessions", params);
    return { url: this.requireUrl(session) };
  }

  private async post(path: string, params: URLSearchParams): Promise<unknown> {
    let response: Response;
    try {
      response = await this.options.fetchImpl(`https://api.stripe.com${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.options.secretKey}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      });
    } catch (error) {
      throw new StripeApiError(`network: ${String(error)}`);
    }
    const text = await response.text().catch(() => "");
    if (!response.ok) {
      throw new StripeApiError(`HTTP ${response.status}: ${text.slice(0, 500)}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new StripeApiError("non-JSON response body");
    }
  }

  private requireUrl(session: unknown): string {
    const url =
      session && typeof session === "object" && "url" in session
        ? (session as { url: unknown }).url
        : null;
    if (typeof url !== "string" || url.length === 0) {
      throw new StripeApiError("session response missing url");
    }
    return url;
  }
}

/* ------------------------------------------------------------------------ */
/* Webhook signature verification (FR-6)                                     */
/* ------------------------------------------------------------------------ */

export function computeStripeSignature(
  payload: string,
  secret: string,
  timestampSeconds: number,
): string {
  const mac = createHmac("sha256", secret)
    .update(`${timestampSeconds}.${payload}`)
    .digest("hex");
  return `t=${timestampSeconds},v1=${mac}`;
}

export type SignatureVerification =
  | { ok: true; timestampSeconds: number }
  | { ok: false; error: "missing_header" | "malformed_header" | "stale_timestamp" | "bad_signature" };

/**
 * Verify a `Stripe-Signature` header: HMAC-SHA256 over `${t}.${payload}`,
 * constant-time comparison, replay tolerance window.
 */
export function verifyStripeSignature(params: {
  payload: string;
  header: string | null;
  secret: string;
  toleranceSeconds?: number;
  nowSeconds?: number;
}): SignatureVerification {
  const { payload, header, secret } = params;
  const tolerance = params.toleranceSeconds ?? 300;
  const nowSeconds = params.nowSeconds ?? Math.floor(Date.now() / 1000);

  if (!header) return { ok: false, error: "missing_header" };
  const parts = new Map<string, string[]>();
  for (const piece of header.split(",")) {
    const eq = piece.indexOf("=");
    if (eq <= 0) continue;
    const key = piece.slice(0, eq).trim();
    const value = piece.slice(eq + 1).trim();
    parts.set(key, [...(parts.get(key) ?? []), value]);
  }
  const timestampRaw = parts.get("t")?.[0];
  const candidates = parts.get("v1") ?? [];
  const timestampSeconds = Number(timestampRaw);
  if (!timestampRaw || !Number.isFinite(timestampSeconds) || candidates.length === 0) {
    return { ok: false, error: "malformed_header" };
  }
  if (Math.abs(nowSeconds - timestampSeconds) > tolerance) {
    return { ok: false, error: "stale_timestamp" };
  }
  const expected = createHmac("sha256", secret)
    .update(`${timestampSeconds}.${payload}`)
    .digest();
  for (const candidate of candidates) {
    let candidateBytes: Buffer;
    try {
      candidateBytes = Buffer.from(candidate, "hex");
    } catch {
      continue;
    }
    if (candidateBytes.length === expected.length && timingSafeEqual(candidateBytes, expected)) {
      return { ok: true, timestampSeconds };
    }
  }
  return { ok: false, error: "bad_signature" };
}
