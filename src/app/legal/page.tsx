import type { Metadata } from "next";
import Link from "next/link";
import { Boundary, MarketingShell, PageIntro } from "@/components/marketing/Shell";

export const metadata: Metadata = {
  title: "Legal — Lex Patent Studio",
  description: "Terms, privacy, and AI disclosure for Lex Patent Studio.",
};

const DOCS = [
  {
    href: "/legal/terms",
    title: "Terms of service",
    text: "Professional-lane subscription terms, supervision acknowledgment, and acceptable use.",
  },
  {
    href: "/legal/privacy",
    title: "Privacy policy",
    text: "What is collected, how matter content is isolated and retained, and the subprocessor list.",
  },
  {
    href: "/legal/ai-disclosure",
    title: "AI disclosure",
    text: "How AI is used, what it can and cannot do, and the human-review requirements on every output.",
  },
] as const;

export default function LegalIndexPage() {
  return (
    <MarketingShell>
      <PageIntro
        kicker="Legal"
        title="The paperwork, in plain sight."
        lede="Drafts of the customer-facing legal documents. Every document here requires final review by counsel before public launch."
      />
      <section className="section" aria-label="Legal documents">
        <div className="workflow-list">
          {DOCS.map((doc, index) => (
            <article className="workflow-row" key={doc.href}>
              <span className="row-index">0{index + 1}</span>
              <div>
                <h3>
                  <Link href={doc.href} className="underline underline-offset-4">
                    {doc.title}
                  </Link>
                </h3>
                <p className="m-0 text-[0.72rem] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
                  Draft — pending final legal review
                </p>
              </div>
              <p>{doc.text}</p>
            </article>
          ))}
        </div>
      </section>
      <Boundary>
        Nothing on this site is legal advice, and using Lex Patent Studio
        creates no attorney–client relationship with the platform. Connected
        legal services, where offered, begin only after conflict clearance,
        attorney acceptance, and a signed engagement.
      </Boundary>
    </MarketingShell>
  );
}
