import type { Metadata } from "next";
import Link from "next/link";
import { Boundary, MarketingShell, PageIntro } from "@/components/marketing/Shell";

export const metadata: Metadata = {
  title: "Sign in — Lex Patent Studio",
};

/**
 * §8.1 /login. Production authentication (Supabase Auth: email verification,
 * MFA for admin roles) sits behind the approval-gated environment contract.
 * Local mode signs in a synthetic practitioner automatically — this page
 * says so honestly instead of rendering a dead credential form.
 */
export default function LoginPage() {
  return (
    <MarketingShell>
      <PageIntro
        kicker="Sign in"
        title="Authentication is environment-gated."
        lede="This deployment runs in local mode: a synthetic practitioner session, synthetic data, and no external services."
      />
      <section className="section" aria-label="Sign-in status">
        <div className="max-w-[640px] border border-[var(--line)] bg-[var(--white)] p-6">
          <p className="m-0 text-[0.95rem] leading-relaxed">
            <strong>Local mode:</strong> you are automatically signed in as a
            synthetic practitioner-admin of a synthetic tenant.
          </p>
          <p className="mb-0 mt-3 text-[0.9rem] leading-relaxed text-[var(--muted)]">
            Production sign-in uses Supabase Auth with HTTP-only session
            cookies, email verification, rate-limited recovery, and MFA
            required for owner and practitioner-admin roles at GA (FR-1).
            Enabling it requires the production environment contract
            (LEX_SUPABASE_*) and explicit approval — no credential form is
            shown until then.
          </p>
          <Link className="button mt-5 inline-block" href="/app">
            Enter the local-mode workspace
          </Link>
        </div>
      </section>
      <Boundary>
        Signing in creates a software session, never an attorney–client
        relationship. All workspace outputs are drafts for professional
        review.
      </Boundary>
    </MarketingShell>
  );
}
