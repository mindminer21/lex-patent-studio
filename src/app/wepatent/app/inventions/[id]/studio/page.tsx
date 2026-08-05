import { notFound } from "next/navigation";
import StudioJobProgress from "@/components/wepatent/StudioJobProgress";
import UploadForm from "@/components/wepatent/UploadForm";
import { UploadStatusProvider } from "@/components/wepatent/UploadStatusProvider";
import WorkingTitleField from "@/components/wepatent/WorkingTitleField";
import {
  COVERAGE_DIMENSION_LABELS,
  COVERAGE_DIMENSIONS,
} from "@/lib/wepatent/domain/coverage";
import { getAdapters } from "@/lib/server/adapters";
import type { WorkingTitleRecord } from "@/lib/server/adapters/types";
import { getModelTier } from "@/lib/server/model-registry";
import { estimateForTier } from "@/lib/server/services/generation";
import { estimateDistillation } from "@/lib/server/services/distillation";
import { getLedger } from "@/lib/server/services/ps-ledger";
import {
  formatMultiplier,
  markupDisclosure,
  MARKUP_MULTIPLIERS,
} from "@/lib/shared/billing/markup";
import { isEmptyRecord } from "@/lib/wepatent/domain/record-emptiness";
import { loadRecordContentCounts } from "@/lib/server/services/record-emptiness";
import { requireOnboarded } from "@/lib/server/session";
import Link from "next/link";
import { interpretationClassFor } from "@/lib/wepatent/domain/uploads";
import {
  addPairAction,
  bulkReviewAction,
  confirmPairAction,
  deletePairAction,
  distillAction,
  editPairAction,
  interpretSourcesAction,
  linkPairsAction,
  mergePairsAction,
  splitPairAction,
} from "./actions";

function centsToUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

const STATE_LABELS: Record<string, string> = {
  ai_proposed: "AI proposed — awaiting your review",
  user_confirmed: "Confirmed by you",
  user_edited: "Edited by you",
};

/**
 * First-run Studio surface for a record with NO content (Jeff's direction,
 * 2026-08-04): "there should be a single drag and drop area with the prompt
 * to 'Upload Anything About the Invention'. there should be no other tabs,
 * or other boxes, until information is included - except one button that
 * says 'Start Guided Questions About the Invention'".
 *
 * So exactly four things render, and nothing else:
 *  1. the compliance banner — REQUIRED, never hidden (legal invariant 4);
 *  2. the record title — the existing auto-saving working-title field,
 *     which is how a record gets named (one field, not a box);
 *  3. one large drag-and-drop upload area running the same FR-4 pipeline
 *     as the workspace control, with the auto-derived kind and no
 *     Kind/Note prompt;
 *  4. one button into the guided questions.
 *
 * No Sources/Components/Ledger/Coverage cards, and the layout renders no
 * tab navigation for the same records. The full workspace returns
 * automatically on the first piece of content — there is no confirm step.
 */
function EmptyRecordStudio({
  inventionId,
  title,
}: {
  inventionId: string;
  title: WorkingTitleRecord | null;
}) {
  return (
    <div className="wp-first-run">
      <div className="wp-boundary-banner">
        Working draft — counsel review required. wepatent is not a law firm and does not give
        legal advice. Uploaded files are treated as evidence, never as instructions, and every
        AI output is a labeled proposal (&ldquo;AI proposed&rdquo;) until you confirm, edit, or
        delete it.
      </div>

      <div style={{ marginBottom: 22 }}>
        {/* Naming the record does NOT make it non-empty (a title is not
            content), so the field has to render whatever was already
            saved — otherwise a name typed here vanishes on reload. */}
        <WorkingTitleField
          inventionId={inventionId}
          initialText={title?.text ?? ""}
          initialState={title?.state ?? null}
        />
      </div>

      <UploadForm inventionId={inventionId} variant="dropzone" />

      <div className="wp-first-run-actions">
        <a
          className="button venture-button"
          href={`/wepatent/app/inventions/${inventionId}/interview`}
        >
          Start Guided Questions About the Invention
        </a>
      </div>
    </div>
  );
}

/**
 * Intake Studio (feature PRD §4.2): three-region workspace.
 * Left — sources & components. Center — upload / interpret / distill.
 * Right — always-visible Problem/Solution ledger with working title and
 * the deterministic coverage meter.
 */
export default async function StudioPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ job?: string; error?: string }>;
}) {
  const { id } = await params;
  const { job, error } = await searchParams;
  const context = await requireOnboarded();
  const { data } = getAdapters();
  const invention = await data.getInvention(context.organization.id, id);
  if (!invention) notFound();

  // First-run surface (Jeff's direction, 2026-08-04). While the record holds
  // NOTHING — no sources, facts, ledger entries, components, drafts,
  // interview session, or figures — the Studio is one upload area and one
  // button. The layout hides the tab navigation for the same records, and
  // both decisions come from the same predicate.
  const counts = await loadRecordContentCounts(context.organization.id, id);
  if (isEmptyRecord(counts)) {
    const titles = await data.listWorkingTitles(context.organization.id, id);
    // NOTE: both branches return `UploadStatusProvider` at the SAME root
    // position, so the upload confirmation survives the automatic swap
    // from the first-run surface to the full workspace.
    return (
      <UploadStatusProvider>
        <EmptyRecordStudio inventionId={id} title={titles[titles.length - 1] ?? null} />
      </UploadStatusProvider>
    );
  }

  const [sources, ledger, wallet, events, distillEstimate] = await Promise.all([
    data.listSources(context.organization.id, id),
    getLedger(context.organization.id, id),
    data.getWallet(context.organization.id),
    data.listPsEvents(context.organization.id, id),
    estimateDistillation(context.organization.id, id),
  ]);
  const availableCents = wallet ? wallet.balanceCents - wallet.reservedCents : 0;

  const interpretable = sources.filter(
    (source) =>
      (source.status === "scanned" || source.status === "extracted") &&
      source.interpretationStatus !== "interpreted",
  );
  const interpretTier = getModelTier("standard");
  const interpretEstimate = interpretTier
    ? estimateForTier(interpretTier, 2_000)
    : null;
  const interpretHighTotal = interpretEstimate
    ? interpretEstimate.customerHighCents * Math.max(1, interpretable.length)
    : 0;

  const problems = ledger.pairs.filter((pair) => pair.kind === "problem");
  const solutions = ledger.pairs.filter((pair) => pair.kind === "solution");
  const observations = events.filter((event) => event.detail.startsWith("observation: "));
  const componentById = new Map(ledger.components.map((component) => [component.id, component]));
  // M3 re-distillation diff review: current unreviewed proposals vs the
  // reviewed ledger, with per-item and bulk accept/reject.
  const proposedPairs = ledger.pairs.filter((pair) => pair.state === "ai_proposed");
  const reviewedPairs = ledger.pairs.filter((pair) => pair.state !== "ai_proposed");
  const hasPriorDistillation = events.some((event) => event.kind === "title_proposed");

  return (
    <UploadStatusProvider>
      <div className="wp-boundary-banner">
        Working draft — counsel review required. Every AI output below is a labeled proposal
        (&ldquo;AI proposed&rdquo;) until you confirm, edit, or delete it. Uploaded files are
        treated as evidence, never as instructions.
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error === "nothing_to_interpret"
            ? "There are no uploads awaiting interpretation. Files must clear the scan pipeline first."
            : "That action could not be completed. Check the input and try again."}
        </p>
      )}
      {job && (
        <StudioJobProgress jobId={job} refreshPath={`/wepatent/app/inventions/${id}/studio`} />
      )}

      <div className="wp-studio">
        {/* ------------------- Left: sources & components ------------------- */}
        <section className="wp-studio-left" aria-label="Sources and components">
          <div className="wp-card">
            <h2>Sources ({sources.length})</h2>
            {sources.length === 0 ? (
              <p>No files yet. Upload documents or images to get started.</p>
            ) : (
              <ul className="wp-studio-list">
                {sources.map((source) => {
                  const cleared =
                    source.status === "scanned" || source.status === "extracted";
                  const sourceClass = interpretationClassFor(
                    source.mimeType,
                    source.originalFilename ?? source.name,
                  );
                  const filename = (source.originalFilename ?? source.name).toLowerCase();
                  const viewable =
                    cleared &&
                    (sourceClass === "image" ||
                      sourceClass === "document" ||
                      sourceClass === "audio" ||
                      sourceClass === "video" ||
                      (sourceClass === "model3d" &&
                        (filename.endsWith(".stl") || filename.endsWith(".obj"))));
                  return (
                    <li key={source.id}>
                      <strong>{source.name}</strong>
                      <br />
                      <span className="wp-badge neutral">{source.status}</span>{" "}
                      {source.interpretationStatus === "interpreted" && (
                        <span className="wp-badge source_supported">interpreted</span>
                      )}
                      {source.interpretationStatus === "stored_uninterpreted" && (
                        <span className="wp-badge needs_confirmation">
                          stored, not auto-interpreted
                        </span>
                      )}
                      {source.derivedFromSourceId && (
                        <span className="wp-badge neutral">derived 3D view</span>
                      )}
                      {viewable && (
                        <>
                          {" "}
                          <Link
                            href={`/wepatent/app/inventions/${id}/sources/${source.id}/view`}
                          >
                            {sourceClass === "model3d"
                              ? "Open 3D viewer"
                              : "Open viewer / draw regions"}
                          </Link>
                        </>
                      )}
                      {source.status === "rejected" && source.quarantineReason && (
                        <span className="hint" style={{ display: "block" }}>
                          {source.quarantineReason}
                        </span>
                      )}
                      {source.interpretationStatus === "stored_uninterpreted" && (
                        <span className="hint" style={{ display: "block" }}>
                          Stored for the counsel package. Please describe its contents as facts
                          in your record.
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {/* The Sources tab was removed from the record navigation; the
                sources panel is its contextual home. Route unchanged. */}
            <p className="hint" style={{ marginTop: 12 }}>
              <Link href={`/wepatent/app/inventions/${id}/sources`}>
                Full source list and extraction status →
              </Link>
            </p>
          </div>
          <div className="wp-card" style={{ marginTop: 18 }}>
            <h2>Components ({ledger.components.length})</h2>
            {ledger.components.length === 0 ? (
              <p>Component candidates extracted from your files will appear here.</p>
            ) : (
              <ul className="wp-studio-list">
                {ledger.components.map((component) => (
                  <li key={component.id}>
                    <strong>{component.name}</strong>{" "}
                    <span className={`wp-badge ${component.state === "ai_proposed" ? "needs_confirmation" : "source_supported"}`}>
                      {component.state === "ai_proposed" ? "AI proposed" : "reviewed"}
                    </span>
                    {component.description && (
                      <span className="hint" style={{ display: "block" }}>
                        {component.description}
                      </span>
                    )}
                    {component.sourceAnchors.length > 0 && (
                      <span className="hint" style={{ display: "block" }}>
                        Evidence: {component.sourceAnchors.filter((a) => a.startsWith("source:")).join(", ")}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* ---------------------- Center: work surface ---------------------- */}
        <section className="wp-studio-center" aria-label="Upload and interpretation">
          <div className="wp-card">
            <h2>Upload anything</h2>
            <p>
              Documents (PDF, DOCX, PPTX, XLSX, TXT/MD, SVG), images (PNG, JPEG, TIFF, HEIC),
              3D models (STL, STEP, OBJ, 3MF), audio (MP3, WAV, M4A), and video (MP4, MOV).
              Every file passes type validation, quarantine, and a scan before anything reads
              it. STL models that parse cleanly get a deterministic geometry summary (computed
              by code, no AI), and STL/OBJ open in the browser 3D viewer for snapshot capture;
              audio is transcribed through the server-side gateway (cost shown before the
              run); video is stored for counsel with an honest &ldquo;interpretation not yet
              available&rdquo; status and a prompt to describe it — never a fake
              interpretation.
            </p>
            <UploadForm inventionId={id} />
          </div>

          <div className="wp-card" style={{ marginTop: 18 }}>
            <h2>Interpret uploads</h2>
            <p>
              Runs an AI interpretation pass over each scanned file ({interpretable.length}{" "}
              awaiting). Estimated cost:{" "}
              <strong>
                up to {centsToUsd(interpretHighTotal)}
              </strong>{" "}
              total · wallet available {centsToUsd(availableCents)}. Charges are{" "}
              {markupDisclosure()}; interpretation reads a source you already have rather than
              authoring anything, so it is an analysis task and bills at{" "}
              {formatMultiplier(MARKUP_MULTIPLIERS.analysis)}×. Settled from actual usage.
            </p>
            <form action={interpretSourcesAction}>
              <input type="hidden" name="inventionId" value={id} />
              <button
                className="button venture-button"
                type="submit"
                disabled={interpretable.length === 0}
              >
                Interpret {interpretable.length > 0 ? `${interpretable.length} file(s)` : "uploads"}
              </button>
            </form>
          </div>

          <div className="wp-card" style={{ marginTop: 18 }}>
            <h2>Adaptive interview</h2>
            <p>
              Answer Slusky-guided questions — general to specific — that target exactly the
              coverage gaps shown on the right. Answers accept file attachments, skips are
              recorded honestly, and the ledger fills in live as you talk.
            </p>
            <p>
              <a
                className="button venture-button"
                href={`/wepatent/app/inventions/${id}/interview`}
              >
                Open the interview
              </a>
            </p>
          </div>

          <div className="wp-card" style={{ marginTop: 18 }}>
            <h2>{hasPriorDistillation ? "Re-distill with new material" : "Distill into the ledger"}</h2>
            <p>
              Synthesizes a working title, problems, solutions, and pairings across everything
              interpreted so far ({distillEstimate?.artifactCount ?? 0} interpreted artifact(s) +
              your recorded facts). Everything lands as an <strong>AI proposal</strong> for your
              review. Re-run anytime after adding material — your confirmed and edited items are
              never overwritten.
            </p>
            {distillEstimate && (
              <p>
                Estimated cost:{" "}
                <strong>
                  {centsToUsd(distillEstimate.estimate.customerLowCents)}–
                  {centsToUsd(distillEstimate.estimate.customerHighCents)}
                </strong>{" "}
                · wallet available {centsToUsd(availableCents)}
                {availableCents < distillEstimate.estimate.customerHighCents && (
                  <strong> — insufficient; the run will not start.</strong>
                )}
              </p>
            )}
            <form action={distillAction}>
              <input type="hidden" name="inventionId" value={id} />
              <input type="hidden" name="idempotencyKey" value={crypto.randomUUID()} />
              <button className="button venture-button" type="submit">
                {hasPriorDistillation ? "Re-distill with new material" : "Distill with AI"}
              </button>
            </form>
          </div>

          {proposedPairs.length > 0 && (
            <div className="wp-card" style={{ marginTop: 18 }} data-testid="proposal-review">
              <h2>Review AI proposals ({proposedPairs.length} new)</h2>
              <p className="hint">
                Diff-style review: these proposals are NOT part of your reviewed ledger
                until you accept them. Your {reviewedPairs.length} confirmed/edited item(s)
                were never touched by the re-distillation — AI only adds proposals. Accept
                or reject each item in the ledger panel, or act on all of them at once:
              </p>
              <ul className="wp-studio-list">
                {proposedPairs.map((pair) => (
                  <li key={pair.id}>
                    <span className="wp-badge neutral">{pair.kind}</span>{" "}
                    <span className="wp-badge needs_confirmation">proposed</span>{" "}
                    {pair.statement.slice(0, 160)}
                  </li>
                ))}
              </ul>
              <div className="wp-actions" style={{ marginTop: 10 }}>
                <form action={bulkReviewAction}>
                  <input type="hidden" name="inventionId" value={id} />
                  <input type="hidden" name="action" value="confirm" />
                  <button className="button venture-button button-small" type="submit">
                    Accept all proposals
                  </button>
                </form>
                <form action={bulkReviewAction}>
                  <input type="hidden" name="inventionId" value={id} />
                  <input type="hidden" name="action" value="reject" />
                  <button className="button button-small" type="submit">
                    Reject all proposals
                  </button>
                </form>
              </div>
            </div>
          )}

          {observations.length > 0 && (
            <div className="wp-card" style={{ marginTop: 18 }}>
              <h2>Model observations</h2>
              <p className="hint">
                Observations about the record&rsquo;s contents — proposals only, never filing
                advice. Counsel decides what matters.
              </p>
              <ul>
                {observations.map((event) => (
                  <li key={event.id}>{event.detail.replace(/^observation: /, "")}</li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* ------------- Right: always-visible P/S ledger panel ------------- */}
        <section className="wp-studio-right" aria-label="Problem/Solution ledger">
          <div className="wp-card">
            {/* Design rule (minimal human input): the working title is an
                inline auto-saving field — no Save button. Blurring an
                untouched AI proposal accepts it; edits save on debounce/blur
                with user_edited provenance. */}
            <WorkingTitleField
              inventionId={id}
              initialText={ledger.currentTitle?.text ?? ""}
              initialState={ledger.currentTitle?.state ?? null}
            />
          </div>

          <div className="wp-card" style={{ marginTop: 18 }} data-testid="coverage-meter">
            <p className="venture-kicker">Enablement coverage of this record</p>
            <h2>
              {ledger.coverage.aggregate.satisfied} of {ledger.coverage.aggregate.total} checks
            </h2>
            <p className="hint">
              Deterministic checklist ({ledger.coverage.version}) over your recorded material —
              computed by code, never by a model. It measures record coverage, not legal
              sufficiency; counsel assesses enablement.
            </p>
            {ledger.coverage.perSolution.map((coverage, index) => (
              <div key={coverage.solutionId} style={{ marginBottom: 10 }}>
                <strong>
                  Solution {index + 1}: {coverage.satisfiedCount}/{coverage.totalCount}
                </strong>
                <ul className="wp-studio-list">
                  {COVERAGE_DIMENSIONS.filter(
                    (dimension) => coverage.dimensions[dimension].status === "gap",
                  ).map((dimension) => (
                    <li key={dimension} className="hint">
                      Gap: {COVERAGE_DIMENSION_LABELS[dimension]} — the interview targets this,
                      or{" "}
                      {/* The Facts tab was removed from the record
                          navigation; this is where a gap is actually acted
                          on. Route unchanged. */}
                      <Link href={`/wepatent/app/inventions/${id}/facts`}>
                        add it as a fact now
                      </Link>
                      .
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {ledger.coverage.perSolution.length === 0 && (
              <p>No solutions in the ledger yet.</p>
            )}
          </div>

          <div className="wp-card" style={{ marginTop: 18 }} data-testid="ps-ledger">
            <p className="venture-kicker">Problem/Solution ledger</p>
            <h2>
              {problems.length} problem(s) · {solutions.length} solution(s)
            </h2>
            {ledger.pairs.map((pair) => (
              <div key={pair.id} className="wp-studio-pair" data-testid={`ps-pair-${pair.kind}`}>
                <p style={{ marginBottom: 4 }}>
                  <span className="wp-badge neutral">{pair.kind}</span>{" "}
                  <span
                    className={`wp-badge ${pair.state === "ai_proposed" ? "needs_confirmation" : "source_supported"}`}
                  >
                    {STATE_LABELS[pair.state]}
                  </span>
                </p>
                <p style={{ marginTop: 0 }}>{pair.statement}</p>
                {pair.sourceAnchors.length > 0 && (
                  <p className="hint">Evidence: {pair.sourceAnchors.join(" · ")}</p>
                )}
                {pair.kind === "solution" && (
                  <p className="hint">
                    Components:{" "}
                    {ledger.associations
                      .filter((association) => association.solutionId === pair.id)
                      .map((association) =>
                        association.componentId
                          ? componentById.get(association.componentId)?.name
                          : null,
                      )
                      .filter(Boolean)
                      .join(", ") || "none linked yet"}
                    {" · "}
                    {
                      ledger.associations.filter(
                        (association) =>
                          association.solutionId === pair.id && association.region !== null,
                      ).length
                    }{" "}
                    region anchor(s) ·{" "}
                    <Link href={`/wepatent/app/inventions/${id}/solutions/${pair.id}`}>
                      Evidence gallery
                    </Link>
                  </p>
                )}
                <div className="wp-actions">
                  {pair.state === "ai_proposed" && (
                    <form action={confirmPairAction}>
                      <input type="hidden" name="inventionId" value={id} />
                      <input type="hidden" name="pairId" value={pair.id} />
                      <button className="button button-small" type="submit">
                        Confirm
                      </button>
                    </form>
                  )}
                  <details>
                    <summary>Edit</summary>
                    <form action={editPairAction} className="wp-form">
                      <input type="hidden" name="inventionId" value={id} />
                      <input type="hidden" name="pairId" value={pair.id} />
                      <div className="field">
                        <label htmlFor={`edit-${pair.id}`}>Statement</label>
                        <textarea
                          id={`edit-${pair.id}`}
                          name="statement"
                          required
                          minLength={3}
                          maxLength={4000}
                          rows={3}
                          defaultValue={pair.statement}
                        />
                      </div>
                      <button className="button button-small" type="submit">
                        Save edit
                      </button>
                    </form>
                  </details>
                  <details>
                    <summary>Split</summary>
                    <form action={splitPairAction} className="wp-form">
                      <input type="hidden" name="inventionId" value={id} />
                      <input type="hidden" name="pairId" value={pair.id} />
                      <div className="field">
                        <label htmlFor={`split-${pair.id}`}>
                          One statement per line (2–5 lines); the first replaces this item
                        </label>
                        <textarea
                          id={`split-${pair.id}`}
                          name="statements"
                          required
                          rows={3}
                          defaultValue={pair.statement}
                        />
                      </div>
                      <button className="button button-small" type="submit">
                        Split into separate items
                      </button>
                    </form>
                  </details>
                  {ledger.pairs.filter(
                    (candidate) => candidate.kind === pair.kind && candidate.id !== pair.id,
                  ).length > 0 && (
                    <details>
                      <summary>Merge</summary>
                      <form action={mergePairsAction} className="wp-form">
                        <input type="hidden" name="inventionId" value={id} />
                        <input type="hidden" name="primaryId" value={pair.id} />
                        <div className="field">
                          <label htmlFor={`merge-${pair.id}`}>
                            Absorb this {pair.kind} into the item above (its links and
                            evidence move over)
                          </label>
                          <select id={`merge-${pair.id}`} name="secondaryId">
                            {ledger.pairs
                              .filter(
                                (candidate) =>
                                  candidate.kind === pair.kind && candidate.id !== pair.id,
                              )
                              .map((candidate) => (
                                <option key={candidate.id} value={candidate.id}>
                                  {candidate.statement.slice(0, 80)}
                                </option>
                              ))}
                          </select>
                        </div>
                        <button className="button button-small" type="submit">
                          Merge
                        </button>
                      </form>
                    </details>
                  )}
                  <form action={deletePairAction}>
                    <input type="hidden" name="inventionId" value={id} />
                    <input type="hidden" name="pairId" value={pair.id} />
                    <button className="button button-small" type="submit">
                      {pair.state === "ai_proposed" ? "Reject" : "Delete"}
                    </button>
                  </form>
                </div>
              </div>
            ))}
            {ledger.pairs.length === 0 && (
              <p>
                Nothing yet. Upload files and distill, or add problems and solutions manually
                below.
              </p>
            )}

            <details style={{ marginTop: 12 }}>
              <summary>Add a problem or solution manually</summary>
              <form action={addPairAction} className="wp-form">
                <input type="hidden" name="inventionId" value={id} />
                <div className="field">
                  <label htmlFor="pair-kind">Kind</label>
                  <select id="pair-kind" name="kind" defaultValue="problem">
                    <option value="problem">Problem</option>
                    <option value="solution">Solution</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="pair-statement">Statement</label>
                  <textarea
                    id="pair-statement"
                    name="statement"
                    required
                    minLength={3}
                    maxLength={4000}
                    rows={3}
                  />
                </div>
                <button className="button venture-button button-small" type="submit">
                  Add to ledger
                </button>
              </form>
            </details>

            {problems.length > 0 && solutions.length > 0 && (
              <details style={{ marginTop: 12 }}>
                <summary>Pair a problem with a solution</summary>
                <form action={linkPairsAction} className="wp-form">
                  <input type="hidden" name="inventionId" value={id} />
                  <div className="field">
                    <label htmlFor="link-problem">Problem</label>
                    <select id="link-problem" name="problemId">
                      {problems.map((problem) => (
                        <option key={problem.id} value={problem.id}>
                          {problem.statement.slice(0, 80)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="link-solution">Solution</label>
                    <select id="link-solution" name="solutionId">
                      {solutions.map((solution) => (
                        <option key={solution.id} value={solution.id}>
                          {solution.statement.slice(0, 80)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button className="button venture-button button-small" type="submit">
                    Pair them
                  </button>
                </form>
              </details>
            )}
          </div>
        </section>
      </div>
    </UploadStatusProvider>
  );
}
