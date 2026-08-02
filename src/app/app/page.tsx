import Link from "next/link";
import { getAdapters } from "@/lib/adapters";
import {
  DraftWatermark,
  RunStateBadge,
  TierBadge,
  VerificationBadge,
} from "@/components/workspace/badges";
import { DEADLINE_DISCLAIMER } from "@/lib/domain/schemas";
import { isTerminalRunState } from "@/lib/domain/run-state";
import { formatUsd } from "@/lib/domain/pricing";

export default async function AppHome() {
  const adapters = getAdapters();
  const session = await adapters.auth.getSession();
  if (!session) return null;
  const org = session.organizationId;

  const [pending, matters, runs, deadlines, wallet] = await Promise.all([
    adapters.data.listReviewItems(org, { state: "pending_review" }),
    adapters.data.listMatters(org),
    adapters.data.listRuns(org),
    adapters.data.listDeadlines(org),
    adapters.billing.getWalletBalanceUsd(org),
  ]);

  const matterById = new Map(matters.map((m) => [m.id, m]));
  const activeRuns = runs.filter((r) => !isTerminalRunState(r.state));
  const byTier = { A: 0, B: 0, C: 0 } as Record<"A" | "B" | "C", number>;
  for (const item of pending) byTier[item.tier] += 1;

  return (
    <div className="max-w-[1100px] space-y-10">
      <section aria-labelledby="rq-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1
            id="rq-heading"
            className="font-serif text-3xl font-medium tracking-tight"
            style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
          >
            Review queue
          </h1>
          <p className="m-0 text-[0.85rem] text-[var(--muted)]">
            Usage wallet: <strong>{formatUsd(wallet)}</strong> · every run shows
            its estimated charge before execution
          </p>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {(["A", "B", "C"] as const).map((tier) => (
            <div key={tier} className="border border-[var(--line)] bg-[var(--white)] p-4">
              <TierBadge tier={tier} />
              <p className="mt-3 mb-0 text-3xl font-medium" style={{ fontFamily: "Georgia, serif" }}>
                {byTier[tier]}
              </p>
              <p className="mb-0 mt-1 text-[0.8rem] text-[var(--muted)]">
                item{byTier[tier] === 1 ? "" : "s"} awaiting human review
              </p>
            </div>
          ))}
        </div>

        {pending.length === 0 ? (
          <p className="mt-4 border border-dashed border-[var(--line)] bg-[var(--white)] p-4 text-[0.9rem] text-[var(--muted)]">
            Nothing is waiting for review. Any new workflow output will appear
            here as <strong>DRAFT — NOT REVIEWED</strong> with its tier label
            until a practitioner records a decision.
          </p>
        ) : (
          <ul className="mt-4 list-none space-y-2 p-0">
            {pending.slice(0, 4).map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 border border-[var(--line)] bg-[var(--white)] p-3"
              >
                <TierBadge tier={item.tier} compact />
                <DraftWatermark reviewState={item.state} />
                <VerificationBadge state={item.verificationState} />
                <span className="min-w-[200px] flex-1 text-[0.92rem] font-semibold">
                  {item.documentTitle}
                </span>
                <span className="text-[0.8rem] text-[var(--muted)]">
                  {matterById.get(item.matterId)?.matterNumber} · due{" "}
                  {item.dueDate ?? "—"}
                </span>
                <Link href="/app/review-queue" className="text-[0.85rem] font-bold underline underline-offset-4">
                  Open in queue
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-right">
          <Link href="/app/review-queue" className="text-[0.9rem] font-bold underline underline-offset-4">
            Go to full review queue →
          </Link>
        </p>
      </section>

      <section aria-labelledby="runs-heading">
        <h2 id="runs-heading" className="text-xl font-medium" style={{ fontFamily: "Georgia, serif" }}>
          Active workflow runs
        </h2>
        {activeRuns.length === 0 ? (
          <p className="border border-dashed border-[var(--line)] bg-[var(--white)] p-4 text-[0.9rem] text-[var(--muted)]">
            No runs in flight. Every run you queue is labeled with its work
            tier and produces a draft for review — never an approved document.
          </p>
        ) : (
          <ul className="list-none space-y-2 p-0">
            {activeRuns.map((run) => (
              <li
                key={run.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 border border-[var(--line)] bg-[var(--white)] p-3"
              >
                <RunStateBadge state={run.state} />
                <TierBadge tier={run.tier} compact />
                <span className="min-w-[200px] flex-1 text-[0.92rem] font-semibold">
                  {run.deliverableType}
                </span>
                <span className="text-[0.8rem] text-[var(--muted)]">
                  {matterById.get(run.matterId)?.matterNumber} · {run.modelId} ·
                  est. {formatUsd(run.estimatedChargeLowUsd)}–{formatUsd(run.estimatedChargeHighUsd)}
                </span>
                <Link
                  href={`/app/matters/${run.matterId}`}
                  className="text-[0.85rem] font-bold underline underline-offset-4"
                >
                  Open matter
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="deadline-heading">
        <h2 id="deadline-heading" className="text-xl font-medium" style={{ fontFamily: "Georgia, serif" }}>
          Observed dates
        </h2>
        <p className="border border-[#b9a76a] bg-[#f4ecd2] p-3 text-[0.82rem] font-semibold text-[#5d4a12]">
          {DEADLINE_DISCLAIMER}
        </p>
        {deadlines.length === 0 ? (
          <p className="text-[0.9rem] text-[var(--muted)]">
            No dates observed yet. Dates Lex encounters will surface here with
            the same disclaimer — this screen is never a docket.
          </p>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full border-collapse bg-[var(--white)] text-[0.88rem]">
            <thead>
              <tr className="border-b border-[var(--ink)] text-left text-[0.72rem] uppercase tracking-[0.1em]">
                <th className="p-2">Observed date</th>
                <th className="p-2">Window</th>
                <th className="p-2">Matter</th>
                <th className="p-2">Detail</th>
              </tr>
            </thead>
            <tbody>
              {deadlines.map((d) => (
                <tr key={d.id} className="border-b border-[var(--line)] align-top">
                  <td className="p-2 font-bold whitespace-nowrap">{d.observedDate}</td>
                  <td className="p-2">{d.windowKind}</td>
                  <td className="p-2 whitespace-nowrap">
                    {matterById.get(d.matterId)?.matterNumber}
                  </td>
                  <td className="p-2 text-[var(--muted)]">{d.label}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </section>
    </div>
  );
}
