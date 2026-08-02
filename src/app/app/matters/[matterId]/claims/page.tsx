import { getAdapters } from "@/lib/adapters";
import {
  checkAntecedentBasis,
  checkClaimDependencies,
  parseDependency,
  summarizeFindings,
  type CheckFinding,
} from "@/lib/domain/checks";
import type { ClaimRecord } from "@/lib/domain/schemas";

/**
 * §8.2 /claims — claim tree with LIVE deterministic check results. The
 * dependency and antecedent-basis checkers run on every render; results are
 * rules-based, never model opinion.
 */
export default async function ClaimsPage({
  params,
}: {
  params: Promise<{ matterId: string }>;
}) {
  const { matterId } = await params;
  const adapters = getAdapters();
  const session = await adapters.auth.getSession();
  if (!session) return null;

  const claims = await adapters.data.listClaims(session.organizationId, matterId);
  const inputs = claims.map((c) => ({ number: c.claimNumber, text: c.text }));
  const dep = checkClaimDependencies(inputs);
  const ab = checkAntecedentBasis(inputs);
  const depSummary = summarizeFindings(dep.findings);
  const abSummary = summarizeFindings(ab.findings);

  const findingsByClaim = new Map<number, CheckFinding[]>();
  for (const finding of [...dep.findings, ...ab.findings]) {
    const list = findingsByClaim.get(finding.claimNumber) ?? [];
    list.push(finding);
    findingsByClaim.set(finding.claimNumber, list);
  }

  // Tree layout: children grouped under their first parent.
  const byParent = new Map<number | null, ClaimRecord[]>();
  for (const claim of claims) {
    const parents = parseDependency(claim.text)?.parents ?? [];
    const key = parents.length > 0 ? parents[0] : null;
    const list = byParent.get(key) ?? [];
    list.push(claim);
    byParent.set(key, list);
  }

  const renderClaim = (claim: ClaimRecord, depth: number): React.ReactNode => {
    const parsed = parseDependency(claim.text);
    const findings = findingsByClaim.get(claim.claimNumber) ?? [];
    const children = (byParent.get(claim.claimNumber) ?? []).filter(
      (c) => c.claimNumber !== claim.claimNumber,
    );
    return (
      <li key={claim.id} style={{ marginLeft: depth * 20 }} className="mt-2">
        <div
          className={`border bg-[var(--white)] p-3 ${
            findings.some((f) => f.severity === "error")
              ? "border-[#a05252]"
              : "border-[var(--line)]"
          }`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <strong className="text-[0.9rem]">Claim {claim.claimNumber}</strong>
            <span className="text-[0.68rem] font-bold uppercase tracking-[0.08em] text-[var(--muted)]">
              {parsed
                ? `dependent — from claim${parsed.parents.length > 1 ? "s" : ""} ${parsed.parents.join(", ")}${parsed.multiple ? " (multiple)" : ""}`
                : "independent"}
            </span>
            <span className="ml-auto text-[0.68rem] text-[var(--muted)]">
              v{claim.version}
            </span>
          </div>
          <p className="mb-0 mt-1.5 text-[0.85rem] leading-relaxed">{claim.text}</p>
          {findings.map((f, i) => (
            <p
              key={`${f.code}-${i}`}
              className={`mb-0 mt-2 border-l-4 px-2 py-1.5 text-[0.75rem] leading-snug ${
                f.severity === "error"
                  ? "border-[#a05252] bg-[#f6dcdc] text-[#7c1f1f]"
                  : "border-[#b9a76a] bg-[#f4ecd2] text-[#5d4a12]"
              }`}
            >
              <strong>[{f.code}]</strong> {f.message}
            </p>
          ))}
        </div>
        {children.length > 0 && (
          <ul className="m-0 list-none p-0">
            {children.map((c) => renderClaim(c, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  const roots = byParent.get(null) ?? [];

  return (
    <div className="max-w-[1000px]">
      <h2 className="m-0 mb-1 text-lg font-medium" style={{ fontFamily: "Georgia, serif" }}>
        Claim tree
      </h2>
      <p className="mt-0 mb-4 text-[0.85rem] text-[var(--muted)]">
        Deterministic checks run on every view — pure rules (37 CFR 1.75,
        MPEP 608.01(n) practice), not model opinion. Failures annotate the
        claim and cannot be dismissed without a recorded reason.
      </p>

      <div className="mb-4 flex flex-wrap gap-3">
        <div
          className={`border px-3 py-2 text-[0.8rem] ${
            dep.passed
              ? "border-[#5f7d4f] bg-[#e2eecd] text-[#2f4a16]"
              : "border-[#a05252] bg-[#f6dcdc] text-[#7c1f1f]"
          }`}
        >
          <strong>
            Claim dependencies: {dep.passed ? "PASS" : "FAIL"}
          </strong>{" "}
          — {depSummary.errors} error(s), {depSummary.warnings} warning(s) ·{" "}
          {dep.checker}@{dep.checkerVersion}
        </div>
        <div
          className={`border px-3 py-2 text-[0.8rem] ${
            ab.passed
              ? "border-[#5f7d4f] bg-[#e2eecd] text-[#2f4a16]"
              : "border-[#a05252] bg-[#f6dcdc] text-[#7c1f1f]"
          }`}
        >
          <strong>
            Antecedent basis: {ab.passed ? "PASS" : "FAIL"}
          </strong>{" "}
          — {abSummary.errors} error(s), {abSummary.warnings} warning(s) ·{" "}
          {ab.checker}@{ab.checkerVersion}
        </div>
      </div>

      {claims.length === 0 ? (
        <p className="border border-dashed border-[var(--line)] bg-[var(--white)] p-4 text-[0.85rem] text-[var(--muted)]">
          No claims drafted in this matter yet. Claim-tree drafts (Tier B)
          appear here with live check results.
        </p>
      ) : (
        <ul className="m-0 list-none p-0">
          {roots.map((claim) => renderClaim(claim, 0))}
        </ul>
      )}
    </div>
  );
}
