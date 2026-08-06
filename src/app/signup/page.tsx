import type { Metadata } from "next";
import Link from "next/link";
import { Boundary, MarketingShell, PageIntro } from "@/components/marketing/Shell";

export const metadata: Metadata = {
  title: "Create an account — Lex Patent Studio",
};

/**
 * §8.1 /signup. Account creation, organization setup, and the versioned
 * professional-lane clickwrap (PRD §9.1) are production-auth capabilities
 * behind the approval-gated environment contract. No dead form is shown.
 */
const CLICKWRAP_ACKNOWLEDGEMENTS = [
  "I am, or work under the supervision of, a responsible patent practitioner.",
  "Outputs are drafts requiring professional review before any use.",
  "Using the platform creates no attorney–client relationship with it.",
  "Lex Patent Studio is not a docketing system and does not guarantee deadline monitoring.",
  "I understand the confidentiality and provider-processing disclosures.",
];

export default function SignupPage() {
  return (
    <MarketingShell>
      <PageIntro
        kicker="Create an account"
        title="Lex is invitation-only during practitioner beta."
        lede="A tenant administrator invites approved practitioners and team members. Open signup can be enabled later without changing the tenancy or supervision contract."
      />
      <section className="section" aria-label="Signup status">
        <div className="max-w-[680px] border border-[var(--line)] bg-[var(--white)] p-6">
          <h2 className="m-0 text-[1.1rem] font-medium" style={{ fontFamily: "Georgia, serif" }}>
            The professional-lane clickwrap (versioned, server-recorded)
          </h2>
          <ul className="mb-0 mt-3 list-disc space-y-2 pl-5 text-[0.9rem] leading-relaxed">
            {CLICKWRAP_ACKNOWLEDGEMENTS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="mb-0 mt-4 text-[0.85rem] text-[var(--muted)]">
            Each acknowledgement requires an explicit action; acceptance is
            recorded server-side with the terms version, and changed material
            terms require re-acceptance. Evaluate the product now in the
            local-mode workspace with synthetic data. Invited users receive a
            verified authentication email and set their password before access.
          </p>
          <Link className="button mt-5 inline-block" href="/app">
            Explore the local-mode workspace
          </Link>
        </div>
      </section>
      <Boundary>
        Plans (Explore $0 · Professional $149 · Team $499 · Enterprise
        custom) are test-mode defaults; live pricing and billing activation
        require explicit approval. No card is ever charged from this
        environment.
      </Boundary>
    </MarketingShell>
  );
}
