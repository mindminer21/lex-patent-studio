import { requireOrg } from "@/lib/server/session";
import { getAdapters } from "@/lib/server/adapters";
import { isLocalMode } from "@/lib/env";

function usd(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

export default async function BillingPage() {
  const context = await requireOrg();
  const { data } = getAdapters();
  const [wallet, ledger, usageEvents] = await Promise.all([
    data.getWallet(context.organization.id),
    data.listLedgerEntries(context.organization.id),
    data.listUsageEvents(context.organization.id),
  ]);

  return (
    <>
      <div className="wp-topbar">
        <h1>Billing</h1>
        <span className="org">{context.organization.name}</span>
      </div>
      {isLocalMode && (
        <div className="wp-boundary-banner">
          <strong>Local preview:</strong> all amounts are synthetic. Live subscriptions, wallet
          top-ups, and the Stripe customer portal are approval-gated and not enabled in this
          build. Software fees never include legal services.
        </div>
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
