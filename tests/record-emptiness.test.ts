import { describe, expect, it } from "vitest";
import {
  emptyRecordContentCounts,
  isEmptyRecord,
  presentRecordContentSignals,
  RECORD_CONTENT_SIGNALS,
  type RecordContentCounts,
  type RecordContentSignal,
} from "@/lib/wepatent/domain/record-emptiness";

/**
 * The Studio first-run surface (Jeff's direction, 2026-08-04) hangs off a
 * single predicate. Pin it: an all-zero record is empty, ANY one signal
 * flips it to non-empty, and the signal list itself is fixed so silently
 * dropping one (which would hide a user's content behind the empty state)
 * fails here rather than in production.
 */

describe("record emptiness signals", () => {
  it("covers exactly the seven agreed content signals", () => {
    expect([...RECORD_CONTENT_SIGNALS].sort()).toEqual(
      [
        "components",
        "drafts",
        "facts",
        "figureSets",
        "interviewSessions",
        "psPairs",
        "sources",
      ].sort(),
    );
  });

  it("a freshly created record is empty", () => {
    const counts = emptyRecordContentCounts();
    expect(isEmptyRecord(counts)).toBe(true);
    expect(presentRecordContentSignals(counts)).toEqual([]);
  });
});

describe("isEmptyRecord", () => {
  for (const signal of RECORD_CONTENT_SIGNALS) {
    it(`is NOT empty when only \`${signal}\` is present`, () => {
      const counts: RecordContentCounts = { ...emptyRecordContentCounts(), [signal]: 1 };
      expect(isEmptyRecord(counts)).toBe(false);
      expect(presentRecordContentSignals(counts)).toEqual([signal]);
    });
  }

  it("is not empty when several signals are present", () => {
    const counts: RecordContentCounts = {
      ...emptyRecordContentCounts(),
      sources: 3,
      psPairs: 2,
      figureSets: 1,
    };
    expect(isEmptyRecord(counts)).toBe(false);
    expect(presentRecordContentSignals(counts)).toEqual(["sources", "psPairs", "figureSets"]);
  });

  it("treats zero and negative counts as absent", () => {
    expect(isEmptyRecord({ ...emptyRecordContentCounts(), facts: 0 })).toBe(true);
    expect(isEmptyRecord({ ...emptyRecordContentCounts(), facts: -1 })).toBe(true);
  });

  it("fails towards the full workspace when a count is unreadable", () => {
    // A broken caller must never be able to HIDE content behind the empty
    // state; NaN/undefined therefore read as "present", not "absent".
    expect(isEmptyRecord({ ...emptyRecordContentCounts(), drafts: Number.NaN })).toBe(false);
    const missing = { ...emptyRecordContentCounts() } as Record<RecordContentSignal, number>;
    delete (missing as Partial<RecordContentCounts>).sources;
    expect(isEmptyRecord(missing as RecordContentCounts)).toBe(false);
  });
});
