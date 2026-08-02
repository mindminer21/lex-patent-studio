import { can } from "@/lib/domain/roles";
import { isLocalMode } from "@/lib/env";
import { getAdapters } from "@/lib/server/adapters";
import { ALLOWED_TOP_UP_CENTS } from "@/lib/server/adapters/production/stripe-billing";
import { BILLING_PLANS } from "@/lib/server/billing-plans";
import { requireOrg } from "@/lib/server/session";
import { openPortalAction, startTopUpAction } from "./actions";

function usd(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string; error?: string }>;
}) {
  const context = await requireOrg();
  const params = await searchParams;
  const { data } = getAdapters();
  const [wallet, ledger, usageEvents] = await Promise.all([
    data.getWallet(context.organization.id),
    data.listLedgerEntries(context.organization.id),
    data.listUsageEvents(context.organization.id),
  ]);
  const canManageBilling = can(context.membership.role, "billing.manage");

  return (
    <>
      <div className="wp-topbar">
        <h1>Billing</h1>
        <span className="org">{context.organization.name}</span>
      </div>
      {isLocalMode && (
        <div className="wp-boundary-banner">
          <strong>Local preview:</strong> all amounts are synthetic and checkout/portal handoffs
          go to clearly labeled simulated pages. Live subscriptions, card charges, and the real
          Stripe portal are approval-gated and not enabled in this build. Software fees never
          include legal services.
        </div>
      )}
      {params.checkout === "success" && (
        <p className="form-success" role="status">
          Checkout completed. The wallet credit below was applied through the verified webhook
          pipeline.
        </p>
      )}
      {params.checkout === "cancelled" && (
        <p className="form-error" role="status">
          Checkout was cancelled. No charge was made.
        </p>
      )}
      {params.error && (
        <p className="form-error" role="alert">
          {params.error === "forbidden"
            ? "Your role does not include billing management."
            : params.error === "invalid_amount"
              ? "That top-up amount is not offered."
              : "Billing is currently unavailable. Please try again."}
        </p>
      )}

      <div className="wp-grid cols-3">
        <div className="wp-card">
          <p className="venture-kicker">Wallet balance</p>
          <h2>{usd(wallet?.balanceCents ?? 0)}</h2>
          <p>Reserved for in-flight runs: {usd(wallet?.reservedCents ?? 0)}</p>
        </div>
        <div className="wp-card">
          <p className="venture-kicker">Plan</p>
          <h2>Explore (local)</h2>
          <p>Test-mode default. Live pricing requires explicit approval before launch.</p>
        </div>
        <div className="wp-card">
          <p className="venture-kicker">Usage pricing</p>
          <h2>cost × 1.50</h2>
          <p>
            Customer charge is actual provider cost times 1.50, with effective-dated rates recorded
            on every settled event.
          </p>
        </div>
      </div>

      <div className="wp-grid cols-2" style={{ marginTop: 22 }}>
        <div className="wp-card">
          <h2>Add usage funds</h2>
          <p>
            Top up the prepaid AI usage wallet through Stripe Checkout
            {isLocalMode ? " (simulated in this local build)" : ""}.
          </p>
          {canManageBilling ? (
            <form action={startTopUpAction}>
              <label htmlFor="topup-amount">Top-up amount</label>
              <select id="topup-amount" name="amountCents" defaultValue="2500">
                {ALLOWED_TOP_UP_CENTS.map((cents) => (
                  <option key={cents} value={cents}>
                    {usd(cents)}
                  </option>
                ))}
              </select>
              <button className="button venture-button" type="submit" style={{ marginLeft: 8 }}>
                Continue to checkout
              </button>
            </form>
          ) : (
            <p>Only owners and admins can manage billing for this organization.</p>
          )}
        </div>
        <div className="wp-card">
          <h2>Subscription &amp; invoices</h2>
          <p>
            Manage the plan, payment methods, and invoices in the Stripe Customer Portal
            {isLocalMode ? " (simulated in this local build)" : ""}.
          </p>
          {canManageBilling ? (
            <form action={openPortalAction}>
              <button className="button venture-button" type="submit">
                Open customer portal
              </button>
            </form>
          ) : (
            <p>Only owners and admins can manage billing for this organization.</p>
          )}
        </div>
      </div>

      <div className="wp-card" style={{ marginTop: 22 }}>
        <h2>Plans</h2>
        <p>
          Implementation defaults for test-mode Stripe products — not final public pricing.
          Changing live pricing requires explicit approval.
        </p>
        <table className="wp-table">
          <thead>
            <tr>
              <th scope="col">Plan</th>
              <th scope="col">Monthly fee</th>
              <th scope="col">Included AI usage credit</th>
              <th scope="col">Intended customer</th>
            </tr>
          </thead>
          <tbody>
            {BILLING_PLANS.map((plan) => (
              <tr key={plan.id}>
                <td>{plan.displayName}</td>
                <td>{plan.monthlyFeeCents === null ? "Custom" : usd(plan.monthlyFeeCents)}</td>
                <td>
                  {plan.includedCreditCents === null ? "Contracted" : usd(plan.includedCreditCents)}
                </td>
                <td>{plan.intendedCustomer}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="wp-grid cols-2" style={{ marginTop: 22 }}>
        <div className="wp-card">
          <h2>Wallet ledger</h2>
          <table className="wp-table">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Kind</th>
                <th scope="col">Amount</th>
                <th scope="col">Note</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((entry) => (
                <tr key={entry.id}>
                  <td>{new Date(entry.createdAt).toLocaleString()}</td>
                  <td>{entry.kind.replace(/_/g, " ")}</td>
                  <td>{usd(entry.amountCents)}</td>
                  <td>{entry.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="wp-card">
          <h2>AI usage events</h2>
          <table className="wp-table">
            <thead>
              <tr>
                <th scope="col">Model</th>
                <th scope="col">Tokens (in/out)</th>
                <th scope="col">Provider cost</th>
                <th scope="col">Charge</th>
                <th scope="col">Rate version</th>
              </tr>
            </thead>
            <tbody>
              {usageEvents.map((event) => (
                <tr key={event.id}>
                  <td>{event.modelId}</td>
                  <td>
                    {event.inputTokens}/{event.outputTokens}
                  </td>
                  <td>{usd(event.providerCostCents)}</td>
                  <td>{usd(event.customerChargeCents)}</td>
                  <td>{event.rateVersion}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {usageEvents.length === 0 && <p>No usage yet.</p>}
        </div>
      </div>
    </>
  );
}
