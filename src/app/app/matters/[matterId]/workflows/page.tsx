import type { Metadata } from "next";
import Link from "next/link";
import { getAdapters } from "@/lib/adapters";
import { RunStateBadge, TierBadge } from "@/components/workspace/badges";
import { formatUsd } from "@/lib/domain/pricing";
import { canInvokeWorkflow } from "@/lib/domain/roles";
import { TIER_META } from "@/lib/domain/tiers";
import { COMPOSER_WORKFLOWS } from "@/lib/domain/workflow-meta";

export const metadata: Metadata = {
  title: "Workflows — Lex Patent Studio",
};

/**
 * Guided associate workflows (§8.2 /workflows, §5.1). Catalog with platform
 * tier floors plus this matter's run history per workflow. Invocation rights
 * are role-gated server-side; this page also shows what YOUR seat may run.
 */
export default async function MatterWorkflowsPage({
  params,
}: {
  params: Promise<{ matterId: string }>;
}) {
  const { matterId } = await params;
  const adapters = getAdapters();
  const session = await adapters.auth.getSession();
  if (!session) return null;

  const runs = await adapters.data.listRuns(session.organizationId, matterId);
  const runsByWorkflow = new Map<string, typeof runs>();
  for (const run of runs) {
    const list = runsByWorkflow.get(run.workflowKey) ?? [];
    list.push(run);
    runsByWorkflow.set(run.workflowKey, list);
  }

  return (
    <div className="max-w-[1100px] space-y-4">
      <section aria-labelledby="wf-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="wf-heading" className="m-0 text-xl font-medium" style={{ fontFamily: "Georgia, serif" }}>
            Guided workflows
          </h2>
          <Link
            href={`/app/matters/${matterId}`}
            className="text-[0.85rem] font-bold underline underline-offset-4"
          >
            Open the composer →
          </Link>
        </div>
        <p className="mt-1 max-w-[760px] text-[0.85rem] text-[var(--muted)]">
          Every workflow carries a platform tier floor that no role can
          demote. Estimates and reservations happen in the composer before any
          run; each run records its workflow version, model, corpus release,
          and style profile version.
        </p>
      </section>

      <ul className="m-0 list-none space-y-3 p-0">
        {COMPOSER_WORKFLOWS.map((workflow) => {
          const mayInvoke = canInvokeWorkflow(session.role, workflow.tier);
          const history = runsByWorkflow.get(workflow.key) ?? [];
          return (
            <li key={workflow.key} className="border border-[var(--line)] bg-[var(--white)] p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="m-0 text-[1.02rem] font-semibold">{workflow.label}</h3>
                <TierBadge tier={workflow.tier} compact />
                {!mayInvoke && (
                  <span className="border border-[#8d8d8d] bg-[#e8e6e0] px-1.5 py-0.5 text-[0.65rem] font-bold uppercase tracking-[0.08em] text-[#4a4a4a]">
                    Not available to your seat
                  </span>
                )}
              </div>
              <p className="mb-1 mt-1 text-[0.88rem]">{workflow.description}</p>
              <p className="m-0 text-[0.78rem] text-[var(--muted)]">
                Deliverables: {workflow.deliverableTypes.join(" · ")} · required
                human action: {TIER_META[workflow.tier].requiredHumanAction}
              </p>
              {history.length > 0 && (
                <ul className="mb-0 mt-2 list-none space-y-1 p-0" aria-label={`${workflow.label} run history`}>
                  {history.map((run) => (
                    <li
                      key={run.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--line)] pt-1.5 text-[0.8rem]"
                    >
                      <RunStateBadge state={run.state} />
                      <span className="font-semibold">{run.deliverableType}</span>
                      <span className="text-[var(--muted)]">
                        {run.workflowVersion} · {run.modelId} ·{" "}
                        {run.styleProfileVersion ?? "no style profile"} ·{" "}
                        {run.actualChargeUsd != null
                          ? `settled ${formatUsd(run.actualChargeUsd)}`
                          : `est. ${formatUsd(run.estimatedChargeLowUsd)}–${formatUsd(run.estimatedChargeHighUsd)}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
