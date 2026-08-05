/**
 * "Empty record" — the single predicate behind the Intake Studio's
 * first-run surface (Jeff's direction, 2026-08-04).
 *
 * A record with no content at all shows ONE drag-and-drop area
 * ("Upload Anything About the Invention") plus ONE button ("Start Guided
 * Questions About the Invention"), the record title field, and the
 * compliance banner — no panels, no cards, and no tab navigation. The
 * moment ANY of the signals below is non-zero the record is no longer
 * empty and the normal five-tab layout and Studio panels appear. The
 * transition is automatic: there is no "continue" step (app-wide
 * minimize-inputs design rule).
 *
 * Deliberately a pure function over counts so it can be unit-tested with
 * no adapters, and so both the layout (tab navigation) and the Studio page
 * decide emptiness from exactly the same rule.
 */

/**
 * The content signals. Any one of them being present means the record has
 * content. Order is documentation only.
 */
export const RECORD_CONTENT_SIGNALS = [
  "sources",
  "facts",
  "psPairs",
  "components",
  "drafts",
  "interviewSessions",
  "figureSets",
] as const;

export type RecordContentSignal = (typeof RECORD_CONTENT_SIGNALS)[number];

/** Counts of every content signal for one invention record. */
export type RecordContentCounts = Record<RecordContentSignal, number>;

/** All-zero counts — a record that has just been created. */
export function emptyRecordContentCounts(): RecordContentCounts {
  return {
    sources: 0,
    facts: 0,
    psPairs: 0,
    components: 0,
    drafts: 0,
    interviewSessions: 0,
    figureSets: 0,
  };
}

/**
 * True when the record holds no content whatsoever: no sources, no facts,
 * no Problem/Solution ledger entries, no components, no drafts, no
 * interview session, and no figures.
 *
 * Negative or non-finite counts are treated as absent rather than trusted,
 * so a broken caller can never *hide* content behind the empty state — it
 * can only fail towards showing the full workspace.
 */
export function isEmptyRecord(counts: RecordContentCounts): boolean {
  return presentRecordContentSignals(counts).length === 0;
}

/**
 * The signals that count as present. A count is absent only when it is a
 * real number at or below zero; anything unreadable (NaN, undefined) is
 * treated as present so a broken caller can never *hide* content behind
 * the empty state — it can only fail towards the full workspace.
 */
export function presentRecordContentSignals(
  counts: RecordContentCounts,
): RecordContentSignal[] {
  return RECORD_CONTENT_SIGNALS.filter((signal) => {
    const value = counts[signal];
    return !(Number.isFinite(value) && value <= 0);
  });
}
