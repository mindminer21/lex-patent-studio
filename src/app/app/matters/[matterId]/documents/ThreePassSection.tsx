import {
  DRAFT_PASS_PIPELINE,
  DRAFT_PASS_STATE_LABELS,
  draftPassProgress,
  type DeliveryBlocker,
} from "@/lib/shared/drafting";
import type { LexDraftSet } from "@/lib/domain/lex-draft-passes";
import { startDraftSetAction, acceptDraftSetAction } from "./actions";

/**
 * Lex's three-pass drafting surface.
 *
 * Same information architecture as wepatent's panel, because it is driven by
 * the same shared state machine and the same delivery gate — the differences
 * are Lex's: the work TIER is shown, the completed set enters the
 * practitioner review queue, and the acceptor is the responsible
 * practitioner rather than "a human".
 *
 * Minimal input: ONE control starts the whole flow; Pass 1 → figures → Pass 2
 * chains with no step in between. Accessibility: the stage meter is a
 * labelled ordered list with `aria-current`, blockers are an alert region,
 * and every control clears 44px.
 */
export function ThreePassSection({
  matterId,
  set,
  blockers,
  canDraft,
  canAccept,
}: {
  matterId: string;
  set: LexDraftSet | null;
  blockers: DeliveryBlocker[];
  canDraft: boolean;
  canAccept: boolean;
}) {
  if (!set) {
    return (
      <section
        className="mb-5 border border-[var(--line)] bg-[var(--white)] p-4"
        aria-labelledby="three-pass-heading"
        data-testid="lex-three-pass"
      >
        <h3
          id="three-pass-heading"
          className="m-0 mb-1 text-[1rem] font-medium"
          style={{ fontFamily: "Georgia, serif" }}
        >
          Three-pass specification drafting
        </h3>
        <p className="m-0 mb-3 text-[0.85rem] text-[var(--muted)]">
          The first pass drafts the specification together with an{" "}
          <strong>illustrations brief</strong> — the figure list, what each figure must show, and
          the reference numerals. The figures are built from that brief, then a second pass
          revises the draft against the figures actually produced and checks every numeral in
          both directions. Tier B — draft for review: the completed set enters your review queue,
          and nothing is delivered until you accept it.
        </p>
        {canDraft ? (
          <form action={startDraftSetAction}>
            <input type="hidden" name="matterId" value={matterId} />
            <button
              type="submit"
              className="min-h-[44px] border border-[var(--ink)] bg-[var(--ink)] px-4 text-[0.85rem] font-bold text-[var(--white)]"
              data-testid="lex-start-three-pass"
            >
              Start three-pass drafting
            </button>
          </form>
        ) : (
          <p className="m-0 text-[0.8rem] text-[var(--muted)]">
            Your seat cannot invoke Tier-B drafting workflows.
          </p>
        )}
      </section>
    );
  }

  const currentIndex = DRAFT_PASS_PIPELINE.indexOf(
    set.state as (typeof DRAFT_PASS_PIPELINE)[number],
  );
  const accepted = Boolean(set.acceptedAt);
  const onlyAcceptanceMissing = blockers.every(
    (blocker) => blocker.code === "not_accepted_by_human",
  );

  return (
    <section
      className="mb-5 border border-[var(--line)] bg-[var(--white)] p-4"
      aria-labelledby="three-pass-heading"
      data-testid="lex-three-pass"
    >
      <h3
        id="three-pass-heading"
        className="m-0 mb-1 text-[1rem] font-medium"
        style={{ fontFamily: "Georgia, serif" }}
      >
        Three-pass specification drafting — Tier {set.tier}
      </h3>
      <p className="m-0 mb-2 text-[0.85rem]" data-testid="lex-pass-state">
        <strong>{DRAFT_PASS_STATE_LABELS[set.state]}</strong> ·{" "}
        {Math.round(draftPassProgress(set.state) * 100)}% complete
      </p>

      <ol aria-label="Drafting progress" className="m-0 mb-3 list-none p-0 text-[0.82rem]">
        {DRAFT_PASS_PIPELINE.map((stage, index) => {
          const done = currentIndex > index || set.state === "READY_FOR_REVIEW";
          const current = set.state === stage;
          return (
            <li key={stage} aria-current={current ? "step" : undefined} className="py-0.5">
              <span aria-hidden="true">{done ? "✓" : current ? "▶" : "·"}</span>{" "}
              {DRAFT_PASS_STATE_LABELS[stage]}
              {done && <span className="sr-only"> (complete)</span>}
              {current && <span className="sr-only"> (current step)</span>}
            </li>
          );
        })}
      </ol>

      <p className="m-0 mb-3 text-[0.8rem] text-[var(--muted)]">
        Prose ↔ drawings reconciled:{" "}
        <strong data-testid="lex-reconciled">{set.reconciled ? "yes" : "not yet"}</strong>
        {set.reviewItemId && " · in the practitioner review queue"}
      </p>

      {set.statusDetail && (
        <div
          role="alert"
          className="mb-3 border-l-4 border-[#b9a76a] bg-[#f4ecd2] px-3 py-2 text-[0.82rem] text-[#5d4a12]"
          data-testid="lex-status-detail"
        >
          {set.statusDetail.split("\n").map((line) => (
            <p key={line} className="m-0">
              {line}
            </p>
          ))}
        </div>
      )}

      {!accepted && blockers.length > 0 && (
        <div role="alert" className="mb-3" data-testid="lex-delivery-blockers">
          <p className="m-0 mb-1 text-[0.82rem] font-bold">What is blocking delivery</p>
          <ul className="m-0 list-disc space-y-1 pl-5 text-[0.82rem]">
            {blockers.map((blocker) => (
              <li key={blocker.code}>
                <strong>{blocker.message}</strong> {blocker.needs}
              </li>
            ))}
          </ul>
        </div>
      )}

      {accepted ? (
        <p className="m-0 text-[0.82rem]" data-testid="lex-accepted">
          Accepted by the responsible practitioner on{" "}
          {new Date(set.acceptedAt!).toLocaleString()}. This remains a Tier-B draft for review.
        </p>
      ) : (
        canAccept && (
          <form action={acceptDraftSetAction}>
            <input type="hidden" name="matterId" value={matterId} />
            <input type="hidden" name="draftSetId" value={set.id} />
            <button
              type="submit"
              disabled={!onlyAcceptanceMissing}
              aria-describedby={onlyAcceptanceMissing ? undefined : "lex-accept-blocked"}
              className="min-h-[44px] border border-[var(--ink)] px-4 text-[0.85rem] font-bold disabled:opacity-50"
              data-testid="lex-accept-draft-set"
            >
              Accept into review queue
            </button>
            {!onlyAcceptanceMissing && (
              <p id="lex-accept-blocked" className="m-0 mt-1 text-[0.78rem] text-[var(--muted)]">
                You cannot accept yet: {blockers[0]?.needs}
              </p>
            )}
          </form>
        )
      )}
    </section>
  );
}
