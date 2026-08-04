/**
 * The shared reference-numeral registry.
 *
 * This is the mechanism that makes 37 CFR 1.84(p)(4) — "the same part of an
 * invention appearing in more than one view must always be designated by the
 * same reference character, and the same reference character must never be
 * used to designate different parts" — a MECHANICAL guarantee rather than a
 * hope. One registry per figure set; every view draws from it; renaming a
 * part updates every view at once because the views only ever store the
 * numeral, never the label.
 */
import type { NumeralEntry } from "./types";

/**
 * MPEP 608.02 practice: begin at 10 (or 100) and step by 2, leaving odd
 * numbers free for later insertions. Suffix letters (16A, 16B) cover parts
 * that must be interleaved after numbering is fixed. Primed numbers (10')
 * are discouraged and this module never emits them.
 */
export const NUMERAL_START = 10;
export const NUMERAL_STEP = 2;

const NUMERAL_PATTERN = /^([1-9][0-9]*)([A-Z])?$/;

export type RegistryConflict =
  | { kind: "duplicate_numeral"; numeral: string; existingLabel: string; incomingLabel: string }
  | { kind: "duplicate_part"; numeral: string; existingNumeral: string; partLabel: string }
  | { kind: "invalid_numeral"; numeral: string; reason: string };

export type AllocationResult = {
  entries: NumeralEntry[];
  /** Numeral assigned (existing or newly minted) for each requested part. */
  assigned: Map<string, string>;
  conflicts: RegistryConflict[];
};

/** The only conflict kind `validateNumeralToken` can produce. */
export type InvalidNumeralConflict = Extract<RegistryConflict, { kind: "invalid_numeral" }>;

/** Structural validity of a reference character (1.84(p)(1)–(2)). */
export function validateNumeralToken(numeral: string): InvalidNumeralConflict | null {
  if (numeral !== numeral.trim()) {
    return { kind: "invalid_numeral", numeral, reason: "surrounding whitespace" };
  }
  // A TRAILING prime (10') is the discouraged primed-numeral practice, not
  // an enclosure; report it as what it is so the message is actionable.
  if (/^[1-9][0-9]*[A-Z]?['′]+$/.test(numeral)) {
    return { kind: "invalid_numeral", numeral, reason: "primed numerals are discouraged" };
  }
  if (/[()[\]{}'"“”‘’<>]/.test(numeral)) {
    // 1.84(p)(1): reference characters must not be enclosed in brackets,
    // inverted commas, circles, or outlines.
    return { kind: "invalid_numeral", numeral, reason: "enclosed in brackets or quotes" };
  }
  if (!NUMERAL_PATTERN.test(numeral)) {
    return {
      kind: "invalid_numeral",
      numeral,
      reason: "must be an Arabic numeral with an optional single capital suffix letter",
    };
  }
  return null;
}

function numericPart(numeral: string): number {
  const match = NUMERAL_PATTERN.exec(numeral);
  return match ? Number(match[1]) : Number.NaN;
}

/** Normalized part identity: labels differing only in case/spacing are one part. */
export function partKey(partLabel: string): string {
  return partLabel.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Allocate numerals for a batch of parts against an existing registry.
 *
 * Guarantees:
 * - A part already in the registry keeps its numeral. Existing parts are
 *   NEVER renumbered — that is the whole point of the registry.
 * - New parts get the next free even numeral from 10 upward.
 * - The same numeral is never handed to two different parts.
 * - Requests that carry an explicit numeral are honored when free and valid,
 *   and reported as conflicts otherwise (never silently reassigned).
 */
export function allocateNumerals(
  existing: readonly NumeralEntry[],
  requests: ReadonlyArray<{
    partLabel: string;
    componentId?: string | null;
    figureNumber?: number | null;
    /** Caller-proposed numeral (e.g. from the planner). Optional. */
    preferredNumeral?: string | null;
  }>,
): AllocationResult {
  const entries: NumeralEntry[] = existing.map((entry) => ({ ...entry }));
  const conflicts: RegistryConflict[] = [];
  const assigned = new Map<string, string>();

  const byPart = new Map<string, NumeralEntry>();
  const byNumeral = new Map<string, NumeralEntry>();
  for (const entry of entries) {
    byPart.set(partKey(entry.partLabel), entry);
    byNumeral.set(entry.numeral, entry);
  }

  let cursor = NUMERAL_START;
  const bumpCursor = () => {
    while (byNumeral.has(String(cursor))) cursor += NUMERAL_STEP;
    return String(cursor);
  };

  for (const request of requests) {
    const label = request.partLabel.trim();
    if (!label) continue;
    const key = partKey(label);

    const already = byPart.get(key);
    if (already) {
      // Existing part: keep its numeral, no matter what was proposed.
      assigned.set(label, already.numeral);
      if (request.preferredNumeral && request.preferredNumeral !== already.numeral) {
        conflicts.push({
          kind: "duplicate_part",
          numeral: request.preferredNumeral,
          existingNumeral: already.numeral,
          partLabel: label,
        });
      }
      if (already.componentId === null && request.componentId) {
        already.componentId = request.componentId;
      }
      continue;
    }

    let numeral: string | null = null;
    if (request.preferredNumeral) {
      const invalid = validateNumeralToken(request.preferredNumeral);
      if (invalid) {
        conflicts.push(invalid);
      } else {
        const clash = byNumeral.get(request.preferredNumeral);
        if (clash) {
          conflicts.push({
            kind: "duplicate_numeral",
            numeral: request.preferredNumeral,
            existingLabel: clash.partLabel,
            incomingLabel: label,
          });
        } else {
          numeral = request.preferredNumeral;
        }
      }
    }
    if (!numeral) numeral = bumpCursor();

    const entry: NumeralEntry = {
      numeral,
      partLabel: label,
      componentId: request.componentId ?? null,
      firstAssignedFigureNumber: request.figureNumber ?? null,
    };
    entries.push(entry);
    byPart.set(key, entry);
    byNumeral.set(numeral, entry);
    assigned.set(label, numeral);
  }

  entries.sort((a, b) => numericPart(a.numeral) - numericPart(b.numeral) ||
    a.numeral.localeCompare(b.numeral));
  return { entries, assigned, conflicts };
}

/**
 * Mint a suffixed sibling of an existing numeral (16 → 16A → 16B) for a part
 * that must sit between already-numbered parts.
 */
export function nextSuffix(existing: readonly NumeralEntry[], baseNumeral: string): string {
  const base = NUMERAL_PATTERN.exec(baseNumeral)?.[1] ?? baseNumeral;
  const used = new Set(
    existing
      .map((entry) => NUMERAL_PATTERN.exec(entry.numeral))
      .filter((match): match is RegExpExecArray => Boolean(match) && match![1] === base && Boolean(match![2]))
      .map((match) => match[2]),
  );
  for (let code = 65; code <= 90; code += 1) {
    const letter = String.fromCharCode(code);
    if (!used.has(letter)) return `${base}${letter}`;
  }
  throw new Error(`no free suffix letter remains for numeral ${baseNumeral}`);
}

/** Look up a part label by numeral — the rename-propagation read path. */
export function labelFor(entries: readonly NumeralEntry[], numeral: string): string | null {
  return entries.find((entry) => entry.numeral === numeral)?.partLabel ?? null;
}

/**
 * Registry-level consistency check. Returns violations rather than throwing
 * so the validator can report all of them at once.
 */
export function checkRegistryConsistency(entries: readonly NumeralEntry[]): RegistryConflict[] {
  const conflicts: RegistryConflict[] = [];
  const byNumeral = new Map<string, NumeralEntry>();
  const byPart = new Map<string, NumeralEntry>();
  for (const entry of entries) {
    const invalid = validateNumeralToken(entry.numeral);
    if (invalid) conflicts.push(invalid);

    const numeralClash = byNumeral.get(entry.numeral);
    if (numeralClash && partKey(numeralClash.partLabel) !== partKey(entry.partLabel)) {
      conflicts.push({
        kind: "duplicate_numeral",
        numeral: entry.numeral,
        existingLabel: numeralClash.partLabel,
        incomingLabel: entry.partLabel,
      });
    }
    byNumeral.set(entry.numeral, entry);

    const partClash = byPart.get(partKey(entry.partLabel));
    if (partClash && partClash.numeral !== entry.numeral) {
      conflicts.push({
        kind: "duplicate_part",
        numeral: entry.numeral,
        existingNumeral: partClash.numeral,
        partLabel: entry.partLabel,
      });
    }
    byPart.set(partKey(entry.partLabel), entry);
  }
  return conflicts;
}

/**
 * BRIEF-DRIVEN ALLOCATION — consume, never mint.
 *
 * Jeff's directive (2026-08-04): Pass 1 authors the reference numerals in
 * the illustrations brief, and "the figure planner then CONSUMES rather than
 * invents numerals".
 *
 * So when a figure set is planned from a brief, this is the allocator: a
 * part already in the registry keeps its numeral, and a part that is NOT in
 * the registry gets NOTHING. It is reported as `unassignable` so the planner
 * can ask a question instead of quietly minting a numeral the prose has
 * never heard of — which is precisely the two-author problem the brief
 * exists to eliminate.
 */
export type ConsumeResult = {
  entries: NumeralEntry[];
  assigned: Map<string, string>;
  /** Parts the brief never assigned a numeral to. Never silently numbered. */
  unassignable: string[];
};

export function consumeNumerals(
  existing: readonly NumeralEntry[],
  requests: ReadonlyArray<{ partLabel: string; componentId?: string | null }>,
): ConsumeResult {
  const entries: NumeralEntry[] = existing.map((entry) => ({ ...entry }));
  const byPart = new Map(entries.map((entry) => [partKey(entry.partLabel), entry]));
  const assigned = new Map<string, string>();
  const unassignable: string[] = [];

  for (const request of requests) {
    const label = request.partLabel.trim();
    if (!label) continue;
    const entry = byPart.get(partKey(label));
    if (!entry) {
      if (!unassignable.includes(label)) unassignable.push(label);
      continue;
    }
    assigned.set(label, entry.numeral);
    if (entry.componentId === null && request.componentId) {
      entry.componentId = request.componentId;
    }
  }

  return { entries, assigned, unassignable };
}
