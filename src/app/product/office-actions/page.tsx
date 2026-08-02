import type { Metadata } from "next";
import Link from "next/link";
import { Boundary, MarketingShell, PageIntro } from "@/components/marketing/Shell";

export const metadata: Metadata = {
  title: "Office actions — Lex Patent Studio",
  description:
    "Evidence-linked rejection matrices, response-path options with estoppel flags, and amendment markup separated from argument — prepared for practitioner decision.",
};

const STEPS = [
  [
    "Parse the rejection record",
    "Upload the office action, pending claims, specification, and cited references. Lex builds a rejection matrix — claim × statute × reference — where every cell links to the office-action page and reference passage it came from.",
  ],
  [
    "Options, not orders",
    "Response paths arrive as Tier-C decision support: argue, amend, interview, or combinations — each with scope, support, and estoppel-exposure flags. Lex presents evidence and tradeoffs; the practitioner selects the path.",
  ],
  [
    "Amendments separated from argument",
    "After you choose, Lex drafts amendments in MPEP-style markup (underline additions, bracketed deletions) separately from argument drafts, so each can be reviewed and edited on its own terms.",
  ],
  [
    "Verification before you rely on it",
    "Quotations from references and from the office action are checked against source text. No argument draft asserts unverified reference content; failures flag the document instead of shipping inside it.",
  ],
  [
    "Versioned export with the review trail",
    "The response shell exports with a review checklist including every estoppel flag, a source index, and a version-locked manifest — watermarked as a draft until a practitioner approves.",
  ],
] as const;

export default function OfficeActionsPage() {
  return (
    <MarketingShell>
      <PageIntro
        kicker="Product / Office actions"
        title="Know what the examiner said before you decide what to say back."
        lede="First-pass office-action analysis with the evidence pinned to every assertion, so attorney hours go to judgment — not to re-typing the rejection."
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
          <Link href="/pricing" className="text-link">
            See plans and usage pricing <span aria-hidden="true">→</span>
          </Link>
        </p>
      </section>

      <Boundary>
        Response strategy is always the practitioner&apos;s decision. Lex
        surfaces statutory windows it observes in the record with tiered
        reminders, but it is not a docketing system of record and does not
        guarantee deadline monitoring — verify every date against your
        docket. Lex never communicates with the USPTO.
      </Boundary>
    </MarketingShell>
  );
}
