import { parseDependency } from "./claim-dependency";
import type { CheckFinding, CheckResult, ClaimInput } from "./types";

/**
 * Antecedent-basis checker (PRD §5.1, FR-7 deterministic stage).
 *
 * Pure function. For every claim, builds the term environment inherited
 * through its dependency chain and verifies that each definite reference
 * ("the X" / "said X") has an antecedent introduced with an indefinite
 * article ("a X", "an X", "at least one X", "one or more X",
 * "a plurality of X") earlier in the same claim or in a parent claim.
 *
 * Findings:
 *  - AB-MISSING     "the/said X" with no antecedent in the chain   (error)
 *  - AB-DUPLICATE   "a X" introduced again when X already exists
 *                   in the environment (double-inclusion risk)     (warning)
 *
 * Multiple dependent claims are checked once per alternative parent chain;
 * a term that lacks basis in ANY chain is reported with that chain's path.
 */

export const ANTECEDENT_BASIS_CHECKER = "antecedent-basis";
export const ANTECEDENT_BASIS_CHECKER_VERSION = "1.0.0";

/** Words that terminate a noun phrase capture. */
const STOP_WORDS = new Set([
  "comprising", "comprises", "including", "includes", "having", "has",
  "wherein", "whereby", "which", "that", "when", "such", "further",
  "is", "are", "was", "were", "being", "be",
  "configured", "adapted", "arranged", "disposed", "coupled", "connected",
  "positioned", "mounted", "attached", "formed", "extending", "defining",
  "and", "or", "to", "for", "with", "in", "on", "at", "into", "onto",
  "by", "from", "between", "through", "along", "over", "under", "within",
  "each", "said", "the", "a", "an", "at", "one",
]);

/** Indefinite introducers, longest first so the regex prefers them. */
const INTRODUCER_RE =
  /\b(a plurality of|at least one of|at least one|one or more|an|a)\s+/g;
const REFERENCE_RE = /\b(the|said)\s+/g;

interface PhraseHit {
  phrase: string;
  introducer: string;
  index: number;
}

/**
 * Capture the noun phrase starting at `start`: consecutive word tokens up to
 * punctuation or a stop word. Deterministic tokenizer shared by
 * introductions and references so both sides parse identically.
 */
function capturePhrase(text: string, start: number): string {
  const rest = text.slice(start);
  const words: string[] = [];
  const tokenRe = /^([a-z][a-z0-9'’-]*)([\s,;:.()]*)/;
  let cursor = rest;
  while (words.length < 6) {
    const m = cursor.match(tokenRe);
    if (!m) break;
    const word = m[1];
    if (STOP_WORDS.has(word)) break;
    words.push(word);
    const trailing = m[2] ?? "";
    // Any punctuation ends the phrase.
    if (/[,;:.()]/.test(trailing)) break;
    cursor = cursor.slice(m[0].length);
  }
  return words.join(" ");
}

function collect(text: string, re: RegExp): PhraseHit[] {
  const hits: PhraseHit[] = [];
  const lower = text.toLowerCase().replace(/\s+/g, " ");
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(lower)) !== null) {
    const phrase = capturePhrase(lower, m.index + m[0].length);
    if (phrase.length > 0) {
      hits.push({ phrase, introducer: m[1], index: m.index });
    }
  }
  return hits;
}

/** Strip the claim's own dependency phrase so "the ... of claim 2" text
 *  ("the apparatus of claim 2") is not treated as a definite reference. */
function stripDependencyPreamble(text: string): string {
  return text.replace(
    /\b(?:the|said)\s+[a-z0-9'’\- ]{1,60}?\s+(?:of|according to|as claimed in|as recited in)\s+(?:any\s+(?:one\s+)?of\s+)?claims?\s+[\d\s,\-–]+(?:\s*(?:or|and|to)\s*\d+)*/gi,
    " ",
  );
}

/** Terms a claim introduces (with plural expansion for collective forms). */
export function introducedTerms(text: string): { term: string; index: number }[] {
  const out: { term: string; index: number }[] = [];
  for (const hit of collect(text, INTRODUCER_RE)) {
    out.push({ term: hit.phrase, index: hit.index });
    // "a plurality of cassette modules" also provides basis for
    // "the cassette modules" and (per common practice) "the plurality".
    if (hit.introducer === "a plurality of") {
      out.push({ term: `plurality of ${hit.phrase}`, index: hit.index });
      out.push({ term: "plurality", index: hit.index });
    }
  }
  return out;
}

/** Definite references a claim makes ("the X" / "said X"). */
export function definiteReferences(text: string): { term: string; index: number }[] {
  return collect(stripDependencyPreamble(text), REFERENCE_RE).map((h) => ({
    term: h.phrase,
    index: h.index,
  }));
}

/**
 * Does `env` provide antecedent basis for `term`? Exact phrase match first,
 * then progressively shorter head-anchored suffixes of the reference (a
 * reference "the manifold plate ports" is satisfied by an introduction of
 * "manifold plate ports", not by "manifold" alone — but a longer captured
 * reference tail like "manifold plate inserted" may legitimately shorten
 * from the right because the tokenizer cannot see part-of-speech).
 */
function hasBasis(env: Set<string>, term: string): boolean {
  if (env.has(term)) return true;
  const words = term.split(" ");
  for (let len = words.length - 1; len >= 1; len -= 1) {
    if (env.has(words.slice(0, len).join(" "))) return true;
  }
  return false;
}

/** All alternative parent chains for a claim (root-first, excluding self). */
function parentChains(
  claimNumber: number,
  byNumber: Map<number, ClaimInput>,
  seen: Set<number> = new Set(),
): number[][] {
  if (seen.has(claimNumber)) return [[]]; // cycle: dependency checker reports it
  const claim = byNumber.get(claimNumber);
  if (!claim) return [[]];
  const dep = parseDependency(claim.text);
  if (!dep || dep.parents.length === 0) return [[]];
  const chains: number[][] = [];
  for (const parent of dep.parents) {
    if (!byNumber.has(parent)) {
      chains.push([]); // missing parent: dependency checker reports it
      continue;
    }
    const sub = parentChains(parent, byNumber, new Set([...seen, claimNumber]));
    for (const chain of sub) chains.push([...chain, parent]);
  }
  return chains.length > 0 ? chains : [[]];
}

export function checkAntecedentBasis(claims: ClaimInput[]): CheckResult {
  const findings: CheckFinding[] = [];
  const byNumber = new Map(claims.map((c) => [c.number, c]));

  for (const claim of [...claims].sort((a, b) => a.number - b.number)) {
    const chains = parentChains(claim.number, byNumber);
    const ownIntro = introducedTerms(claim.text);
    const ownRefs = definiteReferences(claim.text);

    // A term reported missing on every alternative chain is reported once;
    // a term missing on only some chains reports the failing chain.
    const missingByTerm = new Map<string, number[][]>();

    for (const chain of chains) {
      const env = new Set<string>();
      for (const parentNumber of chain) {
        const parent = byNumber.get(parentNumber);
        if (!parent) continue;
        for (const t of introducedTerms(parent.text)) env.add(t.term);
      }

      // Walk the claim's own text in order: an introduction provides basis
      // only for references that appear after it.
      const events = [
        ...ownIntro.map((e) => ({ ...e, kind: "intro" as const })),
        ...ownRefs.map((e) => ({ ...e, kind: "ref" as const })),
      ].sort((a, b) => a.index - b.index);

      const localDuplicates: string[] = [];
      for (const event of events) {
        if (event.kind === "intro") {
          if (hasBasis(env, event.term)) localDuplicates.push(event.term);
          env.add(event.term);
        } else if (!hasBasis(env, event.term)) {
          const list = missingByTerm.get(event.term) ?? [];
          list.push(chain);
          missingByTerm.set(event.term, list);
        }
      }

      // Duplicate-introduction warnings are chain-independent for the claim's
      // own text; emit once (first chain only).
      if (chain === chains[0]) {
        for (const term of new Set(localDuplicates)) {
          findings.push({
            code: "AB-DUPLICATE",
            severity: "warning",
            claimNumber: claim.number,
            term,
            message: `Claim ${claim.number} introduces "a/an ${term}" but "${term}" already has antecedent basis — possible double inclusion; use "the ${term}" or a distinct name.`,
          });
        }
      }
    }

    for (const [term, failedChains] of missingByTerm) {
      const failsEverywhere = failedChains.length === chains.length;
      const examplePath = failedChains[0];
      findings.push({
        code: "AB-MISSING",
        severity: "error",
        claimNumber: claim.number,
        term,
        path: examplePath.length > 0 ? examplePath : undefined,
        message: failsEverywhere
          ? `Claim ${claim.number}: "the ${term}" lacks antecedent basis — no earlier "a/an ${term}" in this claim or its parent chain.`
          : `Claim ${claim.number}: "the ${term}" lacks antecedent basis on parent chain [${examplePath.join(" → ")}] (an alternative chain does provide basis).`,
      });
    }
  }

  findings.sort((a, b) => a.claimNumber - b.claimNumber || a.code.localeCompare(b.code));
  return {
    checker: ANTECEDENT_BASIS_CHECKER,
    checkerVersion: ANTECEDENT_BASIS_CHECKER_VERSION,
    passed: findings.every((f) => f.severity !== "error"),
    findings,
  };
}
