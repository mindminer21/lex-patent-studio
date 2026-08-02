import "server-only";

import { z } from "zod";
import { env } from "@/lib/wepatent/env";
import { getAdapters } from "../adapters";
import { verifyStripeSignature } from "../adapters/production/stripe-billing";
import type { BillingOutboxRecord, CheckoutRequest } from "../adapters/types";
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

const eventSchema = z.object({
  id: z.string().min(1).max(255),
  type: z.string().min(1).max(255),
  data: z.object({
    object: z
      .object({
        id: z.string().optional(),
        customer: z.string().nullish(),
        amount_total: z.number().int().nonnegative().nullish(),
        client_reference_id: z.string().nullish(),
        metadata: z.record(z.string(), z.string()).nullish(),
      })
      .loose(),
  }),
});

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

  if (
    event.type === "checkout.session.completed" &&
    event.data.object.metadata?.purpose === "wallet_top_up"
  ) {
    const organizationId =
      event.data.object.metadata.organization_id ?? event.data.object.client_reference_id;
    const amountCents = event.data.object.amount_total;
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
    note: "Wallet top-up via Stripe Checkout",
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
