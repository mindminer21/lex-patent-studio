import Link from "next/link";
import { notFound } from "next/navigation";
import { isLocalMode } from "@/lib/wepatent/env";
import { requireOrg } from "@/lib/server/session";

/**
 * Local-mode stand-in for the Stripe Customer Portal (FR-6 seam). In
 * production this handoff goes to a real billing.stripe.com session; the
 * page does not exist there.
 */
export default async function SimulatedPortalPage() {
  if (!isLocalMode) notFound();
  const context = await requireOrg();

  return (
    <>
      <div className="wp-topbar">
        <h1>Simulated customer portal</h1>
        <span className="org">{context.organization.name}</span>
      </div>
      <div className="wp-boundary-banner" role="note">
        <strong>Local mode only:</strong> in production this button opens the Stripe Customer
        Portal (subscription management, payment methods, invoices) on stripe.com. No Stripe
        account is configured in this build — activation is approval-gated (PRD §17).
      </div>
      <div className="wp-card" style={{ maxWidth: 480 }}>
        <h2>What the portal will offer</h2>
        <ul>
          <li>Change or cancel the subscription plan</li>
          <li>Update payment methods</li>
          <li>Download invoices and receipts</li>
        </ul>
        <p>
          Software subscription and AI usage charges only — legal-service fees are never billed
          through this portal.
        </p>
        <p>
          <Link href="/wepatent/app/billing">Return to billing</Link>
        </p>
      </div>
    </>
  );
}
