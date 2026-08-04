"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { can } from "@/lib/wepatent/domain/roles";
import { env, isLocalMode } from "@/lib/wepatent/env";
import {
  ALLOWED_TOP_UP_CENTS,
  computeStripeSignature,
} from "@/lib/server/adapters/production/stripe-billing";
import {
  processStripeWebhook,
  startCheckoutSession,
  startPortalSession,
  topUpWithSavedPaymentMethod,
} from "@/lib/server/services/billing";
import { requireOrg } from "@/lib/server/session";

/** Start a wallet top-up checkout (FR-6). */
export async function startTopUpAction(formData: FormData): Promise<void> {
  const context = await requireOrg();
  if (!can(context.membership.role, "billing.manage")) {
    redirect("/wepatent/app/billing?error=forbidden");
  }
  const amountCents = Number(formData.get("amountCents"));
  if (!(ALLOWED_TOP_UP_CENTS as readonly number[]).includes(amountCents)) {
    redirect("/wepatent/app/billing?error=invalid_amount");
  }
  const result = await startCheckoutSession({
    organizationId: context.organization.id,
    userId: context.user.id,
    request: { kind: "wallet_top_up", amountCents },
  });
  redirect(result.ok ? result.url : "/wepatent/app/billing?error=billing_unavailable");
}

/**
 * One-click top-up against the saved payment method (friction audit #7).
 * Still an explicit, amount-labeled spend action — only the Checkout detour
 * is removed. The wallet is credited by the verified webhook, never here.
 */
export async function savedCardTopUpAction(formData: FormData): Promise<void> {
  const context = await requireOrg();
  const amountCents = Number(formData.get("amountCents"));
  const result = await topUpWithSavedPaymentMethod({
    organizationId: context.organization.id,
    userId: context.user.id,
    actorRole: context.membership.role,
    amountCents,
  });
  if (result.ok) {
    redirect("/wepatent/app/billing?topup=success");
  }
  // SCA and declines are surfaced honestly, with the Checkout fallback
  // offered next to the message — never silently failed or faked.
  redirect(`/wepatent/app/billing?error=${result.error}&amount=${amountCents}`);
}

/** Open the Stripe Customer Portal (simulated in local mode). */
export async function openPortalAction(): Promise<void> {
  const context = await requireOrg();
  if (!can(context.membership.role, "billing.manage")) {
    redirect("/wepatent/app/billing?error=forbidden");
  }
  const result = await startPortalSession({
    organizationId: context.organization.id,
    userId: context.user.id,
  });
  redirect(result.ok ? result.url : "/wepatent/app/billing?error=billing_unavailable");
}

/**
 * Complete the SIMULATED local-mode checkout: builds a synthetic
 * `checkout.session.completed` event, signs it with the local webhook
 * secret, and runs it through the SAME verification → dedupe → outbox →
 * ledger pipeline production uses. Local mode only; no real money exists
 * anywhere in this path (PRD §17.4).
 */
export async function completeSimulatedCheckoutAction(formData: FormData): Promise<void> {
  if (!isLocalMode) redirect("/wepatent/app/billing");
  const context = await requireOrg();
  if (!can(context.membership.role, "billing.manage")) {
    redirect("/wepatent/app/billing?error=forbidden");
  }
  const amountCents = Number(formData.get("amountCents"));
  if (!(ALLOWED_TOP_UP_CENTS as readonly number[]).includes(amountCents)) {
    redirect("/wepatent/app/billing?error=invalid_amount");
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
      ? "/wepatent/app/billing?checkout=success"
      : "/wepatent/app/billing?error=simulated_checkout_failed",
  );
}
