import {
  checkClaimDependencies,
  checkNumeralConsistency,
} from "@/lib/domain/checks";
import { CORPUS_RELEASE, searchCorpus, verifyQuote } from "@/lib/knowledge";
import { localAdapters, resetLocalStore } from "@/lib/adapters/local";
import { ORG_ID, DEMO_SESSION } from "@/lib/adapters/local/seed";
import type {
  BenchmarkQuestion,
  QuestionResult,
  SuiteRunReport,
} from "./types";

/**
 * Smoke-suite runner (PRD §14): executes each benchmark question against
 * the REAL local-mode systems (retrieval protocol, quote verifier,
 * deterministic checkers, adapter isolation). Deterministic; runs in CI.
 */

async function runQuestion(q: BenchmarkQuestion): Promise<QuestionResult> {
  const base = { questionId: q.id, dimension: q.dimension };

  // Quotation fidelity: verifier pass/fail behavior.
  if (q.verbatimQuote || q.tamperedQuote) {
    const target = q.expectedSourceKeys[0];
    if (q.verbatimQuote) {
      const v = verifyQuote({ corpusDocumentId: target, quote: q.verbatimQuote });
      return {
        ...base,
        passed: v.state === "verified",
        detail: `verbatim quote → ${v.state}`,
      };
    }
    const v = verifyQuote({ corpusDocumentId: target, quote: q.tamperedQuote! });
    return {
      ...base,
      passed: v.state === "failed",
      detail: `tampered quote → ${v.state} (must fail)`,
    };
  }

  // Claim-scope preservation: deterministic checkers on a known-bad set.
  if (q.dimension === "claim_scope_preservation") {
    const dep = checkClaimDependencies([
      { number: 1, text: "An apparatus comprising a manifold plate." },
      { number: 2, text: "The apparatus of claim 5, wherein the plate is steel." },
    ]);
    const num = checkNumeralConsistency(
      [{ heading: "Detailed description", body: "The manifold plate 12 is shown." }],
      [{ number: 3, text: "The apparatus of claim 1, further comprising a conduit 44." }],
    );
    const passed = !dep.passed && !num.passed; // both must FLAG the defects
    return {
      ...base,
      passed,
      detail: `dependency check ${dep.passed ? "MISSED" : "caught"} missing target; numeral check ${num.passed ? "MISSED" : "caught"} unsupported numeral`,
    };
  }

  // Cross-matter leakage: adapter isolation probes (must be zero).
  if (q.dimension === "cross_matter_leakage") {
    resetLocalStore();
    await localAdapters.data.postChatMessage(
      ORG_ID,
      "matter_thermal",
      { question: "grace period for inventor disclosure" },
      { userId: DEMO_SESSION.userId, role: DEMO_SESSION.role },
    );
    const otherMatter = await localAdapters.data.listChatMessages(
      ORG_ID,
      "matter_optical",
    );
    const otherTenantMatters = await localAdapters.data.listMatters("org_other");
    const otherTenantDocs = await localAdapters.data.listDocuments("org_other");
    const leaks =
      otherMatter.length + otherTenantMatters.length + otherTenantDocs.length;
    resetLocalStore();
    return {
      ...base,
      passed: leaks === 0,
      detail: `cross-matter/tenant probes returned ${leaks} rows (must be 0)`,
    };
  }

  // Retrieval correctness / supersession / refusal via the search protocol.
  const result = searchCorpus({
    query: q.question,
    jurisdiction: q.jurisdiction,
    asOfDate: q.asOfDate,
    limit: 8,
  });
  const hitIds = new Set(result.hits.map((h) => h.documentId));

  if (q.expectRefusal) {
    const refused = result.hits.length === 0 && Boolean(result.insufficiencyWarning);
    return {
      ...base,
      passed: refused,
      detail: refused
        ? "explicit insufficiency warning, zero hits"
        : `expected refusal but got ${result.hits.length} hit(s)`,
    };
  }

  const missing = q.expectedSourceKeys.filter((k) => !hitIds.has(k));
  const forbidden = (q.forbiddenSourceKeys ?? []).filter((k) => hitIds.has(k));
  return {
    ...base,
    passed: missing.length === 0 && forbidden.length === 0,
    detail:
      missing.length || forbidden.length
        ? `missing=[${missing.join(",")}] forbidden-present=[${forbidden.join(",")}]`
        : "expected sources retrieved; forbidden sources absent",
  };
}

export async function runSmokeSuite(
  questions: BenchmarkQuestion[],
): Promise<SuiteRunReport> {
  const results: QuestionResult[] = [];
  for (const q of questions) results.push(await runQuestion(q));

  const byDimension: SuiteRunReport["byDimension"] = {};
  for (const r of results) {
    const bucket = (byDimension[r.dimension] ??= { total: 0, passed: 0 });
    bucket.total += 1;
    if (r.passed) bucket.passed += 1;
  }
  const leakage = results.filter((r) => r.dimension === "cross_matter_leakage");

  return {
    suiteVersion: questions[0]?.suiteVersion ?? "unknown",
    corpusRelease: CORPUS_RELEASE,
    ranAt: new Date().toISOString(),
    total: results.length,
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
    byDimension,
    results,
    crossMatterLeakageZero: leakage.every((r) => r.passed),
    attorneyValidatedCount: questions.filter(
      (q) => q.validation.status === "attorney_validated",
    ).length,
  };
}
