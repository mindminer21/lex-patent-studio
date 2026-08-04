import {
  DRAFT_PASS_PIPELINE,
  DRAFT_PASS_STATE_LABELS,
  draftPassProgress,
  type DeliveryBlocker,
  type DraftPassState,
} from "@/lib/shared/drafting";

/**
 * The three-pass drafting surface (Jeff's directive, 2026-08-04).
 *
 * Design rules this component exists to satisfy:
 *
 * - MINIMAL HUMAN INPUT (intake-studio PRD §15). There is exactly ONE
 *   control to start the whole flow and exactly one to accept the result.
 *   Everything between Pass 1 and Pass 2 chains automatically; the user is
 *   never asked to press "now make the figures" or "now revise".
 * - SAY WHAT IS BLOCKING. When the set cannot be delivered the panel lists
 *   every blocker with what it needs, verbatim from the shared delivery
 *   gate. "Not ready" is never shown on its own.
 * - The accept control is DISABLED, with the reason visible, until the gate
 *   would actually open. A person accepting is the only way a package
 *   becomes deliverable, so that control must never be a lie.
 *
 * Accessibility: the stage meter is a labelled `ol` with the current step
 * carried by `aria-current`, not by colour; the blockers are an `alert`
 * region so a screen reader is told when the run stops; every control has a
 * ≥44px target.
 */

export type ThreePassView = {
  draftSetId: string;
  state: DraftPassState;
  statusDetail: string;
  passOneVersionId: string | null;
  passTwoVersionId: string | null;
  figureCount: number;
  numeralCount: number;
  reconciled: boolean;
  reconciliationFindings: string[];
  passOneChargeCents: number;
  passTwoChargeCents: number;
  acceptedAt: string | null;
  blockers: DeliveryBlocker[];
};

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function ThreePassPanel({
  inventionId,
  view,
  estimateHighCents,
  startAction,
  acceptAction,
}: {
  inventionId: string;
  view: ThreePassView | null;
  estimateHighCents: number;
  startAction: (formData: FormData) => void | Promise<void>;
  acceptAction: (formData: FormData) => void | Promise<void>;
}) {
  if (!view) {
    return (
      <div className="wp-card" data-testid="three-pass-panel" style={{ marginBottom: 22 }}>
        <p className="venture-kicker">Patent application drafting</p>
        <h2>Draft the application in three passes</h2>
        <p>
          One step starts the whole flow. The first pass writes the draft together with an{" "}
          <strong>illustrations brief</strong> — the figure list, what each figure must show, and
          the reference numerals. The figures are then built from that brief automatically, and a
          second pass revises the draft against the figures actually produced, checking every
          numeral in both directions before anything can be delivered.
        </p>
        <p className="hint">
          Estimated cost per pass: up to <strong>{usd(estimateHighCents)}</strong>. Each pass is
          metered and reserved separately, so a cap can pause the run between passes without
          losing work you have already paid for. Nothing is delivered until you accept.
        </p>
        <form action={startAction}>
          <input type="hidden" name="inventionId" value={inventionId} />
          <input type="hidden" name="tierId" value="standard" />
          <button
            className="button venture-button"
            type="submit"
            style={{ minHeight: 44 }}
            data-testid="start-three-pass"
          >
            Start three-pass drafting
          </button>
        </form>
      </div>
    );
  }

  const currentIndex = DRAFT_PASS_PIPELINE.indexOf(
    view.state as (typeof DRAFT_PASS_PIPELINE)[number],
  );
  const canAccept = view.blockers.every((blocker) => blocker.code === "not_accepted_by_human");
  const accepted = Boolean(view.acceptedAt);

  return (
    <div className="wp-card" data-testid="three-pass-panel" style={{ marginBottom: 22 }}>
      <p className="venture-kicker">Patent application drafting — three passes</p>
      <h2 data-testid="three-pass-state">{DRAFT_PASS_STATE_LABELS[view.state]}</h2>

      <ol
        aria-label="Drafting progress"
        style={{ listStyle: "none", padding: 0, margin: "12px 0" }}
        data-testid="three-pass-stages"
      >
        {DRAFT_PASS_PIPELINE.map((stage, index) => {
          const done = currentIndex > index || view.state === "READY_FOR_REVIEW";
          const current = view.state === stage;
          return (
            <li
              key={stage}
              aria-current={current ? "step" : undefined}
              style={{ padding: "4px 0" }}
            >
              <span aria-hidden="true">{done ? "✓" : current ? "▶" : "·"}</span>{" "}
              <span>{DRAFT_PASS_STATE_LABELS[stage]}</span>
              {done && <span className="sr-only"> (complete)</span>}
              {current && <span className="sr-only"> (current step)</span>}
            </li>
          );
        })}
      </ol>
      <p className="hint">
        Progress: {Math.round(draftPassProgress(view.state) * 100)}%. Figures produced:{" "}
        {view.figureCount}. Reference numerals in the shared registry: {view.numeralCount}.
      </p>

      <div className="wp-draft-meta">
        <span>Pass 1 charge: {usd(view.passOneChargeCents)}</span>
        <span>Pass 2 charge: {usd(view.passTwoChargeCents)}</span>
        <span>
          Prose ↔ drawings reconciled:{" "}
          <strong data-testid="reconciled-flag">{view.reconciled ? "yes" : "not yet"}</strong>
        </span>
      </div>

      {view.reconciliationFindings.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <h3>Flagged for you — we do not change your draft</h3>
          <p className="hint">
            The description and the drawings disagree on the following. Each is reported, never
            silently corrected.
          </p>
          <ul data-testid="reconciliation-findings">
            {view.reconciliationFindings.map((finding) => (
              <li key={finding}>{finding}</li>
            ))}
          </ul>
        </div>
      )}

      {!accepted && view.blockers.length > 0 && (
        <div role="alert" style={{ marginTop: 14 }} data-testid="delivery-blockers">
          <h3>What is blocking delivery</h3>
          <ul>
            {view.blockers.map((blocker) => (
              <li key={blocker.code}>
                <strong>{blocker.message}</strong> {blocker.needs}
              </li>
            ))}
          </ul>
        </div>
      )}

      {accepted ? (
        <p data-testid="accepted-notice" style={{ marginTop: 14 }}>
          Accepted for delivery on {new Date(view.acceptedAt!).toLocaleString()}. The counsel
          package can now be exported. This remains a working draft requiring counsel review.
        </p>
      ) : (
        <form action={acceptAction} style={{ marginTop: 14 }}>
          <input type="hidden" name="inventionId" value={inventionId} />
          <input type="hidden" name="draftSetId" value={view.draftSetId} />
          <button
            className="button venture-button"
            type="submit"
            disabled={!canAccept}
            aria-describedby={canAccept ? undefined : "accept-blocked-reason"}
            style={{ minHeight: 44 }}
            data-testid="accept-draft-set"
          >
            Accept for counsel package
          </button>
          {!canAccept && (
            <p id="accept-blocked-reason" className="hint">
              You cannot accept yet: {view.blockers[0]?.needs}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
