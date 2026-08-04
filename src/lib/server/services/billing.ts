import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { lastTopUpAmountCents } from "@/lib/wepatent/domain/billing";
import { can, type Role } from "@/lib/wepatent/domain/roles";
import { env, isLocalMode } from "@/lib/wepatent/env";
import { getAdapters } from "../adapters";
import {
  ALLOWED_TOP_UP_CENTS,
  computeStripeSignature,
  DEFAULT_TOP_UP_CENTS,
  verifyStripeSignature,
} from "../adapters/production/stripe-billing";
import type {
  BillingOutboxRecord,
  CheckoutRequest,
  OffSessionTopUpResult,
  SavedPaymentMethod,
} from "../adapters/types";
import { incrementCounter, logEvent, newCorrelationId } from "../observability";

/**
 * Stripe webhook processing (FR-6): verified signature → idempotent event
 * record → billing outbox → wallet-ledger effect.
 *
 * Idempotency layers:
 * 1. `insertStripeEvent` keys on the Stripe event id — a redelivered event
 *    is acknowledged without creating a second outbox entry.
 * 2. The wallet credit itself is guarded by `stripeReference` on the ledger:
 *    even if outbox processing is retried after a crash, the same reference
 *    can only ever credit once.
 *
 * This exact code path runs in local mode with a synthetic secret (the
 * simulated checkout signs real webhook payloads), so signature
 * verification, dedupe, outbox, and ledger effects are all exercised
 * end-to-end without any Stripe account (PRD §17 seam).
 */

/**
 * Shared checkout/portal session starters used by both the §10 API routes
 * and the billing page's server actions. Adapter failures (including the
 * approval-gated "not configured" state) map to a stable generic error.
 */
export async function startCheckoutSession(params: {
  organizationId: string;
  userId: string;
  request: CheckoutRequest;
}): Promise<{ ok: true; url: string } | { ok: false; error: "billing_unavailable" }> {
  const { billing, data } = getAdapters();
  try {
    const session = await billing.createCheckoutSession(params.organizationId, params.request);
    await data.appendAuditEvent({
      organizationId: params.organizationId,
      actor: `user:${params.userId}`,
      action: "billing.checkout_session_created",
      target: params.request.kind,
      meta:
        params.request.kind === "wallet_top_up"
          ? { amountCents: params.request.amountCents }
          : { planId: params.request.planId },
    });
    return { ok: true, url: session.url };
  } catch {
    return { ok: false, error: "billing_unavailable" };
  }
}

export async function startPortalSession(params: {
  organizationId: string;
  userId: string;
}): Promise<{ ok: true; url: string } | { ok: false; error: "billing_unavailable" }> {
  const { billing, data } = getAdapters();
  try {
    const session = await billing.createPortalSession(params.organizationId);
    await data.appendAuditEvent({
      organizationId: params.organizationId,
      actor: `user:${params.userId}`,
      action: "billing.portal_session_created",
      target: "stripe_portal",
      meta: {},
    });
    return { ok: true, url: session.url };
  } catch {
    return { ok: false, error: "billing_unavailable" };
  }
}

/**
 * The amount to preselect in the top-up control: the org's last settled
 * top-up (friction audit #7 — "remember the last top-up amount"), derived
 * from the immutable wallet ledger so there is no new preference state.
 */
export async function getTopUpDefaults(organizationId: string): Promise<{
  defaultAmountCents: number;
  savedPaymentMethod: SavedPaymentMethod | null;
}> {
  const { billing, data } = getAdapters();
  const ledger = await data.listLedgerEntries(organizationId);
  let savedPaymentMethod: SavedPaymentMethod | null = null;
  try {
    savedPaymentMethod = await billing.getDefaultPaymentMethod(organizationId);
  } catch {
    // A billing outage must never break the billing page; the user simply
    // gets the Checkout path.
    savedPaymentMethod = null;
  }
  return {
    defaultAmountCents: lastTopUpAmountCents(
      ledger,
      ALLOWED_TOP_UP_CENTS,
      DEFAULT_TOP_UP_CENTS,
    ),
    savedPaymentMethod,
  };
}

export type SavedCardTopUpResult =
  | { ok: true; paymentIntentId: string }
  | {
      ok: false;
      error: "forbidden" | "invalid_amount" | "no_saved_payment_method" | "authentication_required" | "declined";
    };

/**
 * One-click wallet top-up against a saved payment method (friction audit
 * #7). Spend consent is unchanged in substance — the user still presses a
 * button that names the exact amount; only the Checkout detour is removed.
 *
 * Money-path invariants preserved:
 * - a fresh idempotency key per attempt is handed to Stripe, so a retried
 *   request can never charge twice;
 * - the wallet is credited ONLY by `payment_intent.succeeded` running
 *   through the verified webhook → dedupe → outbox → immutable-ledger path,
 *   guarded by the Stripe reference — never by this function;
 * - SCA is surfaced honestly as `authentication_required` so the UI can
 *   send the user to Checkout; nothing is ever faked as success.
 */
export async function topUpWithSavedPaymentMethod(params: {
  organizationId: string;
  userId: string;
  actorRole: Role;
  amountCents: number;
}): Promise<SavedCardTopUpResult> {
  if (!can(params.actorRole, "billing.manage")) return { ok: false, error: "forbidden" };
  if (!(ALLOWED_TOP_UP_CENTS as readonly number[]).includes(params.amountCents)) {
    return { ok: false, error: "invalid_amount" };
  }

  const { billing, data } = getAdapters();
  const idempotencyKey = `wallet_top_up:${params.organizationId}:${randomUUID()}`;

  let result: OffSessionTopUpResult;
  try {
    result = await billing.createOffSessionTopUp(params.organizationId, {
      amountCents: params.amountCents,
      idempotencyKey,
    });
  } catch {
    return { ok: false, error: "declined" };
  }

  await data.appendAuditEvent({
    organizationId: params.organizationId,
    actor: `user:${params.userId}`,
    action: "billing.off_session_top_up_attempted",
    target: idempotencyKey,
    // Amounts and outcome only — never card data or payer identity (FR-7).
    meta: { amountCents: params.amountCents, status: result.status },
  });

  if (result.status === "requires_action") {
    return { ok: false, error: "authentication_required" };
  }
  if (result.status === "failed") {
    return {
      ok: false,
      error: result.reason === "no_saved_payment_method" ? "no_saved_payment_method" : "declined",
    };
  }

  // LOCAL MODE ONLY: no Stripe exists to deliver `payment_intent.succeeded`,
  // so the synthetic event is signed with the local webhook secret and put
  // through the SAME verification/dedupe/outbox/ledger pipeline production
  // uses — exactly like the simulated checkout. No real money anywhere.
  if (isLocalMode) {
    await deliverSimulatedPaymentIntentSucceeded({
      organizationId: params.organizationId,
      amountCents: params.amountCents,
      paymentIntentId: result.paymentIntentId,
    });
  }

  return { ok: true, paymentIntentId: result.paymentIntentId };
}

async function deliverSimulatedPaymentIntentSucceeded(params: {
  organizationId: string;
  amountCents: number;
  paymentIntentId: string;
}): Promise<void> {
  const { data } = getAdapters();
  const customerId =
    (await data.getStripeCustomerId(params.organizationId)) ??
    `cus_local_${params.organizationId.slice(0, 8)}`;
  const event = {
    id: `evt_local_${randomUUID()}`,
    type: "payment_intent.succeeded",
    data: {
      object: {
        id: params.paymentIntentId,
        customer: customerId,
        amount: params.amountCents,
        amount_received: params.amountCents,
        metadata: {
          organization_id: params.organizationId,
          purpose: "wallet_top_up",
        },
      },
    },
  };
  const payload = JSON.stringify(event);
  await processStripeWebhook({
    payload,
    signatureHeader: computeStripeSignature(
      payload,
      env.STRIPE_WEBHOOK_SECRET,
      Math.floor(Date.now() / 1000),
    ),
  });
}

const eventSchema = z.object({
  id: z.string().min(1).max(255),
  type: z.string().min(1).max(255),
  data: z.object({
    object: z
      .object({
        id: z.string().optional(),
        customer: z.string().nullish(),
        amount_total: z.number().int().nonnegative().nullish(),
        /** PaymentIntent amounts (one-click top-up). */
        amount_received: z.number().int().nonnegative().nullish(),
        amount: z.number().int().nonnegative().nullish(),
        client_reference_id: z.string().nullish(),
        metadata: z.record(z.string(), z.string()).nullish(),
      })
      .loose(),
  }),
});

/**
 * Event types that credit the wallet, and where each carries its amount.
 * Both land in the SAME outbox action and the same idempotency guard:
 * - `checkout.session.completed` — hosted Checkout (first top-up);
 * - `payment_intent.succeeded` — off-session one-click top-up (#7).
 */
const WALLET_CREDIT_EVENTS: Record<string, "amount_total" | "amount_received"> = {
  "checkout.session.completed": "amount_total",
  "payment_intent.succeeded": "amount_received",
};

export type WebhookOutcome =
  | { ok: true; status: "processed" | "duplicate" | "ignored" }
  | { ok: false; error: "not_configured" | "invalid_signature" | "invalid_payload" };

export const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;

export async function processStripeWebhook(params: {
  payload: string;
  signatureHeader: string | null;
  nowSeconds?: number;
}): Promise<WebhookOutcome> {
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return { ok: false, error: "not_configured" };
  if (params.payload.length > MAX_WEBHOOK_BODY_BYTES) {
    return { ok: false, error: "invalid_payload" };
  }

  const correlationId = newCorrelationId();
  const verification = verifyStripeSignature({
    payload: params.payload,
    header: params.signatureHeader,
    secret,
    nowSeconds: params.nowSeconds,
  });
  if (!verification.ok) {
    incrementCounter("webhook.rejected");
    logEvent({
      level: "warn",
      event: "webhook.signature_rejected",
      correlationId,
      meta: { reason: verification.error },
    });
    return { ok: false, error: "invalid_signature" };
  }

  let json: unknown;
  try {
    json = JSON.parse(params.payload);
  } catch {
    return { ok: false, error: "invalid_payload" };
  }
  const parsed = eventSchema.safeParse(json);
  if (!parsed.success) return { ok: false, error: "invalid_payload" };
  const event = parsed.data;

  const { data } = getAdapters();
  const inserted = await data.insertStripeEvent({
    id: event.id,
    type: event.type,
    payload: json as Record<string, unknown>,
    signatureVerified: true,
  });
  if (!inserted.created) {
    // Redelivery: acknowledge without queueing a second effect.
    return { ok: true, status: "duplicate" };
  }

  const amountField = WALLET_CREDIT_EVENTS[event.type];
  if (amountField && event.data.object.metadata?.purpose === "wallet_top_up") {
    const organizationId =
      event.data.object.metadata.organization_id ?? event.data.object.client_reference_id;
    const amountCents =
      amountField === "amount_total"
        ? event.data.object.amount_total
        : event.data.object.amount_received ?? event.data.object.amount;
    if (!organizationId || !amountCents || amountCents <= 0) {
      await data.markStripeEventProcessed(event.id);
      return { ok: true, status: "ignored" };
    }
    await data.appendBillingOutbox({
      organizationId,
      stripeEventId: event.id,
      action: "credit_wallet_top_up",
      payload: {
        organizationId,
        amountCents,
        stripeCustomerId: event.data.object.customer ?? null,
        source: event.type === "payment_intent.succeeded" ? "saved_card" : "checkout",
      },
    });
    await drainBillingOutbox();
    await data.markStripeEventProcessed(event.id);
    logEvent({
      level: "info",
      event: "webhook.processed",
      correlationId: event.id,
      meta: { type: event.type, amountCents },
    });
    return { ok: true, status: "processed" };
  }

  // Every other event type is recorded and acknowledged; nothing to apply.
  await data.markStripeEventProcessed(event.id);
  return { ok: true, status: "ignored" };
}

/**
 * Apply pending billing-outbox entries. Safe to run repeatedly and after
 * crashes: each effect is idempotent via its Stripe reference.
 */
export async function drainBillingOutbox(): Promise<{ processed: number; failed: number }> {
  const { data } = getAdapters();
  const pending = await data.listPendingBillingOutbox();
  let processed = 0;
  let failed = 0;
  for (const entry of pending) {
    await data.updateBillingOutbox(entry.id, {
      status: "processing",
      attempts: entry.attempts + 1,
    });
    try {
      await applyOutboxEntry(entry);
      await data.updateBillingOutbox(entry.id, {
        status: "done",
        processedAt: new Date().toISOString(),
      });
      processed += 1;
    } catch {
      // Bounded retries: back to pending until the attempt budget is spent.
      const attempts = entry.attempts + 1;
      await data.updateBillingOutbox(entry.id, {
        status: attempts >= 5 ? "failed" : "pending",
        attempts,
      });
      failed += 1;
    }
  }
  return { processed, failed };
}

async function applyOutboxEntry(entry: BillingOutboxRecord): Promise<void> {
  const { data } = getAdapters();
  if (entry.action !== "credit_wallet_top_up") return;

  const organizationId = String(entry.payload.organizationId ?? entry.organizationId ?? "");
  const amountCents = Number(entry.payload.amountCents ?? 0);
  const reference = entry.stripeEventId;
  if (!organizationId || !Number.isInteger(amountCents) || amountCents <= 0 || !reference) {
    throw new Error("outbox_entry_invalid");
  }

  // Idempotency guard: the same Stripe event can never credit twice.
  const existing = await data.listLedgerEntries(organizationId);
  if (existing.some((ledgerEntry) => ledgerEntry.stripeReference === reference)) {
    return;
  }

  const wallet = (await data.getWallet(organizationId)) ?? {
    organizationId,
    balanceCents: 0,
    reservedCents: 0,
  };
  await data.appendLedgerEntry({
    organizationId,
    kind: "top_up",
    amountCents,
    reservationId: null,
    stripeReference: reference,
    note:
      entry.payload.source === "saved_card"
        ? "Wallet top-up via saved payment method"
        : "Wallet top-up via Stripe Checkout",
  });
  await data.saveWallet({ ...wallet, balanceCents: wallet.balanceCents + amountCents });

  const stripeCustomerId = entry.payload.stripeCustomerId;
  if (typeof stripeCustomerId === "string" && stripeCustomerId.length > 0) {
    await data.setStripeCustomerId(organizationId, stripeCustomerId);
  }

  await data.appendAuditEvent({
    organizationId,
    actor: "system:billing",
    action: "billing.wallet_top_up_credited",
    target: `stripe_event:${reference}`,
    // Amounts only — never card data or payer identity (FR-7 redaction).
    meta: { amountCents },
  });
}
