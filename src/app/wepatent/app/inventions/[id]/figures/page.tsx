import Link from "next/link";
import { notFound } from "next/navigation";
import StudioJobProgress from "@/components/wepatent/StudioJobProgress";
import { getAdapters } from "@/lib/server/adapters";
import { markupDisclosure } from "@/lib/wepatent/domain/markup";
import { getLatestFigureSetView } from "@/lib/server/services/figures";
import { requireOnboarded } from "@/lib/server/session";
import { acceptFiguresAction, generateFiguresAction, renamePartAction } from "./actions";

export const dynamic = "force-dynamic";

const SET_STATE_LABELS: Record<string, string> = {
  planning: "Planning the figure set",
  generating: "Drawing the figures",
  composing: "Composing the sheets",
  validating: "Checking the sheets",
  ready: "Ready for your review",
  needs_input: "Needs more from you",
  paused_budget: "Paused — budget cap reached",
  failed: "Could not complete",
};

const FIGURE_STATE_LABELS: Record<string, string> = {
  planned: "Planned",
  generated: "Drawn",
  composed: "Composed",
  ready: "Ready",
  needs_input: "Needs your input",
  needs_human_review: "Needs a person to look",
  failed: "Failed",
};

const AI_STATE_LABELS: Record<string, string> = {
  ai_proposed: "AI proposed — awaiting your review",
  user_confirmed: "Accepted by you",
  user_edited: "Edited by you",
};

const VALIDATION_STATUS_LABELS: Record<string, string> = {
  pass: "Met",
  fail: "Not met",
  not_applicable: "Not applicable",
  needs_human_review: "Needs a person to confirm",
};

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default async function FiguresPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ job?: string; accepted?: string; renamed?: string; error?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const context = await requireOnboarded();
  const { data } = getAdapters();
  const invention = await data.getInvention(context.organization.id, id);
  if (!invention) notFound();

  const view = await getLatestFigureSetView(context.organization.id, id);
  const failures = view.validations.filter((entry) => entry.status === "fail");
  const reviews = view.validations.filter((entry) => entry.status === "needs_human_review");
  const passes = view.validations.filter((entry) => entry.status === "pass");
  const briefDescription = view.figures
    .filter((figure) => figure.briefDescription.length > 0)
    .map((figure) => figure.briefDescription);
  const needsInput = view.figures.filter((figure) => figure.state === "needs_input");

  return (
    <>
      {query.job && (
        <StudioJobProgress
          jobId={query.job}
          refreshPath={`/wepatent/app/inventions/${id}/figures`}
        />
      )}

      <div className="wp-card" style={{ marginBottom: 22 }}>
        <p className="venture-kicker">Working draft — counsel review required</p>
        <h2>Drawings</h2>
        <p>
          Figures are planned, drawn, composed onto formal sheets, and checked automatically
          from your record — no steps required from you. Everything here is an AI proposal
          until you accept it. Nothing on this page is filing-ready, and nothing here is
          legal advice.
        </p>
        {!view.lineArtAvailable && (
          <p className="hint" data-testid="line-art-unavailable">
            Generated line art is not enabled on this deployment. Block diagrams, flowcharts,
            waveforms, formulae and figures derived from an uploaded 3D model are drawn
            deterministically and are unaffected. Views that would need a drawing model are
            listed below with the question we need answered instead.
          </p>
        )}
      </div>

      {!view.set && (
        <div className="wp-card" style={{ marginBottom: 22 }} data-testid="figures-empty">
          <h2>No figures yet</h2>
          <p>
            Figures are generated automatically when a draft is created or materially
            updated. You can also start a run now. Estimated charges are {markupDisclosure()};
            deterministic diagrams and model-derived views cost nothing.
          </p>
          <form action={generateFiguresAction}>
            <input type="hidden" name="inventionId" value={id} />
            <button className="button venture-button" type="submit">
              Generate figures
            </button>
          </form>
        </div>
      )}

      {view.set && (
        <>
          <div className="wp-grid cols-2" style={{ marginBottom: 22 }}>
            <div className="wp-card">
              <p className="venture-kicker">Status</p>
              <h2 data-testid="figure-set-state">
                {SET_STATE_LABELS[view.set.state] ?? view.set.state}
              </h2>
              <p data-testid="figure-set-ai-state">
                {AI_STATE_LABELS[view.set.aiState] ?? view.set.aiState}
              </p>
              {view.set.statusDetail && (
                <p className="hint" data-testid="figure-set-detail">
                  {view.set.statusDetail}
                </p>
              )}
            </div>
            <div className="wp-card">
              <p className="venture-kicker">Provenance and cost</p>
              <h2>{usd(view.set.totalCostCents)}</h2>
              <p className="hint">
                Rules {view.set.rulesVersion} · planner {view.set.plannerVersion} · composer{" "}
                {view.set.composerVersion}
                {view.set.modelId ? ` · drawing model ${view.set.modelId}` : ""}
                {view.set.promptTemplateVersion
                  ? ` · prompt ${view.set.promptTemplateVersion}`
                  : ""}
              </p>
              <p className="hint">
                Provider cost {usd(view.set.totalProviderCostCents)} · charged at{" "}
                {markupDisclosure()}.
              </p>
            </div>
          </div>

          {needsInput.length > 0 && (
            <div className="wp-card" style={{ marginBottom: 22 }} data-testid="figures-needs-input">
              <h2>We need a bit more before we can draw these</h2>
              <p>
                We will not invent geometry the record does not support. Each question below
                is what we need in order to draw that view honestly.
              </p>
              <ul>
                {needsInput.map((figure) => (
                  <li key={figure.id}>
                    <strong>{figure.title}</strong> — {figure.needsInputQuestion}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="wp-card" style={{ marginBottom: 22 }}>
            <h2>Sheets</h2>
            {view.sheets.length === 0 && <p>No sheets have been composed yet.</p>}
            <ul className="wp-list">
              {view.sheets.map((sheet) => (
                <li key={sheet.id}>
                  <Link
                    href={`/api/figures/${view.set!.id}/sheets/${sheet.sheetNumber}`}
                    data-testid={`figure-sheet-${sheet.sheetNumber}`}
                  >
                    Sheet {sheet.sheetNumber} of {sheet.totalSheets}
                  </Link>{" "}
                  <span className="hint">SHA-256 {sheet.checksumSha256.slice(0, 12)}…</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="wp-card" style={{ marginBottom: 22 }}>
            <h2>Figures</h2>
            <table className="wp-table">
              <thead>
                <tr>
                  <th scope="col">View</th>
                  <th scope="col">Type</th>
                  <th scope="col">How it was drawn</th>
                  <th scope="col">State</th>
                </tr>
              </thead>
              <tbody>
                {view.figures.map((figure) => (
                  <tr key={figure.id} data-testid={`figure-row-${figure.figureNumber}`}>
                    <th scope="row">
                      FIG. {figure.figureNumber}
                      {figure.partialSuffix ?? ""}
                      {figure.isPriorArt ? " (Prior Art)" : ""}
                      <br />
                      <span className="hint">{figure.title}</span>
                    </th>
                    <td>{figure.viewType.replace(/_/g, " ")}</td>
                    <td>{figure.sourceKind.replace(/_/g, " ")}</td>
                    <td>{FIGURE_STATE_LABELS[figure.state] ?? figure.state}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="wp-card" style={{ marginBottom: 22 }}>
            <h2>Parts and reference numerals</h2>
            <p>
              Renaming a part here updates every view at once — the drawings store the
              numeral, never the label.
            </p>
            <ul className="wp-list">
              {view.numerals.map((entry) => (
                <li key={entry.id}>
                  <form action={renamePartAction} className="wp-inline-form">
                    <input type="hidden" name="inventionId" value={id} />
                    <input type="hidden" name="numeralId" value={entry.id} />
                    <label htmlFor={`part-${entry.id}`}>
                      <strong>{entry.numeral}</strong>
                    </label>
                    <input
                      id={`part-${entry.id}`}
                      name="partLabel"
                      defaultValue={entry.partLabel}
                      data-testid={`numeral-${entry.numeral}`}
                      aria-label={`Part name for reference character ${entry.numeral}`}
                    />
                    <button className="button" type="submit">
                      Rename
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </div>

          <div className="wp-card" style={{ marginBottom: 22 }} data-testid="validation-report">
            <h2>Formality checks</h2>
            <p data-testid="validation-disclaimer">
              These are mechanical formality checks against published formal drawing
              requirements. They are not a legal opinion and not a guarantee that the USPTO
              will accept these drawings — a qualified practitioner decides that.
            </p>
            <p>
              {passes.length} met · {failures.length} not met · {reviews.length} need a person
              to confirm.
            </p>
            {failures.length > 0 && (
              <ul className="wp-list" data-testid="validation-failures">
                {failures.map((entry) => (
                  <li key={entry.id}>
                    <strong>{entry.ruleId}</strong> — {entry.detail}
                  </li>
                ))}
              </ul>
            )}
            {reviews.length > 0 && (
              <details>
                <summary>{reviews.length} requirements a machine cannot decide</summary>
                <ul className="wp-list">
                  {reviews.map((entry) => (
                    <li key={entry.id}>
                      <strong>{entry.ruleId}</strong> — {entry.detail} (
                      {VALIDATION_STATUS_LABELS[entry.status]})
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          {briefDescription.length > 0 && (
            <div className="wp-card" style={{ marginBottom: 22 }}>
              <h2>Brief Description of the Drawings</h2>
              <p className="hint">
                Ready to drop into the draft. Working draft — counsel review required.
              </p>
              <pre data-testid="brief-description">{briefDescription.join("\n")}</pre>
            </div>
          )}

          <div className="wp-card">
            <h2>Accept this set</h2>
            <p>
              Accepting records that you reviewed these figures. It does not make them
              filing-ready and it is not counsel approval.
            </p>
            <form action={acceptFiguresAction}>
              <input type="hidden" name="inventionId" value={id} />
              <input type="hidden" name="figureSetId" value={view.set.id} />
              {failures.length > 0 && (
                <div className="field">
                  <label htmlFor="dismissalReason">
                    {failures.length} formality checks were not met. Record why you are
                    accepting anyway:
                  </label>
                  <input
                    id="dismissalReason"
                    name="dismissalReason"
                    required
                    data-testid="dismissal-reason"
                  />
                </div>
              )}
              <button className="button venture-button" type="submit" data-testid="accept-figures">
                Accept figures
              </button>
            </form>
            <form action={generateFiguresAction} style={{ marginTop: 12 }}>
              <input type="hidden" name="inventionId" value={id} />
              <button className="button" type="submit" data-testid="regenerate-figures">
                Regenerate figures
              </button>
            </form>
          </div>
        </>
      )}

      {query.accepted && <p className="hint">Figure set accepted.</p>}
      {query.renamed && <p className="hint">Part renamed across every view.</p>}
      {query.error && <p className="hint">Something went wrong: {query.error}.</p>}
    </>
  );
}
