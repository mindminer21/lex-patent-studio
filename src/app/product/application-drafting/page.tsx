import type { Metadata } from "next";
import Link from "next/link";
import { Boundary, MarketingShell, PageIntro } from "@/components/marketing/Shell";

export const metadata: Metadata = {
  title: "Application drafting — Lex Patent Studio",
  description:
    "From approved invention facts to reviewable specification and claim drafts, with deterministic checks and citation verification at every step.",
};

const STEPS = [
  [
    "Fact ledger first",
    "Disclosure uploads and structured interviews become a canonical fact ledger. Every fact carries provenance — user asserted, source supported, needs confirmation, disputed, or counsel reviewed — and missing-fact prompts route to your contributors.",
  ],
  [
    "Practitioner approves the baseline",
    "Drafting is blocked until a practitioner approves facts. Lex drafts from counsel-reviewed facts only; gaps are flagged, never filled with plausible fiction.",
  ],
  [
    "Claim strategy as decision support",
    "Independent and dependent claim trees with planned-retreat fallback positions arrive as Tier-B drafts; strategy selection is recorded as a Tier-C practitioner decision.",
  ],
  [
    "Deterministic checks, not model opinion",
    "Claim-dependency and antecedent-basis checks run as pure rules on every draft. Failures annotate the document and cannot be dismissed silently — a dismissal requires a recorded reason.",
  ],
  [
    "Independent critique and verification",
    "A second, different model critiques the draft. Every quotation and citation is checked against retrieved source text; a failure blocks verified status and flags the document.",
  ],
  [
    "Review, approve, export",
    "You review in a three-pane workbench with citations, model identity, cost, and warnings alongside the draft. Approval is a recorded human decision. Exports are USPTO-formatted DOCX with a version-locked manifest — and stay watermarked DRAFT — NOT REVIEWED until a human approves.",
  ],
] as const;

export default function ApplicationDraftingPage() {
  return (
    <MarketingShell>
      <PageIntro
        kicker="Product / Application drafting"
        title="Drafts that start from your facts and show their work."
        lede="A first pass of the specification and claims, produced the way you would supervise it: from an approved fact record, with every check result and citation on the table before you spend an hour reviewing."
      />

      <section className="section" aria-label="How it works">
        <div className="workflow-list">
          {STEPS.map(([title, text], index) => (
            <article className="workflow-row" key={title}>
              <span className="row-index">0{index + 1}</span>
              <div>
                <h3>{title}</h3>
              </div>
              <p>{text}</p>
            </article>
          ))}
        </div>
        <p className="mt-8 text-[0.9rem]">
          <Link href="/product/office-actions" className="text-link">
            Next: office-action response <span aria-hidden="true">→</span>
          </Link>
        </p>
      </section>

      <Boundary>
        All drafting output is Tier-B work product for practitioner review.
        Lex does not assess patentability odds, guarantee allowance, or file
        anything. It works under your supervision, like a junior associate
        whose work you always review — and unlike an associate, it is
        software, not a licensed practitioner.
      </Boundary>
    </MarketingShell>
  );
}
