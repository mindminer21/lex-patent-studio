/**
 * THE TWO-WAY §608.02 RECONCILIATION — prose ↔ drawings, both directions.
 *
 * MPEP 608.02(d)/(g) and 37 CFR 1.84(p)(5):
 *
 *   "The reference characters must be used in the description; and all
 *    reference characters mentioned in the description must appear in the
 *    drawings."
 *
 * Two obligations, not one. Before this module the codebase REPORTED the
 * mismatch. Jeff's directive makes it a GATE on Pass 2 completion: a set
 * with an unreconciled numeral does not reach READY_FOR_REVIEW, so it
 * cannot reach a client.
 *
 * PRODUCT-AGNOSTIC. Both lanes run exactly this check on exactly these
 * inputs. Neither may accept a set this module says is unreconciled.
 *
 * PROMPT-INJECTION POSTURE: the draft text is UNTRUSTED. Nothing here reads
 * it as an instruction — the only thing extracted from it is numeral-shaped
 * tokens, by character class.
 */

/**
 * Numeral-shaped tokens in prose.
 *
 * Deliberately conservative. Patent prose is full of numbers that are not
 * reference characters — statute cites, dates, percentages, dimensions,
 * claim numbers. Over-extraction would fail the gate on legitimate text, so
 * a token only counts as a reference character when it appears in the
 * position reference characters actually appear in: immediately after a noun
 * phrase, optionally parenthesised.
 *
 * We therefore extract candidates and INTERSECT them with the registry —
 * the registry is the authority on which numerals exist, and a number that
 * matches no registry entry and no known reference-character pattern is
 * treated as ordinary prose, not as an unreconciled numeral.
 */
const NUMERAL_TOKEN = /(?<![\w.$%-])\(?([1-9][0-9]{0,3}[A-Z]?)\)?(?![\w-]|\.\d)/g;

/** Contexts a bare number is never a reference character in. */
const EXCLUSION_PATTERNS: readonly RegExp[] = [
  /\b35\s+U\.?S\.?C\.?\s*§*\s*\d+/gi, // 35 U.S.C. 112
  /\b37\s+C\.?F\.?R\.?\s*§*\s*[\d.]+/gi, // 37 CFR 1.84
  /\bMPEP\s*§*\s*[\d.()a-z]+/gi, // MPEP 608.02(g)
  /\bFIG(?:URE)?S?\.?\s*[\d]+[A-Z]?(?:\s*(?:-|–|to|and|,)\s*[\d]+[A-Z]?)*/gi, // FIG. 1
  /\bclaims?\s+\d+/gi,
  /\b\d{4}-\d{2}-\d{2}\b/g, // dates
  // Units. Split in two on purpose: a reference character is `12A` with NO
  // space, so a single-letter unit only counts when whitespace separates it.
  // Matching `16A` as "16 amperes" would silently delete a real numeral.
  /\b\d+(?:\.\d+)?\s*(?:%|percent|mm|cm|km|ms|kg|nm|um|Hz|kHz|MHz|GHz|°C|°F)\b/g,
  /\b\d+(?:\.\d+)?\s+(?:m|g|s|V|A|W|in|ft|inches|feet|metres|meters|grams|seconds|volts|amperes|watts|degrees)\b/g,
  /\b(?:19|20)\d{2}\b/g, // years
];

/**
 * Reference characters actually cited in prose, restricted to those the
 * registry knows about.
 *
 * The registry restriction is what makes this safe: an unregistered number
 * in the text is ordinary prose. The gate's job is to catch registry
 * numerals that are missing from one side, not to police arithmetic.
 */
export function extractProseNumerals(
  text: string,
  registryNumerals: readonly string[],
): Set<string> {
  let scrubbed = text;
  for (const pattern of EXCLUSION_PATTERNS) {
    scrubbed = scrubbed.replace(pattern, (match) => " ".repeat(match.length));
  }
  const known = new Set(registryNumerals);
  const found = new Set<string>();
  for (const match of scrubbed.matchAll(NUMERAL_TOKEN)) {
    const token = match[1];
    if (known.has(token)) found.add(token);
  }
  return found;
}

/**
 * Every numeral-shaped token in the prose, registry or not. Used to report
 * a numeral the description cites that the registry never assigned — a real
 * defect, but a different one from a drawing/description mismatch.
 */
export function extractUnregisteredProseNumerals(
  text: string,
  registryNumerals: readonly string[],
): Set<string> {
  let scrubbed = text;
  for (const pattern of EXCLUSION_PATTERNS) {
    scrubbed = scrubbed.replace(pattern, (match) => " ".repeat(match.length));
  }
  const known = new Set(registryNumerals);
  const found = new Set<string>();
  for (const match of scrubbed.matchAll(NUMERAL_TOKEN)) {
    const token = match[1];
    // Only parenthesised or registry-adjacent forms count, to avoid calling
    // every stray integer in the prose a broken reference character.
    if (known.has(token)) continue;
    if (match[0].startsWith("(") && match[0].endsWith(")")) found.add(token);
  }
  return found;
}

export type ReconciliationInput = {
  /** The description text under test (Pass 2's output). */
  draftText: string;
  /** Numerals the registry assigns. Authored in Pass 1. */
  registryNumerals: readonly { numeral: string; partLabel: string }[];
  /**
   * Numerals actually placed on the composed drawings, from the figure
   * annotations. NOT the plan — what the sheets carry.
   */
  drawingNumerals: readonly string[];
  /**
   * Figures actually produced (number + optional partial suffix), so the
   * Brief Description can be checked against reality.
   */
  producedFigures: readonly { figureNumber: number; partialSuffix: string | null }[];
  /** Figure numbers the Brief Description of the Drawings section names. */
  briefDescriptionFigures: readonly number[];
};

export type ReconciliationFinding =
  | {
      kind: "in_description_not_in_drawings";
      numeral: string;
      partLabel: string;
      detail: string;
    }
  | {
      kind: "in_drawings_not_in_description";
      numeral: string;
      partLabel: string;
      detail: string;
    }
  | { kind: "unregistered_in_description"; numeral: string; detail: string }
  | { kind: "drawing_numeral_not_in_registry"; numeral: string; detail: string }
  | {
      kind: "brief_description_missing_figure";
      figureNumber: number;
      detail: string;
    }
  | {
      kind: "brief_description_names_absent_figure";
      figureNumber: number;
      detail: string;
    };

export type ReconciliationReport = {
  /** True only when there is not a single finding. This is the GATE. */
  reconciled: boolean;
  findings: ReconciliationFinding[];
  /** Counts for the UI meter and the export manifest. */
  registryCount: number;
  inDescriptionCount: number;
  inDrawingsCount: number;
  checkedAt: string;
  version: string;
};

export const RECONCILIATION_VERSION = "reconcile-608.02-1.0.0";

/**
 * Run the two-way check.
 *
 * Every finding is a REPORT, never a fix. Jeff's directive is explicit:
 * "flag (never silently fix) any place where a figure and the record
 * disagree." Nothing in this module mutates the draft, the registry, or the
 * drawings.
 */
export function reconcileProseAndDrawings(
  input: ReconciliationInput,
  now: Date = new Date(),
): ReconciliationReport {
  const findings: ReconciliationFinding[] = [];
  const registry = new Map(input.registryNumerals.map((e) => [e.numeral, e.partLabel]));
  const registryList = [...registry.keys()];

  const inDescription = extractProseNumerals(input.draftText, registryList);
  const inDrawings = new Set(input.drawingNumerals);

  // Direction 1: every numeral in the description appears in the drawings.
  for (const numeral of [...inDescription].sort()) {
    if (!inDrawings.has(numeral)) {
      findings.push({
        kind: "in_description_not_in_drawings",
        numeral,
        partLabel: registry.get(numeral) ?? "(unknown part)",
        detail: `The description cites reference character ${numeral} ("${registry.get(numeral) ?? "unknown part"}") but no drawing shows it. Either the drawing must show it or the description must stop citing it — 37 CFR 1.84(p)(5).`,
      });
    }
  }

  // Direction 2: every numeral in the drawings appears in the description.
  for (const numeral of [...inDrawings].sort()) {
    if (!registry.has(numeral)) {
      findings.push({
        kind: "drawing_numeral_not_in_registry",
        numeral,
        detail: `A drawing carries reference character ${numeral}, which the illustrations brief never assigned to a part. The registry is the single source of numerals.`,
      });
      continue;
    }
    if (!inDescription.has(numeral)) {
      findings.push({
        kind: "in_drawings_not_in_description",
        numeral,
        partLabel: registry.get(numeral)!,
        detail: `A drawing shows reference character ${numeral} ("${registry.get(numeral)}") but the description never mentions it. MPEP 608.02(g) requires every character in the drawings to be used in the description.`,
      });
    }
  }

  // Numerals the description invents.
  for (const numeral of [...extractUnregisteredProseNumerals(input.draftText, registryList)].sort()) {
    findings.push({
      kind: "unregistered_in_description",
      numeral,
      detail: `The description cites reference character (${numeral}), which is not in the reference-numeral registry. It was neither assigned in the illustrations brief nor placed on any drawing.`,
    });
  }

  // The Brief Description of the Drawings must match the figures produced.
  const produced = new Set(input.producedFigures.map((f) => f.figureNumber));
  const described = new Set(input.briefDescriptionFigures);
  for (const figureNumber of [...produced].sort((a, b) => a - b)) {
    if (!described.has(figureNumber)) {
      findings.push({
        kind: "brief_description_missing_figure",
        figureNumber,
        detail: `FIG. ${figureNumber} was produced but the Brief Description of the Drawings does not describe it.`,
      });
    }
  }
  for (const figureNumber of [...described].sort((a, b) => a - b)) {
    if (!produced.has(figureNumber)) {
      findings.push({
        kind: "brief_description_names_absent_figure",
        figureNumber,
        detail: `The Brief Description of the Drawings describes FIG. ${figureNumber}, which was not produced.`,
      });
    }
  }

  return {
    reconciled: findings.length === 0,
    findings,
    registryCount: registry.size,
    inDescriptionCount: inDescription.size,
    inDrawingsCount: inDrawings.size,
    checkedAt: now.toISOString(),
    version: RECONCILIATION_VERSION,
  };
}

/** One line per finding, for the review UI and the blocking message. */
export function summariseReconciliation(report: ReconciliationReport): string[] {
  return report.findings.map((finding) => finding.detail);
}

/**
 * Figure numbers a Brief Description section actually names, parsed from
 * its paragraphs. `FIG. 1` / `FIGS. 2 and 3` / `FIGURE 4`.
 */
export function figuresNamedInBriefDescription(paragraphs: readonly string[]): number[] {
  const found = new Set<number>();
  for (const paragraph of paragraphs) {
    for (const match of paragraph.matchAll(/\bFIGS?(?:URES?)?\.?\s*([\d]+)[A-Z]?/gi)) {
      const value = Number.parseInt(match[1], 10);
      if (Number.isFinite(value) && value >= 1) found.add(value);
    }
    // "FIGS. 2 and 3" / "FIGS. 2, 3 and 4" — pick up the trailing numbers.
    for (const match of paragraph.matchAll(
      /\bFIGS?(?:URES?)?\.?\s*[\d]+[A-Z]?((?:\s*(?:,|and|through|to|–|-)\s*[\d]+[A-Z]?)+)/gi,
    )) {
      for (const tail of match[1].matchAll(/([\d]+)[A-Z]?/g)) {
        const value = Number.parseInt(tail[1], 10);
        if (Number.isFinite(value) && value >= 1) found.add(value);
      }
    }
  }
  return [...found].sort((a, b) => a - b);
}
