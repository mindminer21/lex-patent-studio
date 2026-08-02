import type { CheckFinding, CheckResult, ClaimInput } from "./types";

/**
 * Claim-dependency checker (PRD §5.1, FR-7 deterministic stage).
 *
 * Pure function. Parses each claim's dependency phrase from its text and
 * validates the claim set against USPTO practice rules:
 *
 *  - DEP-DUPLICATE-NUMBER   duplicate claim numbers                (error)
 *  - DEP-NUMBER-GAP         non-sequential numbering               (warning)
 *  - DEP-MISSING-TARGET     depends on a claim not in the set      (error)
 *  - DEP-SELF               claim depends on itself                (error)
 *  - DEP-FORWARD            depends on a later-numbered claim
 *                           (37 CFR 1.75(c): must refer back)      (error)
 *  - DEP-CYCLE              circular dependency chain              (error)
 *  - DEP-MULTI-ON-MULTI     multiple dependent claim depends on
 *                           another multiple dependent claim
 *                           (37 CFR 1.75(c), MPEP 608.01(n))       (error)
 *  - DEP-MULTI-CONJUNCTIVE  multiple dependent claim does not
 *                           refer to its parents in the
 *                           alternative ("and" instead of "or")    (error)
 */

export const CLAIM_DEPENDENCY_CHECKER = "claim-dependency";
export const CLAIM_DEPENDENCY_CHECKER_VERSION = "1.0.0";

export interface ParsedDependency {
  /** Parent claim numbers referenced by the dependency phrase. */
  parents: number[];
  /** True when the claim references more than one parent (multiple dependent). */
  multiple: boolean;
  /**
   * True when a multiple dependency uses alternative phrasing ("or",
   * "any one of"); conjunctive phrasing ("and") is improper.
   */
  alternative: boolean;
}

/** Expand "claims 2-5" / "claims 2 to 5" style ranges. */
function expandRange(a: number, b: number): number[] {
  if (b < a) return [a, b]; // malformed range: keep both endpoints for reporting
  const out: number[] = [];
  for (let n = a; n <= b; n += 1) out.push(n);
  return out;
}

/**
 * Parse the dependency phrase out of a claim's text. Deterministic
 * pattern-based parse — no model involvement. Returns null for an
 * independent claim (no "claim N" back-reference).
 */
export function parseDependency(text: string): ParsedDependency | null {
  const normalized = text.toLowerCase().replace(/\s+/g, " ");
  // Grab the segment following the first "claim"/"claims" mention, e.g.
  // "of claim 1", "according to claims 2-4", "of any one of claims 1, 2, or 3".
  const match = normalized.match(
    /\bclaims?\s+((?:\d+\s*(?:[-–]|to)\s*\d+|\d+)(?:\s*(?:,|,?\s*(?:or|and))\s*(?:\d+\s*(?:[-–]|to)\s*\d+|\d+))*)/,
  );
  if (!match) return null;

  const phrase = match[1];
  const parents: number[] = [];
  const pieceRe = /(\d+)\s*(?:[-–]|to)\s*(\d+)|(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = pieceRe.exec(phrase)) !== null) {
    if (m[1] !== undefined && m[2] !== undefined) {
      parents.push(...expandRange(Number(m[1]), Number(m[2])));
    } else if (m[3] !== undefined) {
      parents.push(Number(m[3]));
    }
  }
  const unique = [...new Set(parents)];
  const multiple = unique.length > 1;
  const alternative =
    /\bany\s+(?:one\s+)?of\b/.test(normalized) ||
    /\bor\b/.test(phrase) ||
    /[-–]|\bto\b/.test(phrase); // a pure range is read as alternative form
  return { parents: unique, multiple, alternative };
}

export function checkClaimDependencies(claims: ClaimInput[]): CheckResult {
  const findings: CheckFinding[] = [];
  const numbers = claims.map((c) => c.number);
  const present = new Set<number>();

  for (const n of numbers) {
    if (present.has(n)) {
      findings.push({
        code: "DEP-DUPLICATE-NUMBER",
        severity: "error",
        claimNumber: n,
        message: `Claim number ${n} appears more than once in the claim set.`,
      });
    }
    present.add(n);
  }

  const sorted = [...present].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i += 1) {
    const expected = i + 1;
    if (sorted[i] !== expected) {
      findings.push({
        code: "DEP-NUMBER-GAP",
        severity: "warning",
        claimNumber: sorted[i],
        message: `Claim numbering is not sequential: expected claim ${expected}, found claim ${sorted[i]}.`,
      });
      break; // one gap report is enough; downstream numbers cascade
    }
  }

  const parsedByNumber = new Map<number, ParsedDependency | null>();
  for (const claim of claims) {
    parsedByNumber.set(claim.number, parseDependency(claim.text));
  }

  for (const claim of claims) {
    const dep = parsedByNumber.get(claim.number);
    if (!dep) continue; // independent claim

    for (const parent of dep.parents) {
      if (parent === claim.number) {
        findings.push({
          code: "DEP-SELF",
          severity: "error",
          claimNumber: claim.number,
          message: `Claim ${claim.number} depends on itself.`,
        });
        continue;
      }
      if (!present.has(parent)) {
        findings.push({
          code: "DEP-MISSING-TARGET",
          severity: "error",
          claimNumber: claim.number,
          message: `Claim ${claim.number} depends on claim ${parent}, which is not in the claim set.`,
          path: [claim.number, parent],
        });
        continue;
      }
      if (parent > claim.number) {
        findings.push({
          code: "DEP-FORWARD",
          severity: "error",
          claimNumber: claim.number,
          message: `Claim ${claim.number} depends on later claim ${parent}; a dependent claim must refer back to a preceding claim (37 CFR 1.75).`,
          path: [claim.number, parent],
        });
      }
    }

    if (dep.multiple) {
      if (!dep.alternative) {
        findings.push({
          code: "DEP-MULTI-CONJUNCTIVE",
          severity: "error",
          claimNumber: claim.number,
          message: `Multiple dependent claim ${claim.number} must refer to its parent claims in the alternative (e.g. "any one of claims 1–3"), not conjunctively.`,
        });
      }
      for (const parent of dep.parents) {
        const parentDep = parsedByNumber.get(parent);
        if (parentDep?.multiple) {
          findings.push({
            code: "DEP-MULTI-ON-MULTI",
            severity: "error",
            claimNumber: claim.number,
            message: `Multiple dependent claim ${claim.number} depends on multiple dependent claim ${parent}; a multiple dependent claim may not serve as a basis for another multiple dependent claim (37 CFR 1.75(c)).`,
            path: [claim.number, parent],
          });
        }
      }
    }
  }

  // Cycle detection over the parsed dependency graph. Forward references are
  // already errors, but cycles are reported explicitly so the orchestrator
  // and UI can distinguish the failure mode.
  const visiting = new Set<number>();
  const done = new Set<number>();
  const inCycle = new Set<number>();
  const visit = (n: number, stack: number[]) => {
    if (done.has(n)) return;
    if (visiting.has(n)) {
      const start = stack.indexOf(n);
      for (const member of stack.slice(start)) inCycle.add(member);
      return;
    }
    visiting.add(n);
    const dep = parsedByNumber.get(n);
    for (const parent of dep?.parents ?? []) {
      if (present.has(parent)) visit(parent, [...stack, n]);
    }
    visiting.delete(n);
    done.add(n);
  };
  for (const n of present) visit(n, []);
  for (const n of [...inCycle].sort((a, b) => a - b)) {
    findings.push({
      code: "DEP-CYCLE",
      severity: "error",
      claimNumber: n,
      message: `Claim ${n} participates in a circular dependency chain.`,
    });
  }

  findings.sort((a, b) => a.claimNumber - b.claimNumber || a.code.localeCompare(b.code));
  return {
    checker: CLAIM_DEPENDENCY_CHECKER,
    checkerVersion: CLAIM_DEPENDENCY_CHECKER_VERSION,
    passed: findings.every((f) => f.severity !== "error"),
    findings,
  };
}
