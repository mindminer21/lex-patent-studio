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
    href: "/product/application-drafting",
    eyebrow: "Tier B — draft for review",
    title: "Application drafting",
    text: "From an approved fact ledger to specification sections, claim trees with fallback positions, and deterministic dependency and antecedent-basis checks.",
    live: true,
  },
  {
    href: "/product/office-actions",
    eyebrow: "Tier B/C — analysis and decision support",
    title: "Office-action response",
    text: "Evidence-linked rejection matrices, response-path options with tradeoff and estoppel flags, and MPEP-style amendment markup separated from arguments.",
    live: true,
  },
  {
    href: null,
    eyebrow: "Tier B",
    title: "Search reports and IDS preparation",
    text: "Public-data search orchestration with per-reference rationale; IDS packets with SB/08 field validation routed for attorney review.",
    live: false,
  },
  {
    href: null,
    eyebrow: "Tier B",
    title: "Cited research memos",
    text: "Primary-authority-first retrieval with effective dates, supersession checks, labeled analysis, and refusal when the record is insufficient.",
    live: false,
  },
  {
    href: null,
    eyebrow: "Tier A",
    title: "Prepare-tier work",
    text: "Formalities, routine dependent claims per an established strategy, and status digests — operator-reviewable, always labeled.",
    live: false,
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
                  {w.href ? (
                    <Link href={w.href} className="underline underline-offset-4">
                      {w.title}
                    </Link>
                  ) : (
                    w.title
                  )}
                </h3>
                {!w.live && (
                  <p className="m-0 text-[0.72rem] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
                    In evaluation — ships after its quality gate
                  </p>
                )}
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
