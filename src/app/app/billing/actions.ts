"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { can } from "@/lib/domain/roles";
import { env, isLocalMode } from "@/lib/env";
import {
  ALLOWED_TOP_UP_CENTS,
  computeStripeSignature,
} from "@/lib/server/adapters/production/stripe-billing";
import {
  processStripeWebhook,
  startCheckoutSession,
  startPortalSession,
} from "@/lib/server/services/billing";
import { requireOrg } from "@/lib/server/session";

/** Start a wallet top-up checkout (FR-6). */
export async function startTopUpAction(formData: FormData): Promise<void> {
  const context = await requireOrg();
  if (!can(context.membership.role, "billing.manage")) {
    redirect("/app/billing?error=forbidden");
  }
  const amountCents = Number(formData.get("amountCents"));
  if (!(ALLOWED_TOP_UP_CENTS as readonly number[]).includes(amountCents)) {
    redirect("/app/billing?error=invalid_amount");
  }
  const result = await startCheckoutSession({
    organizationId: context.organization.id,
    userId: context.user.id,
    request: { kind: "wallet_top_up", amountCents },
  });
  redirect(result.ok ? result.url : "/app/billing?error=billing_unavailable");
}

/** Open the Stripe Customer Portal (simulated in local mode). */
export async function openPortalAction(): Promise<void> {
  const context = await requireOrg();
  if (!can(context.membership.role, "billing.manage")) {
    redirect("/app/billing?error=forbidden");
  }
  const result = await startPortalSession({
    organizationId: context.organization.id,
    userId: context.user.id,
  });
  redirect(result.ok ? result.url : "/app/billing?error=billing_unavailable");
}

/**
 * Complete the SIMULATED local-mode checkout: builds a synthetic
 * `checkout.session.completed` event, signs it with the local webhook
 * secret, and runs it through the SAME verification → dedupe → outbox →
 * ledger pipeline production uses. Local mode only; no real money exists
 * anywhere in this path (PRD §17.4).
 */
export async function completeSimulatedCheckoutAction(formData: FormData): Promise<void> {
  if (!isLocalMode) redirect("/app/billing");
  const context = await requireOrg();
  if (!can(context.membership.role, "billing.manage")) {
    redirect("/app/billing?error=forbidden");
  }
  const amountCents = Number(formData.get("amountCents"));
  if (!(ALLOWED_TOP_UP_CENTS as readonly number[]).includes(amountCents)) {
    redirect("/app/billing?error=invalid_amount");
  }

  const event = {
    id: `evt_local_${randomUUID()}`,
    type: "checkout.session.completed",
    data: {
      object: {
        id: `cs_local_${randomUUID()}`,
        customer: `cus_local_${context.organization.id.slice(0, 8)}`,
        amount_total: amountCents,
        client_reference_id: context.organization.id,
        metadata: {
          organization_id: context.organization.id,
          purpose: "wallet_top_up",
        },
      },
    },
  };
  const payload = JSON.stringify(event);
  const signatureHeader = computeStripeSignature(
    payload,
    env.STRIPE_WEBHOOK_SECRET,
    Math.floor(Date.now() / 1000),
  );

  const result = await processStripeWebhook({ payload, signatureHeader });
  redirect(
    result.ok && result.status === "processed"
      ? "/app/billing?checkout=success"
      : "/app/billing?error=simulated_checkout_failed",
  );
}
