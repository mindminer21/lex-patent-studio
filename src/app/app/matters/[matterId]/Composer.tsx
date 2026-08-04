"use client";

import { useActionState, useState } from "react";
import { createRunAction, type ActionState } from "@/app/app/actions";
import { LEX_WORKFLOW_CATEGORY } from "@/lib/shared/billing/task-category";
import { formatMultiplier, MARKUP_MULTIPLIERS } from "@/lib/shared/billing/markup";
import {
  estimateCharge,
  formatUsd,
  MODEL_TIER_LABELS,
  MODEL_TIERS,
  modelsForTier,
  walletSufficient,
  type ModelTier,
} from "@/lib/domain/pricing";
import { COMPOSER_WORKFLOWS, getWorkflowMeta } from "@/lib/domain/workflow-meta";
import { TIER_META } from "@/lib/domain/tiers";

/**
 * Composer (PRD §8.3 contract): task, jurisdiction + as-of date, model tier
 * picker with per-model pricing, deliverable type, quality-control toggles,
 * and the estimated charge range + wallet sufficiency before execution.
 *
 * The tier label shown here is platform policy — it cannot be demoted by
 * any user (Invariant 15). Server-side policy re-checks everything.
 */
export function Composer({
  matterId,
  walletBalanceUsd,
}: {
  matterId: string;
  walletBalanceUsd: number;
}) {
  const [state, formAction, pending] = useActionState<ActionState | null, FormData>(
    createRunAction,
    null,
  );

  const [workflowKey, setWorkflowKey] = useState(COMPOSER_WORKFLOWS[0].key);
  const [modelTier, setModelTier] = useState<ModelTier>("advanced");
  const tierModels = modelsForTier(modelTier);
  const [modelId, setModelId] = useState(tierModels[0]?.id ?? "");
  const workflow = getWorkflowMeta(workflowKey) ?? COMPOSER_WORKFLOWS[0];
  const [deliverableType, setDeliverableType] = useState(workflow.deliverableTypes[0]);

  const activeModel =
    tierModels.find((m) => m.id === modelId) ?? tierModels[0];

  const estimate = activeModel
    ? estimateCharge(activeModel, workflow.workload, LEX_WORKFLOW_CATEGORY[workflow.key] ?? "analysis")
    : null;
  const sufficient = estimate ? walletSufficient(walletBalanceUsd, estimate) : false;

  const today = new Date().toISOString().slice(0, 10);

  function onWorkflowChange(key: string) {
    setWorkflowKey(key as typeof workflowKey);
    const meta = getWorkflowMeta(key);
    if (meta) setDeliverableType(meta.deliverableTypes[0]);
  }

  function onTierChange(tier: ModelTier) {
    setModelTier(tier);
    const first = modelsForTier(tier)[0];
    if (first) setModelId(first.id);
  }

  const labelCls =
    "block text-[0.68rem] font-bold uppercase tracking-[0.1em] text-[var(--muted)] mb-1";
  const fieldCls =
    "w-full border border-[var(--line)] bg-[var(--white)] px-2 py-2 text-[0.9rem] min-h-[44px]";

  return (
    <form
      action={formAction}
      className="border border-[var(--ink)] bg-[var(--white)] p-4"
      aria-label="Run composer"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="m-0 text-lg font-medium" style={{ fontFamily: "Georgia, serif" }}>
          Compose a run
        </h2>
        <span className="border border-[#b9a76a] bg-[#f4ecd2] px-1.5 py-0.5 text-[0.66rem] font-bold uppercase tracking-[0.08em] text-[#5d4a12]">
          {TIER_META[workflow.tier].label} · platform policy, not demotable
        </span>
      </div>
      <p className="mt-1 mb-4 text-[0.8rem] text-[var(--muted)]">
        {workflow.description} Output arrives as{" "}
        <strong>DRAFT — NOT REVIEWED</strong> and enters the Tier-
        {workflow.tier} review queue.
      </p>

      <input type="hidden" name="matterId" value={matterId} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="composer-task" className={labelCls}>
            Task
          </label>
          <select
            id="composer-task"
            name="workflowKey"
            className={fieldCls}
            value={workflowKey}
            onChange={(e) => onWorkflowChange(e.target.value)}
          >
            {COMPOSER_WORKFLOWS.map((w) => (
              <option key={w.key} value={w.key}>
                {w.label} (Tier {w.tier})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="composer-deliverable" className={labelCls}>
            Deliverable type
          </label>
          <select
            id="composer-deliverable"
            name="deliverableType"
            className={fieldCls}
            value={deliverableType}
            onChange={(e) => setDeliverableType(e.target.value)}
          >
            {workflow.deliverableTypes.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="composer-jurisdiction" className={labelCls}>
            Jurisdiction
          </label>
          <select id="composer-jurisdiction" name="jurisdiction" className={fieldCls} defaultValue="US">
            <option value="US">United States (launch jurisdiction)</option>
          </select>
        </div>
        <div>
          <label htmlFor="composer-asof" className={labelCls}>
            As-of date (authority retrieval)
          </label>
          <input
            id="composer-asof"
            name="asOfDate"
            type="date"
            className={fieldCls}
            defaultValue={today}
            required
          />
        </div>
      </div>

      <fieldset className="mt-4 border border-[var(--line)] p-3">
        <legend className="px-1 text-[0.68rem] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
          Model tier and engine
        </legend>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Model tier">
          {MODEL_TIERS.map((tier) => (
            <button
              key={tier}
              type="button"
              onClick={() => onTierChange(tier)}
              aria-pressed={modelTier === tier}
              className={`min-h-[44px] border px-4 text-[0.85rem] font-bold ${
                modelTier === tier
                  ? "border-[var(--forest)] bg-[var(--forest)] text-[var(--white)]"
                  : "border-[var(--line)] bg-[var(--white)]"
              }`}
            >
              {MODEL_TIER_LABELS[tier]}
            </button>
          ))}
        </div>
        <div className="mt-3 space-y-1.5">
          {tierModels.map((m) => (
            <label
              key={m.id}
              className={`flex min-h-[44px] cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 border px-3 py-1.5 text-[0.85rem] ${
                activeModel?.id === m.id
                  ? "border-[var(--forest)] bg-[#eef3e2]"
                  : "border-[var(--line)]"
              }`}
            >
              <input
                type="radio"
                name="modelId"
                value={m.id}
                checked={activeModel?.id === m.id}
                onChange={() => setModelId(m.id)}
              />
              <strong>{m.displayName}</strong>
              <span className="text-[var(--muted)]">{m.provider}</span>
              <span className="ml-auto text-[0.78rem] text-[var(--muted)]">
                in {formatUsd(m.inputPerMTokUsd)}/M · out {formatUsd(m.outputPerMTokUsd)}/M
                (provider rate; billed ×{formatMultiplier(MARKUP_MULTIPLIERS.generation)} when
                generating, ×{formatMultiplier(MARKUP_MULTIPLIERS.analysis)} when analysing)
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="mt-4 border border-[var(--line)] p-3">
        <legend className="px-1 text-[0.68rem] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
          Quality controls
        </legend>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-[0.85rem]">
          <label className="flex min-h-[44px] items-center gap-2">
            <input type="checkbox" name="qcSourceRequired" defaultChecked />
            Source-required grounding
          </label>
          <label className="flex min-h-[44px] items-center gap-2">
            <input type="checkbox" name="qcSecondModel" defaultChecked />
            Second-model critique
          </label>
          <label className="flex min-h-[44px] items-center gap-2">
            <input type="checkbox" name="qcQuoteVerification" defaultChecked />
            Quote verification
          </label>
        </div>
      </fieldset>

      <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-[var(--line)] pt-4">
        <div className="text-[0.9rem]">
          <span className="block text-[0.68rem] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
            Estimated charge range
          </span>
          {estimate ? (
            <strong style={{ fontFamily: "Georgia, serif", fontSize: "1.35rem", fontWeight: 500 }}>
              {formatUsd(estimate.lowChargeUsd)} – {formatUsd(estimate.highChargeUsd)}
            </strong>
          ) : (
            "—"
          )}
          <span className="block text-[0.72rem] text-[var(--muted)]">
            provider cost × {estimate ? formatMultiplier(estimate.markup) : "—"}{" "}
            ({estimate ? estimate.category : "—"}) · wallet {formatUsd(walletBalanceUsd)}{" "}
            {sufficient ? "(sufficient)" : "(insufficient — top up required)"}
          </span>
        </div>
        <button
          type="submit"
          disabled={pending || !sufficient}
          className="button ml-auto disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? "Queuing…" : "Queue run"}
        </button>
      </div>

      {state && (
        <p
          role="status"
          className={`mt-3 mb-0 border p-2.5 text-[0.85rem] ${
            state.ok
              ? "border-[#5f7d4f] bg-[#e2eecd] text-[#2f4a16]"
              : "border-[#a05252] bg-[#f6dcdc] text-[#7c1f1f]"
          }`}
        >
          {state.message}
        </p>
      )}

      <p className="mt-3 mb-0 text-[0.7rem] leading-relaxed text-[var(--muted)]">
        Local mode: runs are recorded and labeled but no model provider is
        called and no charge occurs. In production, execution starts only
        after reservation against your wallet.
      </p>
    </form>
  );
}
