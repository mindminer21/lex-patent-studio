import type { Metadata } from "next";
import Link from "next/link";
import { Boundary, MarketingShell, PageIntro } from "@/components/marketing/Shell";
import { USAGE_MARKUP } from "@/lib/domain/pricing";

export const metadata: Metadata = {
  title: "Pricing — Lex Patent Studio",
  description:
    "Professional-lane plans with prepaid usage wallets. Model usage billed at provider cost × 1.50, shown before every run.",
};

/** FR-9 plan table. Test-mode defaults; live pricing is approval-gated. */
const PLANS = [
  {
    name: "Explore",
    price: "$0",
    cadence: "trial",
    credit: "Small one-time usage credit",
    audience: "Evaluation only — no confidential uploads",
  },
  {
    name: "Professional",
    price: "$149",
    cadence: "/month",
    credit: "$30 usage credit included monthly",
    audience: "Solo patent attorneys and agents",
  },
  {
    name: "Team",
    price: "$499",
    cadence: "/month · 5 seats",
    credit: "$100 pooled usage credit monthly",
    audience: "Boutiques and in-house patent teams",
  },
  {
    name: "Enterprise",
    price: "Custom",
    cadence: "",
    credit: "Negotiated",
    audience: "Firms and legal departments needing SSO, DPA, custom retention",
  },
] as const;

export default function PricingPage() {
  return (
    <MarketingShell>
      <PageIntro
        kicker="Pricing"
        title="A flat seat. A transparent meter. No surprises mid-run."
        lede="Subscriptions cover the workspace; model usage draws on a prepaid wallet at provider cost × 1.50, with the estimated charge range shown before every run — never after."
      />

      <section className="section" aria-label="Plans">
        <p className="m-0 mb-4 inline-block border border-[#b9a76a] bg-[#f4ecd2] px-2 py-1 text-[0.72rem] font-bold uppercase tracking-[0.08em] text-[#5d4a12]">
          Test-mode defaults, subject to change — live pricing requires final
          approval
        </p>
        <div className="pricing-table" role="table" aria-label="Professional plans">
          {PLANS.map((plan) => (
            <article className="plan" key={plan.name} role="row">
              <div>
                <p className="eyebrow">{plan.name}</p>
                <p>{plan.audience}</p>
              </div>
              <div>
                <p className="price">
                  <strong>{plan.price}</strong>
                  {plan.cadence && <span>{plan.cadence}</span>}
                </p>
                <p className="m-0 mt-1 text-[0.8rem] text-[var(--muted)]">{plan.credit}</p>
              </div>
              <a
                className="text-link"
                href="mailto:demo@example.invalid?subject=Lex%20Patent%20Studio"
              >
                Request details <span aria-hidden="true">→</span>
              </a>
            </article>
          ))}
        </div>

        <div className="mt-10 max-w-[720px] space-y-4 text-[0.92rem] leading-relaxed">
          <h2 className="m-0 text-[1.3rem] font-medium" style={{ fontFamily: "Georgia, serif" }}>
            How usage billing works
          </h2>
          <ul className="m-0 list-disc space-y-2 pl-5">
            <li>
              Model usage is billed at <strong>provider cost × {USAGE_MARKUP.toFixed(2)}</strong>{" "}
              against a prepaid wallet. <Link href="/models" className="underline underline-offset-4">Per-model rates</Link> are published and effective-dated.
            </li>
            <li>
              Every run shows an estimated charge range and wallet sufficiency
              before execution; the high end is reserved first, and the
              remainder returns to your wallet at settlement.
            </li>
            <li>
              Optional per-run workflow fees (application-drafting
              orchestration, office-action packages, citation verification,
              multi-model second opinions) are displayed before execution.
            </li>
            <li>Failed provider calls are not charged to you.</li>
          </ul>
        </div>
      </section>

      <Boundary>
        Plans compare on economics and workflow throughput — cost per drafted
        section, per analysis, per search report — never on equivalence to a
        licensed practitioner. Quality and throughput claims are published
        only after evaluation evidence supports them. No plan includes legal
        advice, representation, filing, or guaranteed outcomes.
      </Boundary>
    </MarketingShell>
  );
}
