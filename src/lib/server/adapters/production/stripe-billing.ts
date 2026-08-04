import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  BillingPort,
  CheckoutRequest,
  Id,
  OffSessionTopUpResult,
  SavedPaymentMethod,
} from "../types";

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

/** Preselected amount before the organization has topped up before. */
export const DEFAULT_TOP_UP_CENTS = 2_500;

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
    params.set("success_url", `${this.options.appUrl}/wepatent/app/billing?checkout=success`);
    params.set("cancel_url", `${this.options.appUrl}/wepatent/app/billing?checkout=cancelled`);
    params.set("client_reference_id", organizationId);
    params.set("metadata[organization_id]", organizationId);

    if (request.kind === "wallet_top_up") {
      if (!ALLOWED_TOP_UP_CENTS.includes(request.amountCents as 1000)) {
        throw new StripeApiError(`top-up amount ${request.amountCents} not allowed`);
      }
      params.set("mode", "payment");
      params.set("metadata[purpose]", "wallet_top_up");
      // Friction audit #7: save the card for future off-session use so the
      // SECOND top-up onward is one click. `customer_creation=always`
      // guarantees there is a customer to attach it to when the org has no
      // Stripe customer yet; the pair is what Stripe requires for
      // `setup_future_usage` in payment mode.
      params.set("payment_intent_data[setup_future_usage]", "off_session");
      params.set("payment_intent_data[metadata][organization_id]", organizationId);
      params.set("payment_intent_data[metadata][purpose]", "wallet_top_up");
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
    if (existingCustomer) {
      params.set("customer", existingCustomer);
    } else if (request.kind === "wallet_top_up") {
      // No customer yet: Stripe must create one, otherwise there is nothing
      // to attach the saved payment method to.
      params.set("customer_creation", "always");
    }

    const session = await this.post("/v1/checkout/sessions", params);
    return { url: this.requireUrl(session) };
  }

  /**
   * The customer's default card. Prefers the customer's
   * `invoice_settings.default_payment_method`; falls back to the most
   * recently attached card. Returns null when nothing is on file, which is
   * how the UI decides not to offer one-click top-up.
   */
  async getDefaultPaymentMethod(organizationId: Id): Promise<SavedPaymentMethod | null> {
    const customer = await this.options.getCustomerId(organizationId);
    if (!customer) return null;

    const customerRecord = (await this.get(`/v1/customers/${encodeURIComponent(customer)}`)) as {
      invoice_settings?: { default_payment_method?: unknown };
      deleted?: boolean;
    } | null;
    if (!customerRecord || customerRecord.deleted) return null;

    const defaultId = customerRecord.invoice_settings?.default_payment_method;
    if (typeof defaultId === "string" && defaultId.length > 0) {
      const method = (await this.get(
        `/v1/payment_methods/${encodeURIComponent(defaultId)}`,
      )) as Record<string, unknown> | null;
      const mapped = mapPaymentMethod(method);
      if (mapped) return mapped;
    }

    const list = (await this.get(
      `/v1/payment_methods?customer=${encodeURIComponent(customer)}&type=card&limit=1`,
    )) as { data?: unknown[] } | null;
    const first = Array.isArray(list?.data) ? list.data[0] : null;
    return mapPaymentMethod(first);
  }

  /**
   * One-click top-up (friction audit #7): create and confirm an off-session
   * PaymentIntent against the saved card.
   *
   * The wallet is NOT credited here — `payment_intent.succeeded` arrives on
   * the webhook and runs through the same verify → dedupe → outbox → ledger
   * path Checkout uses, so there is exactly one crediting code path.
   * Stripe's `Idempotency-Key` header makes a retried request safe.
   *
   * SCA: Stripe answers an off-session charge that needs authentication
   * with HTTP 402 and `error.code = "authentication_required"`. That is
   * reported honestly as `requires_action` — never as success.
   */
  async createOffSessionTopUp(
    organizationId: Id,
    input: { amountCents: number; idempotencyKey: string },
  ): Promise<OffSessionTopUpResult> {
    if (!ALLOWED_TOP_UP_CENTS.includes(input.amountCents as 1000)) {
      throw new StripeApiError(`top-up amount ${input.amountCents} not allowed`);
    }
    const customer = await this.options.getCustomerId(organizationId);
    if (!customer) return { status: "failed", reason: "no_saved_payment_method" };
    const method = await this.getDefaultPaymentMethod(organizationId);
    if (!method) return { status: "failed", reason: "no_saved_payment_method" };

    const params = new URLSearchParams();
    params.set("amount", String(input.amountCents));
    params.set("currency", "usd");
    params.set("customer", customer);
    params.set("payment_method", method.id);
    params.set("off_session", "true");
    params.set("confirm", "true");
    params.set("description", "wepatent AI usage wallet top-up");
    params.set("metadata[organization_id]", organizationId);
    params.set("metadata[purpose]", "wallet_top_up");

    const response = await this.postRaw("/v1/payment_intents", params, {
      "idempotency-key": input.idempotencyKey,
    });

    if (response.ok) {
      const intent = response.body as { id?: unknown; status?: unknown };
      const id = typeof intent.id === "string" ? intent.id : null;
      const status = typeof intent.status === "string" ? intent.status : "";
      if (status === "succeeded" || status === "processing") {
        if (!id) throw new StripeApiError("payment intent response missing id");
        return { status: "succeeded", paymentIntentId: id };
      }
      // requires_action / requires_confirmation / requires_payment_method:
      // the customer has to finish this interactively.
      return { status: "requires_action", paymentIntentId: id };
    }

    const error = (response.body as { error?: Record<string, unknown> } | null)?.error;
    const code = typeof error?.code === "string" ? error.code : "";
    const intentId =
      error && typeof error.payment_intent === "object" && error.payment_intent !== null
        ? ((error.payment_intent as { id?: unknown }).id as string | undefined) ?? null
        : null;
    if (code === "authentication_required") {
      return { status: "requires_action", paymentIntentId: intentId };
    }
    // Declines and everything else: honest failure, no wallet effect. The
    // raw Stripe body never leaves the server.
    return { status: "failed", reason: code || `http_${response.status}` };
  }

  async createPortalSession(organizationId: Id): Promise<{ url: string }> {
    const customer = await this.options.getCustomerId(organizationId);
    if (!customer) {
      // No completed checkout yet — there is no Stripe customer to manage.
      throw new StripeApiError(`organization ${organizationId} has no Stripe customer yet`);
    }
    const params = new URLSearchParams();
    params.set("customer", customer);
    params.set("return_url", `${this.options.appUrl}/wepatent/app/billing`);
    const session = await this.post("/v1/billing_portal/sessions", params);
    return { url: this.requireUrl(session) };
  }

  private async post(path: string, params: URLSearchParams): Promise<unknown> {
    const response = await this.postRaw(path, params);
    if (!response.ok) {
      throw new StripeApiError(`HTTP ${response.status}: ${response.text.slice(0, 500)}`);
    }
    return response.body;
  }

  /**
   * POST that returns the parsed body for non-2xx responses too. Off-session
   * PaymentIntents answer SCA-required with HTTP 402 plus a structured
   * error, which is a normal outcome to inspect rather than an exception.
   */
  private async postRaw(
    path: string,
    params: URLSearchParams,
    extraHeaders: Record<string, string> = {},
  ): Promise<{ ok: boolean; status: number; body: unknown; text: string }> {
    let response: Response;
    try {
      response = await this.options.fetchImpl(`https://api.stripe.com${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.options.secretKey}`,
          "content-type": "application/x-www-form-urlencoded",
          ...extraHeaders,
        },
        body: params.toString(),
      });
    } catch (error) {
      throw new StripeApiError(`network: ${String(error)}`);
    }
    const text = await response.text().catch(() => "");
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      if (response.ok) throw new StripeApiError("non-JSON response body");
      body = null;
    }
    return { ok: response.ok, status: response.status, body, text };
  }

  private async get(path: string): Promise<unknown> {
    let response: Response;
    try {
      response = await this.options.fetchImpl(`https://api.stripe.com${path}`, {
        method: "GET",
        headers: { authorization: `Bearer ${this.options.secretKey}` },
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

/** Maps a Stripe PaymentMethod object to the port's minimal shape. */
function mapPaymentMethod(method: unknown): SavedPaymentMethod | null {
  if (!method || typeof method !== "object") return null;
  const record = method as { id?: unknown; card?: { brand?: unknown; last4?: unknown } };
  if (typeof record.id !== "string" || record.id.length === 0) return null;
  return {
    id: record.id,
    brand: typeof record.card?.brand === "string" ? record.card.brand : null,
    last4: typeof record.card?.last4 === "string" ? record.card.last4 : null,
  };
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
