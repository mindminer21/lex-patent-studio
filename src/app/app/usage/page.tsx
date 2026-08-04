import type { Metadata } from "next";
import { getAdapters } from "@/lib/adapters";
import { RunStateBadge } from "@/components/workspace/badges";
import { formatUsd } from "@/lib/domain/pricing";
import { markupDisclosure } from "@/lib/shared/billing/markup";

export const metadata: Metadata = {
  title: "Usage — Lex Patent Studio",
};

/**
 * /usage (§8.2): wallet, reservations, settlements, and estimates (FR-9).
 * Local mode shows the synthetic wallet and the real reservation→settlement
 * ledger produced by the simulated orchestrator. Stripe top-ups, invoices,
 * and the customer portal are approval-gated production seams.
 */
export default async function UsagePage() {
  const adapters = getAdapters();
  const session = await adapters.auth.getSession();
  if (!session) return null;
  const org = session.organizationId;

  const [wallet, runs, matters, reservations] = await Promise.all([
    adapters.billing.getWalletBalanceUsd(org),
    adapters.data.listRuns(org),
    adapters.data.listMatters(org),
    adapters.data.listReservations(org),
  ]);
  const matterById = new Map(matters.map((m) => [m.id, m]));
  const runById = new Map(runs.map((r) => [r.id, r]));

  const settledTotal = reservations
    .filter((r) => r.state === "settled")
    .reduce((sum, r) => sum + (r.settledUsd ?? 0), 0);
  const heldTotal = reservations
    .filter((r) => r.state === "held")
    .reduce((sum, r) => sum + r.heldUsd, 0);

  return (
    <div className="max-w-[1100px] space-y-8">
      <header>
        <h1 className="m-0 text-3xl font-medium tracking-tight" style={{ fontFamily: "Georgia, serif" }}>
          Usage
        </h1>
        <p className="mt-1 mb-0 max-w-[760px] text-[0.92rem] text-[var(--muted)]">
          Prepaid wallet, reservations, and settlements. Every charge is{" "}
          {markupDisclosure()} — the multiplier follows the task, so drafting,
          claim, response, memo, and search-report work bills at the generation
          rate and extraction, classification, and verification work bills at the
          analysis rate. The estimate range is disclosed before execution; the
          reservation holds the high end and returns the remainder at settlement.
        </p>
      </header>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="Wallet summary">
        <div className="border border-[var(--line)] bg-[var(--white)] p-4">
          <p className="m-0 text-[0.7rem] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
            Wallet balance
          </p>
          <p className="mb-0 mt-2 text-3xl font-medium" style={{ fontFamily: "Georgia, serif" }}>
            {formatUsd(wallet)}
          </p>
        </div>
        <div className="border border-[var(--line)] bg-[var(--white)] p-4">
          <p className="m-0 text-[0.7rem] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
            Currently reserved (held)
          </p>
          <p className="mb-0 mt-2 text-3xl font-medium" style={{ fontFamily: "Georgia, serif" }}>
            {formatUsd(heldTotal)}
          </p>
        </div>
        <div className="border border-[var(--line)] bg-[var(--white)] p-4">
          <p className="m-0 text-[0.7rem] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
            Settled this session
          </p>
          <p className="mb-0 mt-2 text-3xl font-medium" style={{ fontFamily: "Georgia, serif" }}>
            {formatUsd(settledTotal)}
          </p>
        </div>
      </section>

      <section aria-labelledby="ledger-heading">
        <h2 id="ledger-heading" className="text-xl font-medium" style={{ fontFamily: "Georgia, serif" }}>
          Reservation → settlement ledger
        </h2>
        {reservations.length === 0 ? (
          <p className="border border-dashed border-[var(--line)] bg-[var(--white)] p-4 text-[0.9rem] text-[var(--muted)]">
            No reservations yet this session. Queue a run from a matter
            workspace — the hold appears here immediately, before any
            execution.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse bg-[var(--white)] text-[0.86rem]">
              <thead>
                <tr className="border-b border-[var(--ink)] text-left text-[0.7rem] uppercase tracking-[0.1em]">
                  <th className="p-2">Run</th>
                  <th className="p-2">Matter</th>
                  <th className="p-2">State</th>
                  <th className="p-2">Held</th>
                  <th className="p-2">Settled</th>
                  <th className="p-2">Returned</th>
                </tr>
              </thead>
              <tbody>
                {reservations.map((reservation) => {
                  const run = runById.get(reservation.runId);
                  const returned =
                    reservation.state === "settled"
                      ? reservation.heldUsd - (reservation.settledUsd ?? 0)
                      : reservation.state === "released"
                        ? reservation.heldUsd
                        : 0;
                  return (
                    <tr key={reservation.id} className="border-b border-[var(--line)] align-top">
                      <td className="p-2">
                        {run ? (
                          <>
                            <RunStateBadge state={run.state} />
                            <span className="mt-0.5 block text-[0.78rem] text-[var(--muted)]">
                              {run.workflowKey} · {run.modelId}
                            </span>
                          </>
                        ) : (
                          reservation.runId
                        )}
                      </td>
                      <td className="p-2 whitespace-nowrap">
                        {run ? matterById.get(run.matterId)?.matterNumber : "—"}
                      </td>
                      <td className="p-2 font-bold uppercase text-[0.75rem]">
                        {reservation.state}
                      </td>
                      <td className="p-2">{formatUsd(reservation.heldUsd)}</td>
                      <td className="p-2">
                        {reservation.settledUsd != null
                          ? formatUsd(reservation.settledUsd)
                          : "—"}
                      </td>
                      <td className="p-2">{formatUsd(returned)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="billing-seam-heading">
        <h2 id="billing-seam-heading" className="text-xl font-medium" style={{ fontFamily: "Georgia, serif" }}>
          Top-ups, invoices, and the customer portal
        </h2>
        <p className="m-0 border border-[var(--line)] bg-[var(--white)] p-4 text-[0.88rem] leading-relaxed">
          Stripe subscriptions, wallet top-ups, invoices, and the customer
          portal are production capabilities behind the billing seam. They
          require Stripe credentials and Jeff&apos;s explicit approval before any
          live billing (PRD-wepatent §17.1/§17.4; pricing itself is
          approval-gated per PRD §20.14). Local mode never charges anything —
          the wallet above is synthetic.
        </p>
      </section>
    </div>
  );
}
