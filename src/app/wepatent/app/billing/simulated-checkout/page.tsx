import Link from "next/link";
import { notFound } from "next/navigation";
import { isLocalMode } from "@/lib/wepatent/env";
import { ALLOWED_TOP_UP_CENTS } from "@/lib/server/adapters/production/stripe-billing";
import { requireOrg } from "@/lib/server/session";
import { completeSimulatedCheckoutAction } from "../actions";

/**
 * Local-mode stand-in for the Stripe-hosted checkout page (FR-6 seam).
 * Completing it signs a synthetic webhook event and pushes it through the
 * production verification/dedupe/outbox pipeline. This page does not exist
 * in production mode.
 */
export default async function SimulatedCheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; amount?: string }>;
}) {
  if (!isLocalMode) notFound();
  const context = await requireOrg();
  const params = await searchParams;
  const amountCents = Number(params.amount);
  const valid =
    params.kind === "wallet_top_up" &&
    (ALLOWED_TOP_UP_CENTS as readonly number[]).includes(amountCents);

  return (
    <>
      <div className="wp-topbar">
        <h1>Simulated test checkout</h1>
        <span className="org">{context.organization.name}</span>
      </div>
      <div className="wp-boundary-banner" role="note">
        <strong>Local mode only:</strong> this is a simulated stand-in for the Stripe-hosted
        checkout page. No card is charged and no real money exists anywhere in this flow. Live
        billing is approval-gated (PRD §17).
      </div>

      <div className="wp-card" style={{ maxWidth: 480 }}>
        {valid ? (
          <>
            <h2>Wallet top-up: ${(amountCents / 100).toFixed(2)}</h2>
            <p>
              Completing this test payment sends a signed synthetic
              <code> checkout.session.completed</code> event through the same webhook
              verification, idempotency, and ledger pipeline used in production.
            </p>
            <form action={completeSimulatedCheckoutAction}>
              <input type="hidden" name="amountCents" value={amountCents} />
              <button className="button venture-button" type="submit">
                Complete test payment
              </button>
            </form>
            <p style={{ marginTop: 12 }}>
              <Link href="/wepatent/app/billing?checkout=cancelled">Cancel and return to billing</Link>
            </p>
          </>
        ) : (
          <>
            <h2>Invalid checkout request</h2>
            <p>This simulated checkout link is not valid.</p>
            <p>
              <Link href="/wepatent/app/billing">Return to billing</Link>
            </p>
          </>
        )}
      </div>
    </>
  );
}
