import type { CheckFinding, CheckResult, ClaimInput } from "./types";

/**
 * Reference-numeral consistency checker (PRD §5.1 "reference-numeral
 * consistency", figure/callout audit; FR-7 deterministic stage).
 *
 * Pure function over specification text and the claim set. Deterministic
 * pattern rules — never model opinion:
 *
 *  - NUM-CONFLICT          one numeral used for materially different
 *                          element labels                             (error)
 *  - NUM-LABEL-SPLIT       one element label carrying two numerals    (warning)
 *  - NUM-CLAIM-ONLY        numeral appears in the claims but never in
 *                          the specification                          (error)
 *  - FIG-NOT-DESCRIBED     a figure is referenced but has no "FIG. N"
 *                          description mention in the specification   (error)
 *
 * Numeral grammar (US drafting practice): an element label immediately
 * followed by a numeral, e.g. "manifold plate 12", "cassette module 14a".
 */

export const NUMERAL_CONSISTENCY_CHECKER = "numeral-consistency";
export const NUMERAL_CONSISTENCY_CHECKER_VERSION = "1.0.0";

export interface SpecSectionInput {
  heading: string;
  body: string;
}

interface NumeralUse {
  numeral: string;
  label: string;
}

const ARTICLES = new Set(["a", "an", "the", "said", "each", "first", "second", "third", "plurality", "of"]);

/** Words that precede numbers but are not element labels. */
const NON_LABEL_TAILS = new Set([
  "claim", "claims", "fig", "figs", "figure", "figures", "paragraph",
  "section", "step", "example", "embodiment", "column", "line", "page",
  "usc", "cfr", "part", "year",
]);

/** Normalize a token: lowercase and strip a simple plural "s". */
function normalizeToken(token: string): string {
  const t = token.toLowerCase();
  return t.length > 3 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t;
}

/**
 * Extract (label, numeral) uses from prose. The label is the trailing noun
 * phrase (last two non-article words, plural-normalized) before the numeral.
 */
export function extractNumeralUses(text: string): NumeralUse[] {
  const uses: NumeralUse[] = [];
  const pattern = /((?:[A-Za-z][A-Za-z-]*\s+){1,4})(\d{1,4}[a-z]?)\b/g;
  const normalized = text.replace(/\s+/g, " ");
  for (const match of normalized.matchAll(pattern)) {
    const words = match[1]
      .trim()
      .toLowerCase()
      .split(" ")
      .filter((w) => w.length > 0);
    const tail = words[words.length - 1];
    if (!tail || NON_LABEL_TAILS.has(tail.replace(/\./g, ""))) continue;
    // Strip articles/ordinals, keep the trailing noun phrase only.
    const labelWords = words.filter((w) => !ARTICLES.has(w)).map(normalizeToken);
    if (labelWords.length === 0) continue;
    const label = labelWords.slice(-2).join(" ");
    // Skip pure years/dates and statute-like tokens.
    const numeral = match[2];
    if (/^(19|20)\d{2}$/.test(numeral)) continue;
    uses.push({ numeral, label });
  }
  return uses;
}

/** Extract referenced figure identifiers ("FIG. 2", "FIGS. 3-4" → 3, 4). */
export function extractFigureRefs(text: string): Set<string> {
  const refs = new Set<string>();
  const normalized = text.replace(/\s+/g, " ");
  for (const match of normalized.matchAll(/FIGS?\.?\s+(\d+[A-Za-z]?)(?:\s*(?:[-–]|through|to)\s*(\d+[A-Za-z]?))?/gi)) {
    refs.add(match[1].toUpperCase());
    if (match[2]) {
      const a = parseInt(match[1], 10);
      const b = parseInt(match[2], 10);
      if (!Number.isNaN(a) && !Number.isNaN(b) && b > a && b - a < 30) {
        for (let n = a + 1; n <= b; n += 1) refs.add(String(n));
      } else {
        refs.add(match[2].toUpperCase());
      }
    }
  }
  return refs;
}

/** Token-set similarity for deciding whether two labels are the same element. */
function labelsCompatible(a: string, b: string): boolean {
  if (a === b) return true;
  const ta = new Set(a.split(" "));
  const tb = new Set(b.split(" "));
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  if (shared >= 2) return true;
  // Same head noun ("self-sealing port" vs "respective port") is the same
  // element under standard drafting convention; different heads conflict.
  const headA = a.split(" ").at(-1);
  const headB = b.split(" ").at(-1);
  return headA === headB;
}

export function checkNumeralConsistency(
  sections: SpecSectionInput[],
  claims: ClaimInput[] = [],
): CheckResult {
  const findings: CheckFinding[] = [];
  const specText = sections.map((s) => `${s.heading}. ${s.body}`).join("\n");
  const specUses = extractNumeralUses(specText);

  // Index numeral → labels and label → numerals.
  const byNumeral = new Map<string, Map<string, number>>();
  for (const use of specUses) {
    const labels = byNumeral.get(use.numeral) ?? new Map<string, number>();
    labels.set(use.label, (labels.get(use.label) ?? 0) + 1);
    byNumeral.set(use.numeral, labels);
  }

  // NUM-CONFLICT: same numeral, incompatible labels.
  for (const [numeral, labels] of byNumeral) {
    const distinct = [...labels.keys()];
    for (let i = 0; i < distinct.length; i += 1) {
      for (let j = i + 1; j < distinct.length; j += 1) {
        if (!labelsCompatible(distinct[i], distinct[j])) {
          findings.push({
            code: "NUM-CONFLICT",
            severity: "error",
            claimNumber: 0,
            term: numeral,
            message: `Reference numeral ${numeral} is used for different elements: "${distinct[i]}" and "${distinct[j]}".`,
          });
        }
      }
    }
  }

  // NUM-LABEL-SPLIT: same element label mapped to multiple numerals.
  const byLabel = new Map<string, Set<string>>();
  for (const use of specUses) {
    const set = byLabel.get(use.label) ?? new Set<string>();
    set.add(use.numeral);
    byLabel.set(use.label, set);
  }
  for (const [label, numerals] of byLabel) {
    if (numerals.size > 1) {
      findings.push({
        code: "NUM-LABEL-SPLIT",
        severity: "warning",
        claimNumber: 0,
        term: label,
        message: `Element "${label}" carries multiple reference numerals: ${[...numerals].sort().join(", ")}.`,
      });
    }
  }

  // NUM-CLAIM-ONLY: numerals cited in claims but absent from the spec.
  const specNumerals = new Set(specUses.map((u) => u.numeral));
  for (const claim of claims) {
    for (const use of extractNumeralUses(claim.text)) {
      if (!specNumerals.has(use.numeral)) {
        findings.push({
          code: "NUM-CLAIM-ONLY",
          severity: "error",
          claimNumber: claim.number,
          term: use.numeral,
          message: `Claim ${claim.number} references numeral ${use.numeral} ("${use.label}") which never appears in the specification.`,
        });
      }
    }
  }

  // FIG-NOT-DESCRIBED: referenced figures need a description mention.
  const allText = `${specText}\n${claims.map((c) => c.text).join("\n")}`;
  const referenced = extractFigureRefs(allText);
  // The drawings inventory is the "brief description of the drawings"
  // section; every referenced figure must be introduced there.
  const described = extractFigureRefs(
    sections
      .filter((s) => /drawing/i.test(s.heading))
      .map((s) => s.body)
      .join("\n"),
  );
  for (const fig of referenced) {
    if (described.size > 0 && !described.has(fig)) {
      findings.push({
        code: "FIG-NOT-DESCRIBED",
        severity: "error",
        claimNumber: 0,
        term: `FIG. ${fig}`,
        message: `FIG. ${fig} is referenced but not described in the drawings/description sections.`,
      });
    }
  }

  return {
    checker: NUMERAL_CONSISTENCY_CHECKER,
    checkerVersion: NUMERAL_CONSISTENCY_CHECKER_VERSION,
    passed: findings.every((f) => f.severity !== "error"),
    findings,
  };
}
