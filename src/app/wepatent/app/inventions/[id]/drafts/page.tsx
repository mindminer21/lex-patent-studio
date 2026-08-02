import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { getAdapters } from "@/lib/server/adapters";
import {
  MODEL_TIERS,
  WORKFLOW_ALLOWLIST,
  WORKFLOW_TITLES,
} from "@/lib/server/model-registry";
import JobProgress from "@/components/wepatent/JobProgress";
import { estimateForTier } from "@/lib/server/services/generation";
import { requireOnboarded } from "@/lib/server/session";
import type { DraftWorkflow } from "@/lib/server/adapters/types";
import { generateDraftAction, retryGenerationAction } from "../actions";

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

const ERROR_MESSAGES: Record<string, string> = {
  insufficient_funds:
    "Your wallet balance is not sufficient to reserve this run. No generation was started.",
  workflow_not_allowed: "That model tier is not allowed for the selected workflow.",
  generation_failed: "The generation failed. The reservation was released without charge.",
  invalid_input: "Invalid generation request.",
};

export default async function DraftsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; version?: string; job?: string }>;
}) {
  const { id } = await params;
  const { error, version: versionId, job: jobId } = await searchParams;
  const context = await requireOnboarded();
  const { data } = getAdapters();
  const invention = await data.getInvention(context.organization.id, id);
  if (!invention) notFound();

  const [drafts, wallet, facts] = await Promise.all([
    data.listDrafts(context.organization.id, id),
    data.getWallet(context.organization.id),
    data.listFacts(context.organization.id, id),
  ]);
  const draftsWithVersions = await Promise.all(
    drafts.map(async (draft) => ({
      draft,
      versions: await data.listDraftVersions(context.organization.id, draft.id),
    })),
  );
  const selectedVersion = versionId
    ? await data.getDraftVersion(context.organization.id, versionId)
    : null;
  const selectedCitations = selectedVersion
    ? await data.listDraftCitations(context.organization.id, selectedVersion.id)
    : [];

  const approximateInputTokens = Math.max(
    200,
    Math.ceil(
      (invention.summary.length +
        invention.problem.length +
        invention.solution.length +
        facts.reduce((sum, fact) => sum + fact.statement.length, 0)) /
        4,
    ),
  );
  const available = wallet ? wallet.balanceCents - wallet.reservedCents : 0;
  const idempotencyKey = randomUUID();

  return (
    <>
      <div className="wp-boundary-banner">
        Every output is an automated <strong>working draft — counsel review required</strong>. The
        model reads your fact record; it can never change facts, approve itself, or take actions.
      </div>
      {error && (
        <p className="form-error" role="alert">
          {ERROR_MESSAGES[error] ?? "Something went wrong."}
        </p>
      )}

      {jobId && !selectedVersion && (
        <JobProgress
          jobId={jobId}
          successPath={`/wepatent/app/inventions/${id}/drafts?version=:versionId`}
        >
          <form action={retryGenerationAction} className="wp-inline-form">
            <input type="hidden" name="jobId" value={jobId} />
            <button className="button button-secondary button-small" type="submit">
              Retry generation (same idempotency key)
            </button>
          </form>
        </JobProgress>
      )}

      {selectedVersion && (
        <div className="wp-card" style={{ marginBottom: 22 }}>
          <p className="venture-kicker">Working draft — counsel review required</p>
          <h2>Draft version {selectedVersion.version}</h2>
          <div className="wp-draft-meta">
            <span>Model: {selectedVersion.modelId}</span>
            <span>Generated: {new Date(selectedVersion.createdAt).toLocaleString()}</span>
            <span>Estimated (high): {usd(selectedVersion.estimateCustomerHighCents)}</span>
            <span>Actual charge: {usd(selectedVersion.actualCustomerChargeCents)}</span>
            <span>Rate version: {selectedVersion.rateVersion}</span>
            <span>Unresolved facts at generation: {selectedVersion.unresolvedFactCount}</span>
            <span>Sources: {selectedVersion.sourceStatusSummary}</span>
          </div>
          <div className="wp-draft-output">{selectedVersion.content}</div>
          {selectedCitations.length > 0 && (
            <>
              <h3 style={{ marginTop: 18 }}>Linked references (§7.4)</h3>
              <ul>
                {selectedCitations.map((citation) => (
                  <li key={citation.id}>
                    <code>{citation.locator}</code>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <div className="wp-grid cols-2">
        <div className="wp-card">
          <h2>Generate a working draft</h2>
          <p>
            Wallet available: <strong>{usd(available)}</strong>. The high estimate is reserved
            before the run and settled from provider-reported usage at cost × 1.50; failed runs
            are never charged.
          </p>
          <form action={generateDraftAction} className="wp-form">
            <input type="hidden" name="inventionId" value={id} />
            <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
            <div className="field">
              <label htmlFor="workflow">Workflow</label>
              <select id="workflow" name="workflow" required defaultValue="invention_disclosure_summary">
                {(Object.keys(WORKFLOW_TITLES) as DraftWorkflow[]).map((workflow) => (
                  <option key={workflow} value={workflow}>
                    {WORKFLOW_TITLES[workflow]}
                  </option>
                ))}
              </select>
              <p className="hint">
                Allowed tiers per workflow:{" "}
                {(Object.keys(WORKFLOW_ALLOWLIST) as DraftWorkflow[])
                  .map((w) => `${WORKFLOW_TITLES[w]}: ${WORKFLOW_ALLOWLIST[w].join(", ")}`)
                  .join(" · ")}
              </p>
            </div>
            <div className="field">
              <label htmlFor="tierId">Model tier</label>
              <select id="tierId" name="tierId" required defaultValue="standard">
                {MODEL_TIERS.map((tier) => {
                  const estimate = estimateForTier(tier, approximateInputTokens);
                  return (
                    <option key={tier.id} value={tier.id}>
                      {tier.displayName} — est. {usd(estimate.customerLowCents)}–
                      {usd(estimate.customerHighCents)}
                    </option>
                  );
                })}
              </select>
              <p className="hint">
                Estimates include the 1.50× markup on provider cost. The high bound is reserved
                against your wallet.
              </p>
            </div>
            <div>
              <button className="button venture-button" type="submit">
                Reserve and generate
              </button>
            </div>
          </form>
        </div>

        <div className="wp-card">
          <h2>Draft history</h2>
          {draftsWithVersions.length === 0 ? (
            <p>No drafts yet. Generated drafts appear here with full version history.</p>
          ) : (
            <table className="wp-table">
              <thead>
                <tr>
                  <th scope="col">Draft</th>
                  <th scope="col">Versions</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {draftsWithVersions.map(({ draft, versions }) => (
                  <tr key={draft.id}>
                    <td>{draft.title}</td>
                    <td>
                      {versions.map((version) => (
                        <span key={version.id}>
                          <a href={`/wepatent/app/inventions/${id}/drafts?version=${version.id}`}>
                            v{version.version}
                          </a>{" "}
                        </span>
                      ))}
                    </td>
                    <td>
                      <span className="wp-badge draft-label">working draft</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
