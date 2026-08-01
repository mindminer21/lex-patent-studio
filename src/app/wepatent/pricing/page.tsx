import type { Metadata } from "next";
import Link from "next/link";
import PublicShell from "@/components/wepatent/PublicShell";

export const metadata: Metadata = {
  title: "Pricing | wepatent",
  description: "Subscription plans and prepaid AI usage for wepatent invention records.",
};

const plans = [
  ["Explore", "$0", "Limited trial", "Small promotional AI credit", "Evaluate the invention-record workflow"],
  ["Solo", "$49", "per month", "$10 AI usage credit included", "Individual founder or inventor"],
  ["Professional", "$149", "per month", "$30 AI usage credit included", "Startup or active invention team"],
  ["Team", "$499", "per month", "$100 pooled AI usage credit", "R&D group, accelerator, or portfolio program"],
  ["Enterprise", "Custom", "contracted", "Contracted usage", "Larger organizations"],
];

export default function PricingPage() {
  return (
    <PublicShell>
      <div className="policy-page">
        <p className="venture-kicker">Subscription and usage</p>
        <h1>Plain pricing. Metered AI, disclosed up front.</h1>
        <p className="terms-intro">
          A subscription covers the invention-record workspace. AI generation is metered separately through a
          prepaid usage wallet, so you always see an estimated cost range and wallet sufficiency before a run.
        </p>

        <div className="pricing-list" role="table" aria-label="wepatent subscription plans">
          {plans.map(([name, price, cadence, credit, audience]) => (
            <article className="pricing-row" key={name} role="row">
              <div>
                <h2>{name}</h2>
                <p>{audience}</p>
              </div>
              <p className="price">
                <strong>{price}</strong>
                <span>{cadence}</span>
              </p>
              <p className="credit">{credit}</p>
            </article>
          ))}
        </div>

        <section className="terms-source">
          <h2>How AI usage billing works</h2>
          <p>
            Every generation run shows an estimated cost range before it starts. The run is reserved against
            your prepaid wallet and settled from provider-reported usage afterward. The customer charge is the
            actual provider cost multiplied by 1.50, using effective-dated rates recorded with every usage
            event. No generation begins if the reservation would exceed your wallet balance or a budget cap.
          </p>
        </section>
        <section className="terms-source">
          <h2>What pricing does not include</h2>
          <p>
            Software fees never include legal services. Any consultation or engagement with connected patent
            counsel is billed separately by the law firm under its own engagement agreement, and legal fees are
            never processed as wepatent subscription or AI usage revenue.
          </p>
        </section>
        <p className="prototype-note" role="note">
          Amounts shown are implementation defaults for test-mode billing, not permanent public promises. Live
          pricing requires explicit approval before launch. See the{" "}
          <Link href="/wepatent/terms">Self-Service Terms</Link>.
        </p>
      </div>
    </PublicShell>
  );
}
