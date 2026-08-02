import type { Metadata } from "next";
import Link from "next/link";
import { Boundary, MarketingShell, PageIntro } from "@/components/marketing/Shell";

export const metadata: Metadata = {
  title: "Product — Lex Patent Studio",
  description:
    "Guided associate workflows for supervised patent professionals: drafting, office actions, search, research, and review — with verification built in.",
};

const WORKFLOWS = [
  {
    href: "/product/invention-disclosures",
    eyebrow: "Intake",
    title: "Invention disclosures",
    text: "Structured interviews and uploads become a fact ledger with provenance, contributor attribution, and missing-fact prompts.",
  },
  {
    href: "/product/application-drafting",
    eyebrow: "Tier B — draft for review",
    title: "Application drafting",
    text: "From an approved fact ledger to specification sections, claim trees with fallback positions, and deterministic dependency and antecedent-basis checks.",
  },
  {
    href: "/product/office-actions",
    eyebrow: "Tier B/C — analysis and decision support",
    title: "Office-action response",
    text: "Evidence-linked rejection matrices, response-path options with tradeoff and estoppel flags, and MPEP-style amendment markup separated from arguments.",
  },
  {
    href: "/product/claim-strategy",
    eyebrow: "Tier B/C — drafting and strategy",
    title: "Claim strategy",
    text: "Claim trees with planned-retreat fallbacks, deterministic checks, and strategy selection recorded as a practitioner decision.",
  },
  {
    href: "/product/patent-research",
    eyebrow: "Tier B",
    title: "Patent research",
    text: "Primary-authority-first retrieval with effective dates, supersession checks, labeled analysis, and refusal when the record is insufficient.",
  },
  {
    href: "/product/portfolio-analysis",
    eyebrow: "Practitioner dashboards",
    title: "Portfolio analysis",
    text: "Cross-matter status, coverage-gap signals, and advisory priorities over your own record — never a docket of record.",
  },
  {
    href: "/product/prepare-and-file",
    eyebrow: "Tier A/B — preparation only",
    title: "Prepare & file",
    text: "USPTO-formatted DOCX/PDF exports with version-locked manifests and SB/08-validated IDS packets. Filing stays human.",
  },
] as const;

export default function ProductPage() {
  return (
    <MarketingShell>
      <PageIntro
        kicker="Product"
        title="Associate-tier patent work, prepared for your review."
        lede="Lex runs guided workflows the way you would brief a capable junior associate — then puts every draft, citation, and check result in front of the responsible practitioner. You review, edit, decide, sign, and file."
      />

      <section className="section" aria-label="Workflows">
        <div className="workflow-list">
          {WORKFLOWS.map((w, index) => (
            <article className="workflow-row" key={w.title}>
              <span className="row-index">0{index + 1}</span>
              <div>
                <p className="eyebrow">{w.eyebrow}</p>
                <h3>
                  <Link href={w.href} className="underline underline-offset-4">
                    {w.title}
                  </Link>
                </h3>
              </div>
              <p>{w.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="border-t border-[var(--line)] px-[4vw] py-16" aria-label="Supervision model">
        <p className="kicker">The supervision model</p>
        <h2
          className="m-0 max-w-[760px] font-medium"
          style={{ fontFamily: "Georgia, serif", fontSize: "clamp(1.8rem,3vw,2.6rem)", lineHeight: 1.1 }}
        >
          Every deliverable carries a work tier and a review requirement.
        </h2>
        <dl className="mt-8 grid max-w-[900px] grid-cols-1 gap-6 md:grid-cols-3">
          <div className="border-t-2 border-[var(--forest)] pt-3">
            <dt className="font-bold">Tier A — Prepare</dt>
            <dd className="m-0 mt-1 text-[0.9rem] leading-relaxed text-[var(--muted)]">
              Routine, verifiable work. An agent or paralegal operator reviews.
            </dd>
          </div>
          <div className="border-t-2 border-[var(--forest)] pt-3">
            <dt className="font-bold">Tier B — Draft for review</dt>
            <dd className="m-0 mt-1 text-[0.9rem] leading-relaxed text-[var(--muted)]">
              Substantive work product. The responsible practitioner reviews and
              edits before any downstream use.
            </dd>
          </div>
          <div className="border-t-2 border-[var(--forest)] pt-3">
            <dt className="font-bold">Tier C — Decision support</dt>
            <dd className="m-0 mt-1 text-[0.9rem] leading-relaxed text-[var(--muted)]">
              Options, tradeoffs, and evidence only. The practitioner decides —
              Lex never styles output as the decision.
            </dd>
          </div>
        </dl>
        <p className="mt-6 max-w-[720px] text-[0.85rem] text-[var(--muted)]">
          Tier floors are platform policy. A firm may require stricter review;
          no role can demote work below the floor.
        </p>
      </section>

      <Boundary>
        &ldquo;Your next patent associate&rdquo; is a supervised-workflow
        metaphor. Lex is software — not a licensed person, attorney, or patent
        agent, and not a substitute for professional judgment. The responsible
        practitioner independently reviews all work and controls advice,
        client communications, deadlines, signatures, and filings. Lex is not
        a docketing system and does not guarantee outcomes.
      </Boundary>
    </MarketingShell>
  );
}
