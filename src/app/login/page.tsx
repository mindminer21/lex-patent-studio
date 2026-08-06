import type { Metadata } from "next";
import Link from "next/link";
import { Boundary, MarketingShell, PageIntro } from "@/components/marketing/Shell";
import { getEnv } from "@/lib/env";
import { lexSignInAction } from "./actions";

export const metadata: Metadata = {
  title: "Sign in — Lex Patent Studio",
};

/**
 * §8.1 /login. Production authentication (Supabase Auth: email verification,
 * MFA for admin roles) sits behind the approval-gated environment contract.
 * Local mode signs in a synthetic practitioner automatically — this page
 * says so honestly instead of rendering a dead credential form.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string; status?: string }>;
}) {
  const env = getEnv();
  const { error, next, status } = await searchParams;
  return (
    <MarketingShell>
      <PageIntro
        kicker="Sign in"
        title={env.LEX_APP_MODE === "production" ? "Sign in to your workspace." : "Authentication is environment-gated."}
        lede={env.LEX_APP_MODE === "production" ? "Lex access is currently invitation-only for patent practitioners and their teams." : "This deployment runs in local mode: a synthetic practitioner session, synthetic data, and no external services."}
      />
      <section className="section" aria-label="Sign-in status">
        <div className="max-w-[640px] border border-[var(--line)] bg-[var(--white)] p-6">
          {env.LEX_APP_MODE === "production" ? (
            <>
              {status === "password_updated" && <p role="status">Your password was updated.</p>}
              {error && (
                <p className="border border-[#a64b3c] bg-[#fff1ef] p-3 text-sm" role="alert">
                  {error === "not_invited"
                    ? "This verified account does not have an active Lex invitation."
                    : "The email or password was not accepted."}
                </p>
              )}
              <form action={lexSignInAction} className="mt-4 space-y-4">
                <label className="block text-sm font-semibold" htmlFor="lex-email">
                  Email address
                </label>
                <input className="w-full border border-[var(--line)] p-3" id="lex-email" name="email" type="email" autoComplete="email" required />
                <label className="block text-sm font-semibold" htmlFor="lex-password">
                  Password
                </label>
                <input className="w-full border border-[var(--line)] p-3" id="lex-password" name="password" type="password" autoComplete="current-password" minLength={12} maxLength={512} required />
                <input type="hidden" name="next" value={next ?? ""} />
                <button className="button" type="submit">Sign in</button>
              </form>
              <p className="mb-0 mt-4 text-sm text-[var(--muted)]">
                Forgot your password? <Link href="/recover">Request a secure recovery link</Link>.
              </p>
            </>
          ) : (
            <>
              <p className="m-0 text-[0.95rem] leading-relaxed">
                <strong>Local mode:</strong> you are automatically signed in as a synthetic practitioner-admin of a synthetic tenant.
              </p>
              <Link className="button mt-5 inline-block" href="/app">
                Enter the local-mode workspace
              </Link>
            </>
          )}
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
